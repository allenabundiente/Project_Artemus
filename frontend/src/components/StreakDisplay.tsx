import { useEffect, useState } from 'react';
import * as api from '../api';

interface Props {
  /** Trigger a refresh when quest completes (pass streak data from response). */
  questStreak?: number;
  questStreakBonus?: number;
}

/**
 * Personal streak display — shows current streak with a torch/flame icon.
 * Celebrates on 7-day milestone with a special popup.
 */
export default function StreakDisplay({ questStreak, questStreakBonus }: Props) {
  const [streak, setStreak] = useState<api.StreakInfo | null>(null);
  const [showCelebration, setShowCelebration] = useState(false);
  const [celebrationBonus, setCelebrationBonus] = useState(0);

  // Fetch streak on mount
  useEffect(() => {
    void api.getStreak().then(setStreak).catch(() => {});
  }, []);

  // Handle quest completion streak update
  useEffect(() => {
    if (questStreak !== undefined && questStreakBonus !== undefined) {
      setStreak((prev) => prev ? {
        ...prev,
        currentStreak: questStreak,
        longestStreak: Math.max(prev.longestStreak, questStreak),
      } : null);

      // Show celebration on 7-day milestone
      if (questStreakBonus > 0) {
        setCelebrationBonus(questStreakBonus);
        setShowCelebration(true);
        setTimeout(() => setShowCelebration(false), 4000);
      }
    }
  }, [questStreak, questStreakBonus]);

  if (!streak || streak.currentStreak === 0) return null;

  const flameEmoji = streak.currentStreak >= 7 ? '🔥' : '🕯️';

  return (
    <>
      <div
        className="pixel-panel"
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: '0.5rem',
          padding: '0.4rem 0.8rem',
          margin: '0.5rem 0',
        }}
        title={`Longest streak: ${streak.longestStreak} days`}
      >
        <span style={{ fontSize: '1.2rem' }}>{flameEmoji}</span>
        <div>
          <span className="pixel-font" style={{ fontSize: '0.8rem', color: 'var(--d-gold)' }}>
            {streak.currentStreak}-day streak
          </span>
          {streak.longestStreak > streak.currentStreak && (
            <span className="term-font" style={{ fontSize: '0.7rem', color: 'var(--d-stone-light)', marginLeft: '0.4rem' }}>
              (best: {streak.longestStreak})
            </span>
          )}
        </div>
      </div>

      {/* 7-day milestone celebration popup */}
      {showCelebration && (
        <div
          style={{
            position: 'fixed',
            top: '50%',
            left: '50%',
            transform: 'translate(-50%, -50%)',
            zIndex: 9999,
            animation: 'fadeIn 0.3s ease-out',
          }}
        >
          <div
            className="pixel-panel"
            style={{
              padding: '1.5rem 2rem',
              textAlign: 'center',
              background: 'linear-gradient(135deg, rgba(255,215,0,0.2), rgba(255,140,0,0.2))',
              border: '2px solid var(--d-gold)',
              boxShadow: '0 0 30px rgba(255,215,0,0.3)',
            }}
          >
            <div style={{ fontSize: '3rem', marginBottom: '0.5rem' }}>🔥</div>
            <p className="pixel-font" style={{ fontSize: '1rem', margin: '0 0 0.5rem', color: 'var(--d-gold)' }}>
              STREAK MILESTONE!
            </p>
            <p className="term-font" style={{ fontSize: '1.1rem', margin: '0 0 0.5rem' }}>
              {streak.currentStreak} consecutive days!
            </p>
            <p className="pixel-font" style={{ fontSize: '0.85rem', margin: 0, color: 'var(--p-yellow)' }}>
              +{celebrationBonus} BONUS COINS
            </p>
          </div>
        </div>
      )}

      <style>{`
        @keyframes fadeIn {
          from { opacity: 0; transform: translate(-50%, -50%) scale(0.8); }
          to { opacity: 1; transform: translate(-50%, -50%) scale(1); }
        }
      `}</style>
    </>
  );
}
