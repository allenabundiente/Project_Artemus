import { useCallback, useEffect, useRef, useState } from 'react';
import type { AvatarPrefs, DungeonEvent, DungeonFetchResult, ScoreResultResponse, Term } from '../types';
import * as api from '../api';
import { DungeonEngine } from '../game/dungeonEngine';
import { sfx } from '../game/sfx';
import { spriteDataUrl } from '../game/sprites';
import BattleScreen from './BattleScreen';
import RuneSocketDialog from './RuneSocketDialog';
import ChestLockDialog from './ChestLockDialog';
import TouchControls from './TouchControls';

interface Props {
  bookId: string;
  chapterId: string;
  chapterIdx: number;
  term: Term;
  avatar?: AvatarPrefs;
  onExit: () => void;
  onComplete: (chapterId: string, result: ScoreResultResponse) => void;
  onFailSettled?: (chapterId: string, result: ScoreResultResponse) => void;
}

type Phase = 'loading' | 'playing' | 'event' | 'gameover';

/**
 * The Depths: top-down dungeon quest. Loads the chapter's generated map
 * (lazily built server-side on first play), runs DungeonEngine, and opens the
 * right dialog per event type. Monster gates reuse the classic BattleScreen
 * (hearts + queue-of-one) so the look stays consistent.
 */
