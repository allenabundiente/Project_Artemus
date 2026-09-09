import { useEffect, useState } from 'react';
import type { LessonOverview } from '../types';
import * as api from '../api';

interface Props {
  bookId: string;
  chapterId: string;
  chapterIdx: number;
  onStart: () => void;
  onBack: () => void;
}

export default function LessonScreen({ bookId, chapterId, chapterIdx, onStart, onBack }: Props) {
  const [lesson, setLesson] = useState<LessonOverview | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const l = await api.getLesson(bookId, chapterId);
        if (!cancelled) setLesson(l);
      } catch (e) {
        if (!cancelled) setError((e as Error).message);
      }
    })();
    return () => { cancelled = true; };
  }, [bookId, chapterId]);

  if (error) {
    return (
      <div className="pixel-panel" style={{ maxWidth: 640, margin: '2rem auto' }}>
        <p className="error-text">{error}</p>
        <button className="pixel-btn pixel-btn--ghost" onClick={onBack}>◀ BACK TO THE MAP</button>
      </div>
    );
  }

  if (!lesson) {
    return (
      <p className="pixel-font" style={{ textAlign: 'center', marginTop: '3rem' }}>
        UNROLLING THE SCROLL…
      </p>
    );
  }

  return (
    <div style={{ maxWidth: 720, margin: '0 auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: '0.75rem' }}>
        <p className="pixel-font" style={{ fontSize: '0.7rem', margin: 0, color: 'var(--d-gold)' }}>
          QUEST {chapterIdx + 1} BRIEFING
        </p>
        <button className="pixel-btn pixel-btn--ghost" style={{ fontSize: '0.55rem' }} onClick={onBack}>
          ◀ MAP
        </button>
      </div>

      <div className="pixel-panel" style={{ marginBottom: '1rem' }}>
        <h2 className="pixel-font" style={{ margin: '0 0 0.75rem', fontSize: '0.9rem', color: 'var(--d-gold)' }}>
          {lesson.title}
        </h2>

        {lesson.objectives.length > 0 && (
          <>
            <p className="pixel-font" style={{ fontSize: '0.6rem', margin: '0 0 0.35rem' }}>🎯 WHAT YOU'LL LEARN</p>
            <ul style={{ listStyle: 'none', padding: 0, margin: '0 0 0.9rem' }}>
              {lesson.objectives.map((o, i) => (
                <li key={i} className="term-font" style={{ fontSize: '1.05rem', margin: '0.15rem 0' }}>
                  ⚔ {o}
                </li>
              ))}
            </ul>
          </>
        )}

        {lesson.intro && (
          <>
            <p className="pixel-font" style={{ fontSize: '0.6rem', margin: '0 0 0.35rem' }}>📖 THE TALE SO FAR</p>
            <p className="term-font" style={{ fontSize: '1.05rem', lineHeight: 1.5, margin: '0 0 0.9rem' }}>
              {lesson.intro}
            </p>
          </>
        )}
      </div>

      {lesson.sections.length > 0 && (
        <div className="pixel-panel" style={{ marginBottom: '1rem' }}>
          <p className="pixel-font" style={{ fontSize: '0.6rem', margin: '0 0 0.5rem' }}>🗺 THE ROAD AHEAD</p>
          {lesson.sections.map((s, i) => (
            <div key={i} style={{ marginBottom: '0.7rem' }}>
              <p className="term-font" style={{ fontSize: '1.15rem', margin: 0, color: 'var(--d-gold)' }}>
                {i + 1}. {s.heading}
              </p>
              <p className="term-font" style={{ fontSize: '0.95rem', margin: '0.15rem 0 0', color: 'var(--d-stone-light)' }}>
                {s.summary}
              </p>
            </div>
          ))}
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '1rem' }}>
        {lesson.keyTerms.length > 0 && (
          <div className="pixel-panel">
            <p className="pixel-font" style={{ fontSize: '0.6rem', marginTop: 0 }}>🗝 WORDS OF POWER</p>
            {lesson.keyTerms.slice(0, 5).map((t, i) => (
              <div key={i} style={{ marginBottom: '0.55rem' }}>
                <p className="term-font" style={{ fontSize: '1.05rem', margin: 0, color: 'var(--d-gold)' }}>{t.term}</p>
                <p className="term-font" style={{ fontSize: '0.9rem', margin: '0.1rem 0 0' }}>{t.definition}</p>
              </div>
            ))}
          </div>
        )}

        {lesson.example && (
          <div className="pixel-panel">
            <p className="pixel-font" style={{ fontSize: '0.6rem', marginTop: 0 }}>📜 ANCIENT INSCRIPTION</p>
            <pre
              style={{
                fontFamily: 'var(--font-term, monospace)',
                fontSize: '0.75rem',
                background: 'rgba(0,0,0,0.35)',
                padding: '0.6rem',
                overflowX: 'auto',
                margin: '0 0 0.4rem',
                lineHeight: 1.45,
              }}
            >
              {lesson.example.code}
            </pre>
            <p className="term-font" style={{ fontSize: '0.85rem', color: 'var(--d-stone-light)', margin: 0 }}>
              {lesson.example.caption}
            </p>
          </div>
        )}
      </div>

      {lesson.tip && (
        <div className="pixel-panel" style={{ marginTop: '1rem', borderColor: 'var(--d-gold)' }}>
          <p className="term-font" style={{ fontSize: '1rem', margin: 0 }}>
            💡 <strong>Wise words:</strong> {lesson.tip}
          </p>
        </div>
      )}

      <button
        className="pixel-btn pixel-btn--gold"
        style={{ width: '100%', marginTop: '1.25rem', fontSize: '0.8rem', padding: '0.9rem 0' }}
        onClick={onStart}
      >
        ⚔ BEGIN THE QUEST
      </button>
      <p className="term-font" style={{ textAlign: 'center', color: 'var(--d-stone-light)', marginTop: '0.5rem' }}>
        Study the briefing — the monsters ahead will quiz you on it.
      </p>
    </div>
  );
}
