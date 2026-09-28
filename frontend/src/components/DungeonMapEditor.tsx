import { useEffect, useMemo, useRef, useState } from 'react';
import * as api from '../api';
import type { BookDetail, DungeonEvent, DungeonEventType, DungeonMap } from '../types';

interface Props {
  bookId: string;
  onExit: () => void;
}

const GRID = 16;
const CELL = 26; // px per cell in the editor preview

type Tool = 'select' | 'monster_gate' | 'rune_socket' | 'chest_lock' | 'trap' | 'erase';

const TOOL_LABEL: Record<Tool, string> = {
  select: 'MOVE',
  monster_gate: '⚔ GATE',
  rune_socket: '🔶 RUNE',
  chest_lock: '🧰 CHEST',
  trap: '▲ TRAP',
  erase: '✕ ERASE',
};

const TYPE_MARK: Record<DungeonEventType, string> = {
  monster_gate: '⚔',
  rune_socket: '🔶',
  chest_lock: '🧰',
};

/**
 * Teacher map editor for The Depths: loads every chapter's stored dungeon,
 * lets the teacher drag events and traps around a 16×16 preview, and saves
 * through the validated PUT endpoint (which re-seats invalid positions).
 */
export default function DungeonMapEditor({ bookId, onExit }: Props) {
  const [book, setBook] = useState<BookDetail | null>(null);
  const [chapterId, setChapterId] = useState('');
  const [map, setMap] = useState<DungeonMap | null>(null);
  const [mode, setMode] = useState<string | null>(null);
  const [tool, setTool] = useState<Tool>('select');
  const [drag, setDrag] = useState<string | null>(null); // dragged event id
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const gridRef = useRef<HTMLDivElement>(null);

  const traps = useMemo(() => map?.traps ?? [], [map]);

  useEffect(() => {
    let alive = true;
    api
      .getBook(bookId)
      .then((b) => {
        if (!alive) return;
        setBook(b);
        setChapterId(b.chapters[0]?.id ?? '');
      })
      .catch((e) => alive && setError((e as Error).message));
    return () => {
      alive = false;
    };
  }, [bookId]);

  useEffect(() => {
    let alive = true;
    setMap(null);
    setError(null);
    setNotice(null);
    if (!chapterId) return;
    api
      .getDungeon(bookId, chapterId)
      .then((res) => {
        if (!alive) return;
        setMap(res.map);
        setMode(res.mode);
      })
      .catch((e) => alive && setError((e as Error).message));
    return () => {
      alive = false;
    };
  }, [bookId, chapterId]);

  function cellFromEvent(e: React.PointerEvent): { x: number; y: number } | null {
    const el = gridRef.current;
    if (!el) return null;
    const r = el.getBoundingClientRect();
    const x = Math.floor(((e.clientX - r.left) / r.width) * GRID);
    const y = Math.floor(((e.clientY - r.top) / r.height) * GRID);
    if (x < 0 || y < 0 || x >= GRID || y >= GRID) return null;
    return { x, y };
  }

  function setMapEvents(events: DungeonEvent[]) {
    setMap((m) => (m ? { ...m, dungeon_events: events } : m));
  }

  function onPointerDown(e: React.PointerEvent, cell: { x: number; y: number } | null) {
    if (!map || !cell) return;
    const ev = map.dungeon_events.find((d) => d.grid_position.x === cell.x && d.grid_position.y === cell.y);
    const isTrap = traps.some((t) => t.x === cell.x && t.y === cell.y);
    if (tool === 'select') {
      if (ev) setDrag(ev.event_id);
      return;
    }
    if (tool === 'erase') {
      if (ev) setMapEvents(map.dungeon_events.filter((d) => d.event_id !== ev.event_id));
      else if (isTrap) setMap((m) => (m ? { ...m, traps: (m.traps ?? []).filter((t) => !(t.x === cell.x && t.y === cell.y)) } : m));
      return;
    }
    if (tool === 'trap') {
      if (ev || isTrap) return;
      setMap((m) => (m ? { ...m, traps: [...(m.traps ?? []), { x: cell.x, y: cell.y }] } : m));
      return;
    }
    // Placing an event: replace an existing one on that cell, else append.
    const id = `event_${String(map.dungeon_events.length + 1).padStart(2, '0')}_${Date.now().toString(36).slice(-3)}`;
    const fresh: DungeonEvent = {
      event_id: ev?.event_id ?? id,
      type: tool,
      grid_position: { x: cell.x, y: cell.y },
      data: ev?.data ?? defaultData(tool),
    };
    setMapEvents([...map.dungeon_events.filter((d) => d.event_id !== fresh.event_id), fresh]);
  }

  function onPointerMove(e: React.PointerEvent) {
    if (!drag || !map) return;
    const cell = cellFromEvent(e);
    if (!cell) return;
    setMapEvents(map.dungeon_events.map((d) => (d.event_id === drag ? { ...d, grid_position: cell } : d)));
  }

  function endDrag() {
    setDrag(null);
  }

  function defaultData(type: DungeonEventType): DungeonEvent['data'] {
    if (type === 'monster_gate') {
      return { question: 'New gate — edit the question in the JSON below.', options: ['Answer A', 'Answer B'], correct_index: 0, damage_on_fail: 1, enemy_sprite: 'skeleton_knight' };
    }
    if (type === 'rune_socket') {
      return { prompt: 'Arrange the blocks in the correct order:', scrambled_items: ['first', 'second'], correct_sequence: ['first', 'second'] };
    }
    return { target_word: 'QUEST', hint: 'Key term from this chapter.', allowed_mistakes: 3, reward: 'Gold' };
  }

  async function save() {
    if (!map) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const res = await api.saveDungeon(bookId, chapterId, map);
      setMap(res.map);
      setMode('edited');
      setNotice('Map saved and validated. Students get this version on their next run.');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const chapterTitle = book?.chapters.find((c) => c.id === chapterId)?.title ?? '';

  if (!book) {
    return (
      <div style={{ maxWidth: 900, margin: '0 auto' }}>
        <button className="pixel-btn pixel-btn--ghost" onClick={onExit}>◀ HALL</button>
        <p className="term-font" style={{ marginTop: '1rem' }}>Opening the tome…</p>
        {error && <p className="error-text">{error}</p>}
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 900, margin: '0 auto' }}>
      <div className="hud" style={{ marginBottom: '0.75rem', flexWrap: 'wrap' }}>
        <button className="pixel-btn pixel-btn--ghost" onClick={onExit}>◀ HALL</button>
        <select
          className="pixel-select"
          value={chapterId}
          onChange={(e) => setChapterId(e.target.value)}
          style={{ fontSize: '0.7rem' }}
        >
          {book.chapters.map((c) => (
            <option key={c.id} value={c.id}>{c.idx + 1}. {c.title}</option>
          ))}
        </select>
        <span className="label">{map ? `${map.dungeon_events.length} events · ${traps.length} traps` : '…'}</span>
        <button className="pixel-btn" onClick={() => void save()} disabled={!map || busy}>
          {busy ? 'SAVING…' : '💾 SAVE MAP'}
        </button>
      </div>

      <p className="pixel-font" style={{ fontSize: '0.7rem', margin: '0 0 0.4rem' }}>
        MAP EDITOR — {chapterTitle} {mode && <span style={{ opacity: 0.7 }}>({mode})</span>}
      </p>

      {error && <p className="error-text">{error}</p>}
      {notice && <p className="term-font" style={{ color: 'var(--d-gold)' }}>{notice}</p>}

      {!map && !error && <p className="term-font">Forging the map…</p>}

      {map && (
        <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', alignItems: 'flex-start' }}>
          {/* Tools */}
          <div style={{ display: 'grid', gap: '0.3rem' }}>
            {(Object.keys(TOOL_LABEL) as Tool[]).map((t) => (
              <button
                key={t}
                className={`pixel-btn ${tool === t ? '' : 'pixel-btn--ghost'}`}
                style={{ fontSize: '0.6rem', padding: '0.3rem 0.5rem' }}
                onClick={() => setTool(t)}
              >
                {TOOL_LABEL[t]}
              </button>
            ))}
            <p className="term-font" style={{ fontSize: '0.75rem', maxWidth: 130, opacity: 0.8 }}>
              MOVE drags markers. Place GATE/RUNE/CHEST on empty floor (new events need their question filled in the JSON). TRAP tiles hurt unless the hero is surging.
            </p>
          </div>

          {/* Grid preview */}
          <div
            ref={gridRef}
            onPointerMove={onPointerMove}
            onPointerUp={endDrag}
            onPointerLeave={endDrag}
            style={{
              display: 'grid',
              gridTemplateColumns: `repeat(${GRID}, ${CELL}px)`,
              touchAction: 'none',
              userSelect: 'none',
              border: '2px solid var(--d-black)',
              background: '#241c2b',
            }}
          >
            {Array.from({ length: GRID * GRID }, (_, i) => {
              const x = i % GRID;
              const y = Math.floor(i / GRID);
              const border = x === 0 || y === 0 || x === GRID - 1 || y === GRID - 1;
              const ev = map.dungeon_events.find((d) => d.grid_position.x === x && d.grid_position.y === y);
              const trap = traps.some((t) => t.x === x && t.y === y);
              const portal = x === GRID - 2 && y === GRID - 2;
              const spawn = x <= 2 && y <= 2;
              return (
                <div
                  key={i}
                  onPointerDown={(e) => { e.preventDefault(); onPointerDown(e, { x, y }); }}
                  title={`${x},${y}${ev ? ` — ${ev.type}` : ''}${trap ? ' — trap' : ''}`}
                  style={{
                    width: CELL,
                    height: CELL,
                    fontSize: '0.7rem',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    background: border ? '#191219' : (x + y) % 2 === 0 ? '#3a3142' : '#352d3d',
                    cursor: tool === 'select' && ev ? 'grab' : 'pointer',
                    outline: portal ? '2px solid var(--d-gold)' : undefined,
                    opacity: spawn && !ev && !trap ? 0.55 : 1,
                  }}
                >
                  {ev ? TYPE_MARK[ev.type] : trap ? '▲' : portal ? '🌀' : spawn ? '🚩' : ''}
                </div>
              );
            })}
          </div>

          {/* JSON editor */}
          <textarea
            spellCheck={false}
            value={JSON.stringify(map.dungeon_events, null, 1)}
            onChange={(e) => {
              try {
                const parsed = JSON.parse(e.target.value) as DungeonEvent[];
                if (Array.isArray(parsed)) setMapEvents(parsed);
              } catch {
                /* keep typing — validate on blur/save */
              }
            }}
            style={{ flex: '1 1 260px', minWidth: 260, minHeight: 380, fontFamily: 'monospace', fontSize: '0.7rem' }}
          />
        </div>
      )}
    </div>
  );
}
