import { useEffect, useMemo, useState } from 'react';
import * as api from '../api';

/**
 * Streak calendar — the last ~10 weeks of quested days as a pixel-tile grid:
 *   ▢ empty day   🔥 quested day   ⭐ 7-day bonus day (every 7th of a streak)
 * Milestones are computed server-side from the actual score history, so the
 * highlighted days are exactly the ones that paid STREAK_BONUS_COINS.
 * Weeks are the rows, Monday-first; today gets a ring.
 */
export default function StreakCalendar({ streak }: { streak: api.StreakInfo | null }) {
  const [days, setDays] = useState<api.StreakCalendarDay[] | null>(null);
  // Collapsible: the calendar is a glanceable extra, not the main quest —
  // collapse keeps the hall tight on phones. Choice persists per session.
  const [open, setOpen] = useState(() => {
    try { return localStorage.getItem('streak-calendar-open') !== '0'; } catch { return true; }
  });

  function toggle() {
    setOpen((o) => {
      try { localStorage.setItem('streak-calendar-open', o ? '0' : '1'); } catch { /* private mode */ }
      return !o;
    });
  }

  useEffect(() => {
    void api.getStreakCalendar().then((r) => setDays(r.days)).catch(() => setDays([]));
  }, []);

  // Build a 10-week grid ending today: 70 day-cells, oldest first.
  const grid = useMemo(() => {
    const byDate = new Map((days ?? []).map((d) => [d.date, d]));
    const out: { date: string; quested: boolean; milestone: boolean; isToday: boolean }[] = [];
    const today = new Date();
    const utcToday = new Date(Date.UTC(today.getFullYear(), today.getMonth(), today.getDate()));
    // Back up to the Monday on/before (today - 69 days) so weeks align.
    const start = new Date(utcToday);
    start.setUTCDate(start.getUTCDate() - 69);
    const dow = (start.getUTCDay() + 6) % 7; // Monday = 0
    start.setUTCDate(start.getUTCDate() - dow);
    for (let i = 0; i < 70 + dow; i++) {
      const d = new Date(start);
      d.setUTCDate(start.getUTCDate() + i);
      const key = d.toISOString().slice(0, 10);
      const rec = byDate.get(key);
      out.push({
        date: key,
        quested: !!rec,
        milestone: !!rec?.milestone,
        isToday: key === utcToday.toISOString().slice(0, 10),
      });
    }
    return out;
  }, [days]);

  return (
    <div className="streak-calendar">
      <button
        type="button"
        className="pixel-font streak-calendar__title streak-collapse-toggle"
        onClick={toggle}
        aria-expanded={open}
        title={open ? 'Collapse the quest calendar' : 'Expand the quest calendar'}
      >
        <span aria-hidden>{open ? '▾' : '▸'}</span>
        <span>📅 QUEST CALENDAR</span>
      </button>
      {open && (
        <>
          <p className="term-font streak-calendar__sub">
            Every day you finish a quest lights a tile · ⭐ = 7-day bonus day (+50 coins)
          </p>
          <div className="streak-calendar__grid" role="img" aria-label="Calendar of quested days for the last ten weeks">
            {grid.map((c) => (
              <div
                key={c.date}
                className={[
                  'streak-calendar__cell',
                  c.milestone ? 'streak-calendar__cell--milestone' : c.quested ? 'streak-calendar__cell--quested' : '',
                  c.isToday ? 'streak-calendar__cell--today' : '',
                ].join(' ')}
                title={`${c.date}${c.quested ? ' — quest completed' : ''}${c.milestone ? ' · 7-day streak bonus!' : ''}`}
              >
                {c.milestone ? '⭐' : c.quested ? '🔥' : ''}
              </div>
            ))}
          </div>
          {streak && streak.longestStreak > 0 && (
            <p className="term-font streak-calendar__best">
              🕯️ current: <strong>{streak.currentStreak}</strong> · 🏆 longest: <strong>{streak.longestStreak}</strong>
            </p>
          )}
          {days !== null && days.length === 0 && (
            <p className="term-font streak-calendar__empty">No quests finished yet — today's tile awaits its flame.</p>
          )}
        </>
      )}
    </div>
  );
}
