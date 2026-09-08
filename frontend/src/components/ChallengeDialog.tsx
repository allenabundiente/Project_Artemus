import { useMemo, useRef, useState } from 'react';
import type { Challenge } from '../types';

interface Props {
  challenge: Challenge;
  /** Called exactly once when the player submits an answer. */
  onResult: (correct: boolean) => void;
  /** Called when the player dismisses the result screen. */
  onDismiss: () => void;
  /** Lock answering (used during battle animations). */
  disabled?: boolean;
}

function normalize(s: string): string {
  return s
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/^(a|an|the)\s+/, '')
    .replace(/[.!?]+$/, '');
}

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export default function ChallengeDialog({ challenge, onResult, onDismiss, disabled }: Props) {
  const [picked, setPicked] = useState<string | null>(null);
  const textRef = useRef<HTMLInputElement>(null);
  const [hasText, setHasText] = useState(false);
  const [result, setResult] = useState<boolean | null>(null);
  const submittedRef = useRef(false);

  const options = useMemo(() => (challenge.options ? shuffle(challenge.options) : null), [challenge]);

  function submit() {
    if (submittedRef.current || disabled) return;
    let isCorrect: boolean;
    if (options) {
      isCorrect = picked === challenge.correctAnswer;
    } else {
      isCorrect = normalize(textRef.current?.value ?? '') === normalize(challenge.correctAnswer);
    }
    submittedRef.current = true;
    setResult(isCorrect);
    onResult(isCorrect);
  }

  const typeLabel: Record<string, string> = {
    multiple_choice: 'CHOOSE WISELY',
    predict_output: 'PREDICT THE OUTCOME',
    spot_the_bug: 'SPOT THE BUG',
    fill_in_blank: 'FILL IN THE BLANK',
  };

  return (
    <div className="dialog-box" style={{ maxWidth: 640, margin: '0 auto' }}>
      <div className="pixel-font" style={{ fontSize: '0.6rem', color: 'var(--p-yellow)', marginBottom: '0.6rem' }}>
        {typeLabel[challenge.type] ?? 'CHALLENGE'} · {challenge.difficulty.toUpperCase()}
      </div>

      <p style={{ marginTop: 0, whiteSpace: 'pre-wrap' }}>{challenge.prompt}</p>

      {challenge.code && <pre className="code-block">{challenge.code}</pre>}

      {result === null && options && (
        <div style={{ display: 'grid', gap: '0.4rem', marginTop: '0.75rem' }}>
          {options.map((opt, i) => (
            <button
              key={i}
              className={`option-btn ${picked === opt ? 'option-btn--correct' : ''}`}
              onClick={() => setPicked(opt)}
              disabled={disabled}
            >
              {String.fromCharCode(65 + i)}. {opt}
            </button>
          ))}
        </div>
      )}

      {result === null && !options && (
        <input
          ref={textRef}
          defaultValue=""
          onInput={() => setHasText(!!textRef.current?.value.trim())}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.target as HTMLInputElement).value.trim()) submit();
          }}
          placeholder="Type your answer…"
          className="option-btn"
          style={{ marginTop: '0.75rem' }}
          disabled={disabled}
        />
      )}

      {result !== null && (
        <div style={{ marginTop: '0.75rem' }}>
          <p
            className="pixel-font"
            style={{
              fontSize: '0.7rem',
              color: result ? 'var(--p-brightgreen)' : 'var(--p-red)',
              margin: '0.4rem 0',
            }}
          >
            {result ? '★ CORRECT!' : '✖ WRONG!'}
          </p>
          {!result && (
            <p style={{ color: 'var(--p-yellow)', margin: '0.4rem 0' }}>
              Answer: <strong>{challenge.correctAnswer}</strong>
            </p>
          )}
          <p style={{ color: 'var(--p-lightgray)', margin: '0.4rem 0' }}>{challenge.explanation}</p>
        </div>
      )}

      <div style={{ display: 'flex', gap: '0.75rem', marginTop: '0.9rem', justifyContent: 'flex-end' }}>
        {result === null && (
          <button
            className="pixel-btn"
            onClick={submit}
            disabled={disabled || (options ? picked === null : !hasText)}
          >
            ANSWER
          </button>
        )}
        {result !== null && (
          <button className="pixel-btn pixel-btn--primary" onClick={onDismiss}>
            CONTINUE ▶
          </button>
        )}
      </div>
    </div>
  );
}