import { useState } from 'react';
import type { DungeonEvent } from '../types';
import { sfx } from '../game/sfx';

interface Props {
  event: DungeonEvent;
  onResult: (won: boolean) => void;
}

/**
 * Rune Socket: reorder scrambled blocks (code lines in CODING mode, sentence
 * fragments in GENERAL mode) into the correct sequence. Click a block to move
 * it into the answer row; click an answer block to send it back. Number keys
 * 1–n pick from the scramble; Enter submits when the answer row is full.
 */
export default function RuneSocketDialog({ event, onResult }: Props) {
  const scrambled = event.data.scrambled_items ?? [];
  const correct = event.data.correct_sequence ?? [];
  const prompt = event.data.prompt ?? 'Arrange the blocks in the correct order:';

  const [taken, setTaken] = useState<number[]>([]); // indices into scrambled
  const [result, setResult] = useState<null | boolean>(null);

  function take(i: number) {
    if (result !== null || taken.includes(i)) return;
    sfx.jump();
    setTaken([...taken, i]);
  }

  function putBack(i: number) {
    if (result !== null) return;
    setTaken(taken.filter((t) => t !== i));
  }

  function submit() {
    if (result !== null || taken.length !== scrambled.length) return;
    const attempt = taken.map((i) => scrambled[i]);
    const won = attempt.every((s, idx) => s === correct[idx]);
    if (won) sfx.slash();
    else sfx.hit();
    setResult(won);
  }

  return (
    <div className="dialog-box" style={{ maxWidth: 640, margin: '0 auto' }}>
      <div className="pixel-font" style={{ fontSize: '0.6rem', color: 'var(--d-steel, #7fb3cb)', marginBottom: '0.6rem' }}>
        🔮 RUNE SOCKET
      </div>
      <p style={{ marginTop: 0 }}>{prompt}</p>

      {result === null && (
        <>
          {/* Answer row: the sequence being built (top → bottom = first → last) */}
          <div style={{ display: 'grid', gap: '0.4rem', margin: '0.75rem 0', minHeight: '2.4rem' }}>
            {correct.map((_, slot) => {
              const takenIdx = taken[slot];
              return (
                <button
                  key={slot}
                  className="option-btn"
                  style={{ opacity: takenIdx === undefined ? 0.35 : 1, textAlign: 'left' }}
                  onClick={() => takenIdx !== undefined && putBack(takenIdx)}
                  disabled={takenIdx === undefined}
                >
                  {slot + 1}. {takenIdx !== undefined ? scrambled[takenIdx] : '— empty —'}
                </button>
              );
            })}
          </div>

          <div style={{ borderTop: '1px solid rgba(255,255,255,0.12)', margin: '0.6rem 0' }} />

          {/* Scramble pool */}
          <div style={{ display: 'grid', gap: '0.4rem' }}>
            {scrambled.map((item, i) => (
              <button
                key={i}
                className="option-btn"
                style={{ opacity: taken.includes(i) ? 0.25 : 1, textAlign: 'left' }}
                onClick={() => take(i)}
                disabled={taken.includes(i)}
              >
                {item}
              </button>
            ))}
          </div>
        </>
      )}

      {result === true && (
        <p className="pixel-font" style={{ color: 'var(--p-brightgreen)', fontSize: '0.8rem', marginTop: '0.75rem' }}>
          ★ THE RUNES ALIGN!
        </p>
      )}
      {result === false && (
        <>
          <p className="pixel-font" style={{ color: 'var(--p-red)', fontSize: '0.8rem', marginTop: '0.75rem' }}>
            ✖ THE RUNES SHATTER!
          </p>
          <p style={{ color: 'var(--p-yellow)', margin: '0.4rem 0' }}>
            Correct order:
          </p>
          <ol style={{ margin: '0 0 0.5rem 1.2rem', padding: 0 }}>
            {correct.map((c, i) => (
              <li key={i} style={{ fontFamily: 'var(--font-term, monospace)', fontSize: '1.05rem' }}>{c}</li>
            ))}
          </ol>
        </>
      )}

      <div style={{ display: 'flex', gap: '0.75rem', marginTop: '0.9rem', justifyContent: 'flex-end' }}>
        {result === null ? (
          <button
            className="pixel-btn"
            onClick={submit}
            disabled={taken.length !== scrambled.length}
            title="Click blocks above into the slots, then submit"
          >
            SUBMIT SEQUENCE
          </button>
        ) : (
          <button className="pixel-btn pixel-btn--primary" onClick={() => onResult(result)}>
            CONTINUE ▶
          </button>
        )}
      </div>
    </div>
  );
}
