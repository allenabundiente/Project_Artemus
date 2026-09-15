import { useCallback, useEffect, useState } from 'react';
import * as api from '../api';
import type { BookChallengeReview, Challenge } from '../types';

const TYPE_LABELS: Record<string, string> = {
  multiple_choice: 'CHOICE',
  predict_output: 'PREDICT',
  spot_the_bug: 'BUG',
  fill_in_blank: 'BLANK',
  true_false: 'TRUE/FALSE',
  short_answer: 'SHORT ANSWER',
};

interface Props {
  bookId: string;
  term: string;
  onBack: () => void;
  onRegenerated?: () => void;
}

/**
 * Teacher review feed: every challenge in a tome, with a one-click
 * "regenerate" that swaps a bad question for a freshly generated one.
 */
export default function ChallengeReview({ bookId, term, onBack, onRegenerated }: Props) {
  const [review, setReview] = useState<BookChallengeReview | null>(null);
  const [regenerating, setRegenerating] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      setReview(await api.getBookChallenges(bookId));
    } catch (e) {
      setError((e as Error).message);
    }
  }, [bookId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function handleRegenerate(c: Challenge) {
    setError(null);
    setRegenerating(c.id);
    try {
      const { challenge } = await api.regenerateChallenge(c.id, term);
      setReview((r) =>
        r
          ? {
              ...r,
              chapters: r.chapters.map((ch) => ({
                ...ch,
                challenges: ch.challenges.map((old) => (old.id === challenge.id ? challenge : old)),
              })),
            }
          : r
      );
      onRegenerated?.();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setRegenerating(null);
    }
  }

  return (
    <div style={{ maxWidth: 760, margin: '0 auto' }}>
      <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', marginBottom: '0.75rem' }}>
        <button className="pixel-btn pixel-btn--ghost" style={{ fontSize: '0.6rem' }} onClick={onBack}>
          ◀ HALL
        </button>
        <p className="pixel-font" style={{ fontSize: '0.8rem', margin: 0 }}>CHALLENGE REVIEW</p>
        <button className="pixel-btn pixel-btn--ghost" style={{ fontSize: '0.55rem', marginLeft: 'auto' }} onClick={() => void load()}>
          ⟳ REFRESH
        </button>
      </div>

      {error && <p className="error-text">{error}</p>}
      {!review && !error && <p className="status-text">Reading the tome…</p>}

      {review?.chapters.map((ch) => (
        <div key={ch.chapterId} className="pixel-panel" style={{ marginBottom: '1rem' }}>
          <p className="pixel-font" style={{ fontSize: '0.7rem', marginTop: 0 }}>
            {ch.title.toUpperCase()} ({ch.challenges.length})
          </p>
          {ch.challenges.length === 0 && <p className="status-text" style={{ margin: 0 }}>No challenges in this chapter yet.</p>}
          {ch.challenges.map((c) => (
            <div
              key={c.id}
              className="leaderboard-row"
              style={{ alignItems: 'flex-start', opacity: regenerating === c.id ? 0.5 : 1 }}
            >
              <div style={{ flex: 1, minWidth: 0 }}>
                <p className="pixel-font" style={{ fontSize: '0.5rem', color: 'var(--d-stone-light)', margin: '0 0 0.2rem' }}>
                  {TYPE_LABELS[c.type] ?? c.type.toUpperCase()} · {c.difficulty.toUpperCase()}
                </p>
                <p className="term-font" style={{ fontSize: '1rem', margin: 0, whiteSpace: 'pre-wrap' }}>{c.prompt}</p>
                {c.code && <pre className="code-block" style={{ fontSize: '0.6rem' }}>{c.code}</pre>}
                {c.options && (
                  <p className="term-font" style={{ fontSize: '0.85rem', color: 'var(--d-stone-light)', margin: '0.2rem 0 0' }}>
                    {c.options.join(' · ')}
                  </p>
                )}
                <p className="term-font" style={{ fontSize: '0.85rem', color: 'var(--p-yellow)', margin: '0.2rem 0 0' }}>
                  Answer: {c.correctAnswer}
                </p>
              </div>
              <button
                className="pixel-btn pixel-btn--ghost"
                style={{ fontSize: '0.55rem', padding: '0.25rem 0.5rem', flexShrink: 0 }}
                disabled={regenerating !== null}
                title="Discard this challenge and summon a fresh one from the same chapter"
                onClick={() => void handleRegenerate(c)}
              >
                {regenerating === c.id ? '…' : '⟳ RE-SUMMON'}
              </button>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
