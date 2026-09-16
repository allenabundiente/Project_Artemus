import { useEffect, useState } from 'react';
import * as api from '../api';

interface Props {
  /** Streak data straight from the quest-complete response, when one lands. */
  questStreak?: number;
  questStreakBonus?: number;
}

/**
 * Personal quest streak: a candle that becomes a flame at 7 consecutive
 * days. Shows "best" when it exceeds the current run, and throws a small
 * celebration popup on every 7-day milestone (the bonus coins arrive with
 * the quest's own settlement, server-side).
 */
export default function StreakDisplay({ questStreak, questStreakBonus }: Props) {
  const [streak, setStreak] = useState<api.StreakInfo | null>(null);
  const [celebration, setCelebration] = useState<number | null>(null);

  useEffect(() => {
    void api.getStreak().then(setStreak).catch(() => { /* streak is optional chrome */ });
  }, []);

  useEffect(() => {
    if (questStreak === undefined) return;
    setStreak((prev) => (prev
      ? { ...prev, currentStreak: questStreak, longestStreak: Math.max(prev.longestStreak, questStreak) }
      : { currentStreak: questStreak, longestStreak: questStreak, lastActiveDate: new Date().toISOString() }));
    if (questStreakBonus && questStreakBonus > 0) {
      setCelebration(questStreakBonus);
      const t = setTimeout(() => setCelebration(null), 4500);
      return () => clearTimeout(t);
    }
  }, [questStreak, questStreakBonus]);

  if (!streak) return null;

  // Zero-state stays visible (unlit candle) so the feature is discoverable —
  // a brand-new student should see the streak they're about to build, guild
  // or solo. Completing a quest today lights it.
  if (streak.currentStreak === 0) {
    return (
      <span
        className="streak-chip streak-chip--idle"
        title="Complete a quest every day to build a streak — every 7th day pays bonus coins"
      >
        <span className="streak-chip__icon">🕯️</span>
        <span className="pixel-font streak-chip__label">No streak yet</span>
      </span>
    );
  }

  return (
    <>
      <span
        className="streak-chip"
        title={`Longest streak: ${streak.longestStreak} day${streak.longestStreak === 1 ? '' : 's'}`}
      >
        <span className="streak-chip__icon">{streak.currentStreak >= 7 ? '🔥' : '🕯️'}</span>
        <span className="pixel-font streak-chip__label">{streak.currentStreak}-day streak</span>
        {streak.longestStreak > streak.currentStreak && (
          <span className="term-font streak-chip__best">(best: {streak.longestStreak})</span>
        )}
      </span>

      {celebration !== null && (
        <div className="streak-celebrate" role="status">
          <div className="pixel-panel streak-celebrate__panel">
            <div style={{ fontSize: '3rem', marginBottom: '0.4rem' }}>🔥</div>
            <p className="pixel-font streak-celebrate__title">STREAK MILESTONE!</p>
            <p className="term-font streak-celebrate__sub">{streak.currentStreak} consecutive days!</p>
            <p className="pixel-font streak-celebrate__bonus">+{celebration} BONUS COINS</p>
          </div>
        </div>
      )}
    </>
  );
}
