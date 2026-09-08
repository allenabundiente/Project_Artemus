import type { BookDetail, Progress, Term } from '../types';

interface Props {
  book: BookDetail;
  progress: Progress;
  term: Term;
  onEnterLevel: (chapterId: string, chapterIdx: number) => void;
}

export default function WorldMap({ book, progress, term, onEnterLevel }: Props) {
  const done = new Set(progress.completedChapters);
  const firstOpen = book.chapters.find((c) => !done.has(c.id));

  function nodeState(idx: number, chapterId: string): 'done' | 'open' | 'locked' {
    if (done.has(chapterId)) return 'done';
    if (idx === 0) return 'open';
    const prev = book.chapters[idx - 1];
    if (prev && done.has(prev.id)) return 'open';
    return 'locked';
  }

  return (
    <div style={{ maxWidth: 860, margin: '0 auto' }}>
      <div className="hud" style={{ marginBottom: '1rem', flexWrap: 'wrap' }}>
        <span>
          <span className="label">TOME:</span> {book.title}
        </span>
        <span>
          <span className="label">SCORE:</span> {progress.score}
        </span>
        <span>
          <span className="label">STREAK:</span> {progress.bestStreak}
        </span>
        <span>
          <span className="label">QUESTS:</span> {done.size}/{book.chapters.length}
        </span>
        <span>
          <span className="label">TERM:</span> {term.toUpperCase()}
        </span>
      </div>

      <div className="pixel-panel">
        <p className="pixel-font" style={{ fontSize: '0.8rem', marginTop: 0 }}>🗺 REALM MAP</p>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '1.1rem', alignItems: 'center' }}>
          {book.chapters.map((ch, idx) => {
            const state = nodeState(idx, ch.id);
            const isCurrent = firstOpen && ch.id === firstOpen.id;
            return (
              <div key={ch.id} style={{ display: 'flex', alignItems: 'center', gap: '1.1rem' }}>
                <div style={{ textAlign: 'center' }}>
                  <button
                    className={`map-node map-node--${state} ${isCurrent ? 'map-node--current' : ''}`}
                    disabled={state === 'locked'}
                    title={state === 'locked' ? 'Clear the previous quest first' : ch.title}
                    onClick={() => onEnterLevel(ch.id, idx)}
                  >
                    {state === 'locked' ? '✕' : state === 'done' ? '★' : idx + 1}
                  </button>
                  <div
                    className="term-font"
                    style={{ fontSize: '0.95rem', maxWidth: 110, color: 'var(--d-skin)', marginTop: '0.3rem' }}
                  >
                    {ch.title.length > 26 ? ch.title.slice(0, 24) + '…' : ch.title}
                  </div>
                  {ch.challengeCount === 0 && state !== 'locked' && (
                    <div className="term-font" style={{ color: 'var(--d-rose)', fontSize: '0.85rem' }}>
                      no monsters
                    </div>
                  )}
                </div>
                {idx < book.chapters.length - 1 && (
                  <span className="pixel-font" style={{ color: 'var(--d-orange)' }}>···</span>
                )}
              </div>
            );
          })}
        </div>
        {firstOpen && (
          <p className="status-text" style={{ marginBottom: 0 }}>
            ▸ NEXT QUEST: {firstOpen.title}
          </p>
        )}
        {!firstOpen && (
          <p className="status-text" style={{ marginBottom: 0 }}>
            ★ ALL QUESTS CLEAR — the tome is conquered!
          </p>
        )}
      </div>

      <p className="term-font" style={{ color: 'var(--d-stone-light)' }}>
        Controls: ←/→ or A/D to move · Space/↑/W to jump. Strike a monster to face its challenge. Wrong answers cost a heart. Reach the castle gate to wake the dungeon boss.
      </p>
    </div>
  );
}
