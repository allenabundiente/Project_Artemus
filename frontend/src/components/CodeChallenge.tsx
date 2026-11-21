import { useEffect, useMemo, useState } from 'react';
import type { Challenge, CodeTestResult } from '../types';
import * as api from '../api';
import { sfx } from '../game/sfx';

interface Props {
  challenge: Challenge;
  /** Lock answering (used during battle animations). */
  disabled?: boolean;
  /** Called exactly once with the SERVER-verified outcome. */
  onResult: (correct: boolean) => void;
  /** Called when the player leaves the result screen. */
  onDismiss: () => void;
}

// Drafts + failed-attempt counts survive the battle's remount of this dialog,
// so a wrong submit costs a heart without throwing away the student's code.
const DRAFT_KEY = (id: string) => `qb-code-draft:${id}`;
const ATTEMPTS_KEY = (id: string) => `qb-code-attempts:${id}`;

function readStorage(key: string): string | null {
  try {
    return window.sessionStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStorage(key: string, value: string): void {
  try {
    window.sessionStorage.setItem(key, value);
  } catch {
    /* private mode / quota — the editor still works, it just forgets */
  }
}

export default function CodeChallenge({ challenge, disabled, onResult, onDismiss }: Props) {
  const starter = challenge.starterCode ?? '';
  const [code, setCode] = useState(() => readStorage(DRAFT_KEY(challenge.id)) ?? starter);
  const [attempts, setAttempts] = useState(() => Number(readStorage(ATTEMPTS_KEY(challenge.id)) ?? 0) || 0);
  const [results, setResults] = useState<CodeTestResult[] | null>(null);
  const [passed, setPassed] = useState<boolean | null>(null);
  const [running, setRunning] = useState<'run' | 'submit' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showHint, setShowHint] = useState(false);

  useEffect(() => {
    writeStorage(DRAFT_KEY(challenge.id), code);
  }, [challenge.id, code]);

  const runnerOff = challenge.codeRunnerAvailable === false;
  const lineCount = useMemo(() => Math.max(1, code.split('\n').length), [code]);
  const visibleTests = challenge.tests ?? [];
  const hiddenCount = challenge.hiddenTestCount ?? 0;
  const compileError = results?.find((r) => r.compileOutput.trim().length > 0);
  const busy = running !== null || disabled || runnerOff;

  function reset() {
    setCode(starter);
    setResults(null);
    setError(null);
    writeStorage(DRAFT_KEY(challenge.id), starter);
  }

  function onEditorKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key !== 'Tab') return;
    e.preventDefault();
    const el = e.currentTarget;
    const start = el.selectionStart;
    const end = el.selectionEnd;
    const next = `${code.slice(0, start)}  ${code.slice(end)}`;
    setCode(next);
    requestAnimationFrame(() => {
      el.selectionStart = el.selectionEnd = start + 2;
    });
  }

  async function run(sample: boolean) {
    if (busy || !code.trim()) return;
    setError(null);
    setResults(null);
    setRunning(sample ? 'run' : 'submit');
    try {
      const out = await api.runChallengeTests(challenge.id, code, sample);
      setResults(out.results);
      if (sample) return; // RUN is a dry run — it never resolves the question
      setPassed(out.passed);
      if (out.passed) {
        sfx.slash();
      } else {
        sfx.hit();
        const n = attempts + 1;
        setAttempts(n);
        writeStorage(ATTEMPTS_KEY(challenge.id), String(n));
      }
      // Only the server's verdict reaches the battle/scoring flow.
      onResult(out.passed);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setRunning(null);
    }
  }

  return (
    <div className="dialog-box code-challenge" style={{ maxWidth: 760, margin: '0 auto' }}>
      <div className="pixel-font" style={{ fontSize: '0.6rem', color: 'var(--p-yellow)', marginBottom: '0.5rem' }}>
        WRITE THE CODE · {challenge.difficulty.toUpperCase()}
      </div>

      <p style={{ marginTop: 0, whiteSpace: 'pre-wrap' }}>{challenge.prompt}</p>

      <div className="code-meta">
        <span>{challenge.language ?? 'code'}</span>
        <span>{visibleTests.length} sample {visibleTests.length === 1 ? 'test' : 'tests'}</span>
        {hiddenCount > 0 && <span>{hiddenCount} hidden</span>}
      </div>

      {runnerOff && (
        <p className="code-runner-off">
          ⚠ Code runner unavailable — your teacher must configure the code runner before these exercises can be
          checked. This challenge is skipped so the quest can continue.
        </p>
      )}

      <div className="code-editor-wrap">
        <div className="code-editor-gutter pixel-font" aria-hidden="true">
          {Array.from({ length: lineCount }, (_, i) => (
            <span key={i}>{i + 1}</span>
          ))}
        </div>
        <textarea
          className="code-editor"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          onKeyDown={onEditorKeyDown}
          spellCheck={false}
          autoCapitalize="off"
          autoCorrect="off"
          wrap="off"
          aria-label="Code editor"
          disabled={passed !== null || runnerOff}
        />
      </div>

      {error && <p className="error-text">{error}</p>}

      {results && (
        <div className="code-results">
          {compileError && (
            <pre className="code-block code-compile-error">{compileError.compileOutput}</pre>
          )}
          {results.map((r, i) => (
            <div key={`${r.name}-${i}`} className={`code-test-row ${r.passed ? 'code-test-row--pass' : 'code-test-row--fail'}`}>
              <div className="code-test-head pixel-font">
                <span>{r.passed ? '✓' : '✖'} {r.name}{r.hidden ? ' · hidden' : ''}</span>
                <span>{r.passed ? 'PASS' : (r.status || 'FAIL')}</span>
              </div>
              {!r.hidden && !r.passed && (
                <div className="code-test-detail">
                  {(r.stdin ?? '').trim() && (
                    <>
                      <span className="label">stdin</span>
                      <pre className="code-block">{r.stdin}</pre>
                    </>
                  )}
                  {r.expectedStdout !== undefined && (
                    <>
                      <span className="label">expected</span>
                      <pre className="code-block">{r.expectedStdout}</pre>
                    </>
                  )}
                  <span className="label">your output</span>
                  <pre className="code-block">{r.stdout || '(no output)'}</pre>
                  {r.stderr.trim() && (
                    <>
                      <span className="label">stderr</span>
                      <pre className="code-block">{r.stderr}</pre>
                    </>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {passed === true && (
        <div style={{ marginTop: '0.75rem' }}>
          <p className="pixel-font" style={{ fontSize: '0.7rem', color: 'var(--p-brightgreen)', margin: '0.4rem 0' }}>
            ★ ALL TESTS PASS!
          </p>
          <p style={{ color: 'var(--p-lightgray)', margin: '0.4rem 0' }}>{challenge.explanation}</p>
        </div>
      )}

      {passed === false && (
        <div style={{ marginTop: '0.75rem' }}>
          <p className="pixel-font" style={{ fontSize: '0.7rem', color: 'var(--p-red)', margin: '0.4rem 0' }}>
            ✖ NOT YET — SOME TESTS FAILED
          </p>
          {attempts >= 2 && !showHint && (
            <button className="pixel-btn pixel-btn--ghost" style={{ fontSize: '0.6rem' }} onClick={() => setShowHint(true)}>
              💡 SHOW HINT
            </button>
          )}
          {showHint && (
            <p style={{ color: 'var(--p-yellow)', margin: '0.4rem 0' }}>{challenge.explanation}</p>
          )}
        </div>
      )}

      <div className="code-actions">
        {passed === null ? (
          <>
            <button className="pixel-btn" onClick={() => void run(true)} disabled={busy || !code.trim()} title="Run against the visible sample tests only">
              {running === 'run' ? 'RUNNING…' : '▶ RUN'}
            </button>
            <button className="pixel-btn pixel-btn--primary" onClick={() => void run(false)} disabled={busy || !code.trim()} title="Run against every test and submit your answer">
              {running === 'submit' ? 'CHECKING…' : 'SUBMIT'}
            </button>
            <button className="pixel-btn pixel-btn--ghost" onClick={reset} disabled={busy}>
              ⟲ RESET
            </button>
          </>
        ) : (
          <button className="pixel-btn pixel-btn--primary" onClick={onDismiss}>
            CONTINUE ▶
          </button>
        )}
      </div>
    </div>
  );
}
