import { useEffect, useState } from 'react';
import * as api from '../api';

/**
 * Streak reminder — chat-pill style nudge shown once the streak is AT RISK:
 * the adventurer has a live streak but no quest logged today, and the local
 * evening has begun (the server decides; client just renders the flag).
 *
 * UX rules:
 *  - solo adventurers and guild members both get it (a streak is personal);
 *  - dismissed stays dismissed for the REST OF THE DAY (localStorage);
 *  - never renders while a quest/lesson is running (prop `suppressed`);
 *  - auto-hides once the streak is no longer at risk (quest completed).
 */
export default function StreakReminder({ suppressed = false }: { suppressed?: boolean }) {
  const [info, setInfo] = useState<api.StreakInfo | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let alive = true;
    // Poll gently: streak state changes when a quest lands elsewhere in the app.
    const load = () => void api.getStreak().then((s) => { if (alive) setInfo(s); }).catch(() => { /* optional chrome */ });
    load();
    const t = window.setInterval(load, 60_000);
    return () => { alive = false; window.clearInterval(t); };
  }, []);

  // "Dismissed today" key: flips automatically at local midnight.
  const [dismissKey, setDismissKey] = useState(() => new Date().toDateString());
  const [dismissed, setDismissed] = useState(() => {
    try {
      const raw = localStorage.getItem('streak-risk-dismissed');
      return raw != null && JSON.parse(raw).day === new Date().toDateString();
    } catch { return false; }
  });

  function dismiss() {
    const day = new Date().toDateString();
    try { localStorage.setItem('streak-risk-dismissed', JSON.stringify({ day })); } catch { /* private mode */ }
    setDismissKey(day);
    setDismissed(true);
    setOpen(false);
  }

  if (!info || suppressed || dismissed || !info.atRisk) return null;
  void dismissKey;

  return (
    <div className="streak-reminder">
      {!open ? (
        <button
          type="button"
          className="chat-fab streak-reminder__pill"
          onClick={() => setOpen(true)}
          title="Your daily quest streak needs you tonight"
        >
          <span className="streak-reminder__flame" aria-hidden>🔥</span>
          <span className="pixel-font streak-reminder__text">
            {info.currentStreak}-DAY STREAK AT RISK
          </span>
          <span className="chat-fab__dot" aria-hidden />
        </button>
      ) : (
        <div className="pixel-panel chat-panel--floating streak-reminder__panel" role="alert">
          <div className="chat-panel__head">
            <p className="pixel-font chat-panel__title">🔥 YOUR STREAK NEEDS YOU</p>
            <button className="pixel-btn pixel-btn--ghost chat-panel__min" onClick={() => setOpen(false)} aria-label="Minimize">×</button>
          </div>
          <p className="term-font" style={{ margin: '0 0 0.6rem', fontSize: '1.05rem' }}>
            You have a <strong style={{ color: 'var(--d-gold)' }}>{info.currentStreak}-day streak</strong> going —
            complete one quest before midnight to keep the flame alive
            {(info.currentStreak + 1) % 7 === 0
              ? ' and claim tomorrow’s 7-day bonus!'
              : `. ${(7 - (info.currentStreak % 7)) % 7 || 7} more day${(7 - (info.currentStreak % 7)) === 1 ? '' : 's'} to the next bonus.`}
          </p>
          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
            <button className="pixel-btn pixel-btn--gold" style={{ fontSize: '0.6rem' }} onClick={dismiss}>
              ⚔ I'LL QUEST TONIGHT
            </button>
            <button className="pixel-btn pixel-btn--ghost" style={{ fontSize: '0.6rem' }} onClick={dismiss}>
              DISMISS TODAY
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
