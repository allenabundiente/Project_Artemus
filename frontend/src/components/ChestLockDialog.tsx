import { useEffect, useRef, useState } from 'react';
import type { DungeonEvent } from '../types';
import { sfx } from '../game/sfx';

interface Props {
  event: DungeonEvent;
  /** Called once with the outcome. won=true charges surge + drops a key. */
  onResult: (won: boolean) => void;
}

/**
 * Hangaroo-style word completion: guess the target word letter by letter.
 * Wrong letters cost a mistake; running out of allowed mistakes fails the
 * chest (the engine applies the damage).
 */
export default function ChestLockDialog({ event, onResult }: Props) {
  const word = (event.data.target_word ?? 'QUEST').toUpperCase();
  const allowed = event.data.allowed_mistakes ?? 3;
  const hint = event.data.hint ?? 'Complete the word.';

  const [guessed, setGuessed] = useState<Set<string>>(new Set());
  const [mistakes, setMistakes] = useState(0);
  const [done, setDone] = useState<null | boolean>(null);
  const resolvedRef = useRef(false);

  // Keyboard support: A–Z guesses.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (done !== null) return;
      const letter = e.key.toUpperCase();
      if (/^[A-Z]$/.test(letter)) guess(letter);
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [done, guessed, mistakes]);

  function guess(letter: string) {
    if (done !== null || resolvedRef.current || guessed.has(letter)) return;
    const next = new Set(guessed).add(letter);
    setGuessed(next);
    if (word.includes(letter)) {
      sfx.coin();
      if ([...word].every((ch) => next.has(ch))) {
        resolvedRef.current = true;
        setDone(true);
        sfx.slash();
      }
    } else {
      sfx.hit();
      const m = mistakes + 1;
      setMistakes(m);
      if (m >= allowed) {
        resolvedRef.current = true;
        setDone(false);
      }
    }
  }

  const rows = word.split('').map((ch, i) => ({ ch, i }));
  const remaining = Math.max(0, allowed - mistakes);
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');

  return (
    <div className="dialog-box" style={{ maxWidth: 640, margin: '0 auto' }}>
      <div className="pixel-font" style={{ fontSize: '0.6rem', color: 'var(--d-gold)', marginBottom: '0.6rem' }}>
        🔒 CHEST LOCK
      </div>
      <p style={{ marginTop: 0 }}>{hint}</p>

      {done === null && (
        <>
          <div style={{ display: 'flex', gap: '0.3rem', justifyContent: 'center', flexWrap: 'wrap', margin: '1rem 0' }}>
            {[...word].map((ch, i) => (
              <span
                key={i}
                className="pixel-font"
                style={{
                  width: 26, height: 34, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                  background: 'var(--p-black, #140d0a)', border: '2px solid var(--d-gold)', fontSize: '1rem',
                  color: guessed.has(ch) ? 'var(--d-gold-bright)' : 'transparent',
                }}
              >
                {guessed.has(ch) ? ch : '_'}
              </span>
            ))}
          </div>
          <p className="term-font" style={{ color: mistakes === allowed - 1 ? 'var(--d-rose)' : 'var(--d-stone-light)', margin: '0 0 0.6rem' }}>
            Mistakes left: {remaining}
          </p>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.25rem', justifyContent: 'center' }}>
            {alphabet.map((L) => {
              const isGuessed = guessed.has(L);
              const inWord = word.includes(L);
              return (
                <button
                  key={L}
                  className={`pixel-btn ${isGuessed ? (inWord ? 'pixel-btn--gold' : 'pixel-btn--ghost') : ''}`}
                  style={{ fontSize: '0.7rem', padding: '0.35rem 0.5rem', width: 38, opacity: isGuessed ? 0.45 : 1 }}
                  onClick={() => guess(L)}
                  disabled={isGuessed}
                >
                  {L}
                </button>
              );
            })}
          </div>
        </>
      )}

      {done === true && (
        <p className="pixel-font" style={{ color: 'var(--p-brightgreen)', fontSize: '0.8rem' }}>
          ★ {word} — THE CHEST OPENS! ({event.data.reward ?? 'Gold'} inside)
        </p>
      )}
      {done === false && (
        <p className="pixel-font" style={{ color: 'var(--p-red)', fontSize: '0.8rem' }}>
          ✖ The lock jams! The word was <strong style={{ color: 'var(--d-gold)' }}>{word}</strong>.
        </p>
      )}

      {done !== null && (
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '0.9rem' }}>
          <button className="pixel-btn pixel-btn--primary" onClick={() => onResult(done)}>
            CONTINUE ▶
          </button>
        </div>
      )}
    </div>
  );
}