export default function DungeonScreen({ bookId, chapterId, chapterIdx, term, avatar, onExit, onComplete, onFailSettled }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const engineRef = useRef<DungeonEngine | null>(null);
  const startedAtRef = useRef<number>(Date.now());
  const mistakesRef = useRef(0);
  const submittingRef = useRef(false);
  const [phase, setPhase] = useState<Phase>('loading');
  const phaseRef = useRef<Phase>('loading');
  phaseRef.current = phase;
  const [loadError, setLoadError] = useState<string | null>(null);
  const [genInfo, setGenInfo] = useState<DungeonFetchResult | null>(null);
  const [activeEvent, setActiveEvent] = useState<DungeonEvent | null>(null);
  const [hud, setHud] = useState({ lives: 3, score: 0, surge: 0, keys: 0 });
  const [totalEvents, setTotalEvents] = useState(0);
  const [cleared, setCleared] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [isTouch, setIsTouch] = useState(false);
  useEffect(() => {
    setIsTouch(window.matchMedia?.('(pointer: coarse)').matches ?? false);
  }, []);

  const finishQuest = useCallback(
    async (finished: boolean, livesRemaining: number) => {
      if (submittingRef.current) return;
      submittingRef.current = true;
      setSubmitting(true);
      const timeSeconds = Math.round((Date.now() - startedAtRef.current) / 1000);
      try {
        const result = await api.submitQuestComplete(chapterId, {
          mistakes: mistakesRef.current,
          timeSeconds,
          finished,
          livesRemaining,
          outOfLife: !finished && livesRemaining <= 0,
          bestStreak: 0,
          term,
          coinsGathered: 0,
        });
        onComplete(chapterId, result);
      } catch (e) {
        setLoadError((e as Error).message);
        submittingRef.current = false;
        setSubmitting(false);
      }
    },
    [chapterId, term, onComplete],
  );

  const failQuest = useCallback(
    async (reason: 'out_of_lives' | 'out_of_time') => {
      if (submittingRef.current || phaseRef.current === 'gameover') return;
      submittingRef.current = true;
      setPhase('gameover');
      setSubmitting(true);
      const timeSeconds = Math.round((Date.now() - startedAtRef.current) / 1000);
      try {
        const result = await api.submitQuestFail(chapterId, {
          reason,
          mistakes: mistakesRef.current,
          timeSeconds,
          livesRemaining: 0,
          bestStreak: 0,
          term,
          coinsGathered: 0,
        });
        onFailSettled?.(chapterId, result);
      } catch {
        /* the popup below still offers retry/map */
      } finally {
        setSubmitting(false);
      }
    },
    [chapterId, term, onFailSettled],
  );
  const failQuestRef = useRef(failQuest);
  failQuestRef.current = failQuest;
  const finishQuestRef = useRef(finishQuest);
  finishQuestRef.current = finishQuest;

  // --- load dungeon + boot engine ------------------------------------------
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await api.getDungeon(bookId, chapterId, term);
        if (cancelled) return;
        setGenInfo(res);
        setTotalEvents(res.map.dungeon_events.length);
        const canvas = canvasRef.current;
        if (!canvas) return;
        const engine = new DungeonEngine(canvas, res.map, {
          onEventEncounter: (event) => {
            setActiveEvent(event);
            setPhase('event');
          },
          onPortalOpen: () => { /* HUD hint updates via cleared/keys state */ },
          onExit: () => void finishQuestRef.current(true, engine.getLives()),
          onStateChange: (s) => setHud(s),
          onGameOver: () => {
            setPhase('gameover');
            void failQuestRef.current('out_of_lives');
          },
        });
        engineRef.current = engine;
        // Real pixel-art pack (silent authored-grid fallback when missing).
        await engine.useAssets();
        engine.setAvatar(avatar);
        engine.start();
        setPhase('playing');
      } catch (e) {
        if (!cancelled) setLoadError((e as Error).message);
      }
    })();
    return () => {
      cancelled = true;
      engineRef.current?.stop();
      engineRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bookId, chapterId]);

  useEffect(() => {
    engineRef.current?.setPaused(phase !== 'playing');
  }, [phase]);

  // Keep the cleared-count HUD fresh after each event.
  useEffect(() => {
    if (phase === 'playing') setCleared(engineRef.current?.getClearedCount() ?? 0);
  }, [phase]);

  function resolveEvent(won: boolean) {
    const engine = engineRef.current;
    const ev = activeEvent;
    setActiveEvent(null);
    if (!engine || !ev) return;
    if (won) {
      engine.clearEvent(ev.event_id);
      setPhase('playing');
    } else {
      mistakesRef.current += 1;
      engine.failEvent(ev.event_id);
      if (engine.getLives() > 0) setPhase('playing');
      // lives == 0 → engine already fired onGameOver
    }
  }

  function retryLevel() {
    // Simplest correct retry: remount the whole screen via key change is over
    //kill here — reload the page state by navigating back to the map.
    onExit();
  }

  if (loadError) {
    return (
      <div className="dialog-box" style={{ maxWidth: 560, margin: '0 auto' }}>
        <p className="error-text">{loadError}</p>
        <button className="pixel-btn" onClick={onExit}>BACK TO MAP</button>
      </div>
    );
  }

  const surgePct = Math.min(100, hud.surge);

  return (
    <div style={{ maxWidth: 960, margin: '0 auto' }}>
      <div className="hud" style={{ marginBottom: '0.75rem', flexWrap: 'wrap' }}>
        <span className="label">QUEST {chapterIdx + 1} · THE DEPTHS</span>
        <span style={{ display: 'flex', alignItems: 'center' }}>
          {Array.from({ length: 3 }, (_, i) => (
            <img
              key={i}
              src={spriteDataUrl(i < hud.lives ? 'heart' : 'heart_empty')}
              alt=""
              style={{ width: 14, height: 11, marginRight: '0.15rem', imageRendering: 'pixelated' }}
            />
          ))}
        </span>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.25rem' }}>
          <span className="label">SCORE:</span> {hud.score}
          <PackIcon set="coin" size={14} title="coins" />
        </span>
        <span><span className="label">EVENTS:</span> {cleared}/{totalEvents}</span>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.25rem' }}>
          <span className="label">KEYS:</span> {Math.min(hud.keys, 3)}/3
          {hud.keys > 0 ? <PackIcon set="key" size={14} title="portal keys" /> : <span aria-hidden>🗝</span>}
        </span>
        {/* Surge gauge */}
        <span style={{ display: 'flex', alignItems: 'center', gap: '0.3rem' }} title="Answer correctly in a row to fill the SURGE gauge">
          <span className="label">SURGE</span>
          <span style={{ width: 64, height: 8, background: '#2a2230', border: '1px solid var(--d-black)', display: 'inline-block' }}>
            <span
              style={{
                display: 'block', height: '100%', width: `${surgePct}%`,
                background: surgePct >= 100 ? 'var(--d-gold-bright)' : 'var(--d-orange)',
                transition: 'width 120ms linear',
              }}
            />
          </span>
        </span>
        <button className="pixel-btn pixel-btn--ghost" onClick={() => sfx.toggle()} title="Toggle sound" style={{ fontSize: '0.8rem' }}>
          {sfx.isMuted() ? '🔇' : '🔊'}
        </button>
        <button className="pixel-btn pixel-btn--ghost" onClick={onExit} style={{ fontSize: '0.8rem' }}>FLEE QUEST</button>
      </div>

      {/* Canvas is mounted before the effect runs so the engine can grab it. */}
      <canvas
        id="dungeon-canvas"
        ref={canvasRef}
        style={{ width: '100%', maxWidth: 768, display: 'block', margin: '0 auto', imageRendering: 'pixelated', background: '#16101a', border: '4px solid var(--d-black)', outline: '2px solid var(--d-gold)', outlineOffset: -6, visibility: phase === 'loading' ? 'hidden' : 'visible' }}
      />

      {phase === 'loading' && (
        <p className="pixel-font" style={{ textAlign: 'center', marginTop: '2rem' }}>
          DESCENDING INTO THE DEPTHS…
        </p>
      )}

      {isTouch && phase === 'playing' && engineRef.current && (
        <DungeonTouchPad engine={engineRef.current} />
      )}

      {genInfo && phase !== 'loading' && (
        <p className="term-font" style={{ textAlign: 'center', color: 'var(--d-stone-light)', marginTop: '0.6rem' }}>
          «{genInfo.map.quest_meta.title}» · {genInfo.map.dungeon_events.length} trials ·
          {' '}{genInfo.cached ? 'forged earlier' : `forged just now (${genInfo.mode} mode)`} ·
          {' '}clear 3 trials to unlock the portal — clear them ALL for the completion bonus.
          {' '}Fill the SURGE gauge to sprint and WALK THROUGH SPIKES while it glows.
        </p>
      )}

      {phase === 'event' && activeEvent && (
        <div className="modal-overlay">
          {activeEvent.type === 'monster_gate' ? (
            <BattleScreen
              queue={[{
                id: activeEvent.event_id,
                bookId,
                chapterId,
                type: 'multiple_choice',
                prompt: activeEvent.data.question ?? 'Answer to pass!',
                code: null,
                options: activeEvent.data.options ?? [],
                correctAnswer: activeEvent.data.options?.[activeEvent.data.correct_index ?? 0] ?? '',
                explanation: 'Strike true to fell the guardian in one hit.',
                difficulty: 'medium',
              }]}
              maxHp={1}
              lives={hud.lives}
              onDamage={() => resolveEvent(false)}
              onRetreat={() => resolveEvent(false)}
              onVictory={() => resolveEvent(true)}
            />
          ) : activeEvent.type === 'rune_socket' ? (
            <RuneSocketDialog event={activeEvent} onResult={resolveEvent} />
          ) : (
            <ChestLockDialog event={activeEvent} onResult={resolveEvent} />
          )}
        </div>
      )}

      {phase === 'gameover' && (
        <div className="modal-overlay">
          <div className="gameover-panel">
            <p className="gameover-title">☠ GAME OVER ☠</p>
            <p className="gameover-sub">The Depths claimed another hero…</p>
            <p className="gameover-note">{submitting ? 'Recording your defeat…' : 'Your run has ended.'}</p>
            <div className="gameover-actions">
              <button className="pixel-btn" onClick={retryLevel} disabled={submitting}>🗺 KINGDOM MAP</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/** Animated pack sprite (coin/key) for the HUD; renders nothing while frames are missing. */
function PackIcon({ set, size, title }: { set: string; size: number; title: string }) {
  const [frames, setFrames] = useState<string[]>([]);
  const [idx, setIdx] = useState(0);
  useEffect(() => {
    let alive = true;
    Promise.all(
      [1, 2, 3, 4].map(
        (i) =>
          new Promise<string | null>((res) => {
            const img = new Image();
            img.onload = () => res(`/dungeon/${set}_${i}.png`);
            img.onerror = () => res(null);
            img.src = `/dungeon/${set}_${i}.png`;
          }),
      ),
    ).then((urls) => {
      if (alive) setFrames(urls.filter((u): u is string => !!u));
    });
    return () => {
      alive = false;
    };
  }, [set]);
  useEffect(() => {
    if (frames.length < 2) return;
    const t = window.setInterval(() => setIdx((i) => i + 1), 160);
    return () => window.clearInterval(t);
  }, [frames.length]);
  if (frames.length === 0) return null;
  return <img src={frames[idx % frames.length]} alt="" title={title} style={{ width: size, height: size, imageRendering: 'pixelated' }} />;
}

/** Minimal 4-direction pad: reuses TouchControls' visual idiom but feeds the dungeon engine. */
function DungeonTouchPad({ engine }: { engine: DungeonEngine }) {
  const heldRef = useRef({ up: false, down: false, left: false, right: false });
  useEffect(() => () => engine.clearTouchInput(), [engine]);
  function press(key: keyof typeof heldRef.current) {
    return (e: React.PointerEvent<HTMLButtonElement>) => {
      e.preventDefault();
      e.currentTarget.setPointerCapture?.(e.pointerId);
      heldRef.current[key] = true;
      engine.setTouchInput(heldRef.current);
    };
  }
  function release(key: keyof typeof heldRef.current) {
    return (e: React.PointerEvent<HTMLButtonElement>) => {
      e.preventDefault();
      heldRef.current[key] = false;
      engine.setTouchInput(heldRef.current);
    };
  }
  const btn: React.CSSProperties = { width: 56, height: 56, fontSize: '1.3rem', touchAction: 'none', userSelect: 'none' };
  return (
    <div style={{ display: 'flex', justifyContent: 'center', gap: '0.4rem', marginTop: '0.6rem', touchAction: 'none' }}>
      <button type="button" aria-label="Move up" className="pixel-btn pixel-btn--ghost touch-btn" style={btn} onPointerDown={press('up')} onPointerUp={release('up')} onPointerLeave={release('up')} onPointerCancel={release('up')}>▲</button>
      <button type="button" aria-label="Move left" className="pixel-btn pixel-btn--ghost touch-btn" style={btn} onPointerDown={press('left')} onPointerUp={release('left')} onPointerLeave={release('left')} onPointerCancel={release('left')}>◀</button>
      <button type="button" aria-label="Move down" className="pixel-btn pixel-btn--ghost touch-btn" style={btn} onPointerDown={press('down')} onPointerUp={release('down')} onPointerLeave={release('down')} onPointerCancel={release('down')}>▼</button>
      <button type="button" aria-label="Move right" className="pixel-btn pixel-btn--ghost touch-btn" style={btn} onPointerDown={press('right')} onPointerUp={release('right')} onPointerLeave={release('right')} onPointerCancel={release('right')}>▶</button>
    </div>
  );
}
