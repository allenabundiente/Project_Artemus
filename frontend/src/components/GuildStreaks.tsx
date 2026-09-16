import { useEffect, useState } from 'react';
import * as api from '../api';
import type { AvatarPrefs } from '../types';
import AvatarSprite, { DEFAULT_AVATAR } from './AvatarSprite';

/**
 * Guild streak standings — makes daily questing competitive: every member's
 * CURRENT streak (the live run) vs their LONGEST ever, who has quested today,
 * and medals for the top three. Solo adventurers see a hint instead — streaks
 * are personal until they join a guild.
 */
export default function GuildStreaks({ inGuild, currentUserId }: { inGuild: boolean; currentUserId: string }) {
  const [data, setData] = useState<api.GuildStreakEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Collapsible like the quest calendar; collapsed by default so the hall
  // leads with quests, not standings. Choice persists per session.
  const [open, setOpen] = useState(() => {
    try { return localStorage.getItem('guild-streaks-open') === '1'; } catch { return false; }
  });

  function toggle() {
    setOpen((o) => {
      try { localStorage.setItem('guild-streaks-open', o ? '0' : '1'); } catch { /* private mode */ }
      return !o;
    });
  }

  useEffect(() => {
    // Fetch lazily on first expand — no standings traffic while collapsed.
    if (!inGuild || !open || data !== null) return;
    void api.getGuildStreaks()
      .then((r) => setData(r.entries))
      .catch((e) => setError((e as Error).message));
  }, [inGuild, open, data]);

  if (!inGuild) {
    return (
      <div className="pixel-panel" style={{ maxWidth: 640, margin: '0 auto' }}>
        <p className="pixel-font" style={{ fontSize: '0.8rem', marginTop: 0 }}>🔥 GUILD STREAKS</p>
        <p className="term-font" style={{ margin: 0, color: 'var(--d-stone-light)' }}>
          Join a guild to see who keeps the longest flame — members' current and longest streaks race here every day.
        </p>
      </div>
    );
  }

  const medal = (i: number) => (i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `${i + 1}.`);

  return (
    <div className="pixel-panel" style={{ maxWidth: 640, margin: '0 auto' }}>
      <button
        type="button"
        className="pixel-font streak-collapse-toggle"
        onClick={toggle}
        aria-expanded={open}
        title={open ? 'Collapse the guild standings' : 'Expand the guild standings'}
        style={{ fontSize: '0.8rem', marginTop: 0, marginBottom: 0 }}
      >
        <span aria-hidden>{open ? '▾' : '▸'}</span>
        <span>🔥 GUILD STREAKS</span>
      </button>
      {open && (
        <>
          <p className="term-font" style={{ margin: '0.2rem 0 0.7rem', color: 'var(--d-stone-light)' }}>
            Who is keeping the flame? Finish a quest TODAY to climb — ties go to the all-time best.
          </p>
          {error && <p className="error-text" style={{ margin: 0 }}>{error}</p>}
          {data === null && !error && <p className="status-text" style={{ margin: 0 }}>Summoning the standings…</p>}
          {data !== null && data.length === 0 && (
            <p className="status-text" style={{ margin: 0 }}>No guild members yet — share the guild code!</p>
          )}
          {data !== null && data.length > 0 && (
            <ul className="streak-board__list" style={{ listStyle: 'none', padding: 0, margin: 0 }}>
              {data.map((e, i) => (
                <li key={e.userId} className={`streak-board__row${e.userId === currentUserId ? ' streak-board__row--me' : ''}`}>
                  <span className="streak-board__rank" aria-hidden>{medal(i)}</span>
                  <AvatarSprite avatar={(e.avatar as unknown as AvatarPrefs) ?? DEFAULT_AVATAR} size={24} title={`${e.name}'s heraldic avatar`} />
                  <span className="streak-board__name" title={e.name}>{e.name}</span>
                  <span className="streak-board__flames" title="Current streak">
                    {e.currentStreak > 0 ? `🔥 ${e.currentStreak}` : '—'}
                  </span>
                  <span className="streak-board__best" title="Longest streak ever">
                    🏆 {e.longestStreak}
                  </span>
                  <span
                    className={`streak-board__today ${e.questedToday ? 'streak-board__today--done' : ''}`}
                    title={e.questedToday ? 'Quested today' : 'Has not quested today — catchable!'}
                  >
                    {e.questedToday ? '✓ today' : '· today open'}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}
