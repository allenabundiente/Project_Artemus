import { useState } from 'react';
import * as api from '../api';
import type { BookMeta } from '../types';

/**
 * One row in the teacher's ASSIGNED TOMES list: the tome title plus an
 * expandable quest-rules editor —
 *   • quest cap: how many chapters of the PDF are playable;
 *   • availability window: when the whole tome opens and closes.
 * Empty cap/window = unlimited / always available. Saves go to
 * PUT /api/books/:id/rules and patch the parent's book list in place.
 */
export default function BookRulesRow({ book, onSaved }: { book: BookMeta; onSaved: (rules: Pick<BookMeta, 'questLimit' | 'availableFrom' | 'availableUntil'>) => void }) {
  const [open, setOpen] = useState(false);
  const [questLimit, setQuestLimit] = useState<string>(book.questLimit != null ? String(book.questLimit) : '');
  const [from, setFrom] = useState<string>(toLocalInput(book.availableFrom));
  const [until, setUntil] = useState<string>(toLocalInput(book.availableUntil));
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const windowActive =
    (!!book.availableFrom && Date.now() < new Date(book.availableFrom).getTime()) ||
    (!!book.availableUntil && Date.now() > new Date(book.availableUntil).getTime());

  async function save() {
    setBusy(true);
    setMsg(null);
    try {
      const res = await api.setBookRules(book.id, {
        questLimit: questLimit.trim() === '' ? null : Number(questLimit),
        availableFrom: from || null,
        availableUntil: until || null,
      });
      onSaved(res.rules);
      setMsg('Saved ✓');
      window.setTimeout(() => setMsg(null), 2000);
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <li style={{ marginBottom: '0.4rem', borderBottom: '1px solid rgba(255,255,255,0.08)', paddingBottom: '0.4rem' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
        <button
          className="pixel-btn pixel-btn--ghost"
          style={{ fontSize: '0.6rem', flex: 1, textAlign: 'left', textTransform: 'none' }}
          onClick={() => setOpen((v) => !v)}
          title="Quest limit & availability window"
        >
          ▸ {book.title}
        </button>
        {book.questLimit != null && (
          <span className="pixel-font" style={{ fontSize: '0.55rem', color: 'var(--d-gold)', whiteSpace: 'nowrap' }}>
            📜 {book.questLimit} quests
          </span>
        )}
        {windowActive && (
          <span className="pixel-font" style={{ fontSize: '0.55rem', color: 'var(--p-red)', whiteSpace: 'nowrap' }}>
            🔒 locked now
          </span>
        )}
      </div>

      {open && (
        <div style={{ padding: '0.5rem 0.25rem 0.1rem', display: 'grid', gap: '0.5rem' }}>
          <label className="term-font" style={{ fontSize: '0.95rem', display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
            <span style={{ width: 150 }}>📜 Quest limit</span>
            <input
              className="pixel-input"
              type="number"
              min={1}
              max={500}
              placeholder="all"
              value={questLimit}
              onChange={(e) => setQuestLimit(e.target.value)}
              style={{ width: 90 }}
            />
            <span style={{ color: 'var(--d-stone-light)', fontSize: '0.85rem' }}>chapters playable (empty = all)</span>
          </label>

          <label className="term-font" style={{ fontSize: '0.95rem', display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
            <span style={{ width: 150 }}>🕒 Opens</span>
            <input className="pixel-input" type="datetime-local" value={from} onChange={(e) => setFrom(e.target.value)} />
          </label>

          <label className="term-font" style={{ fontSize: '0.95rem', display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
            <span style={{ width: 150 }}>🕒 Closes</span>
            <input className="pixel-input" type="datetime-local" value={until} onChange={(e) => setUntil(e.target.value)} />
          </label>

          <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
            <button className="pixel-btn pixel-btn--gold" style={{ fontSize: '0.6rem' }} onClick={() => void save()} disabled={busy}>
              {busy ? '…' : 'SAVE RULES'}
            </button>
            {(questLimit || from || until) && (
              <button
                className="pixel-btn pixel-btn--ghost"
                style={{ fontSize: '0.6rem' }}
                onClick={() => { setQuestLimit(''); setFrom(''); setUntil(''); }}
                title="Clear all rules — the tome becomes unlimited and always available"
              >
                CLEAR
              </button>
            )}
            {msg && <span className="term-font" style={{ fontSize: '0.9rem', color: 'var(--d-gold)' }}>{msg}</span>}
          </div>
        </div>
      )}
    </li>
  );
}

/** ISO timestamp → value for <input type="datetime-local"> (local time). */
function toLocalInput(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
