import { useState } from 'react';
import * as api from '../api';
import type { Challenge } from '../types';

/** Mirror of the runner's language allowlist (JUDGE0_LANGUAGES server-side). */
const LANGUAGES = ['javascript', 'python', 'java', 'c', 'cpp', 'typescript', 'php', 'go', 'rust'];

interface TestDraft {
  name: string;
  stdin: string;
  expectedStdout: string;
  hidden: boolean;
}

interface Props {
  challenge: Challenge;
  onSaved: (challenge: Challenge) => void;
  onCancel: () => void;
}

/**
 * Teacher-side editor for one code_exercise: the task, starter code, language,
 * tests (hidden ones included) and the reference solution. The server
 * re-verifies the reference against every test before saving.
 */
export default function CodeExerciseEditor({ challenge, onSaved, onCancel }: Props) {
  const [prompt, setPrompt] = useState(challenge.prompt);
  const [starterCode, setStarterCode] = useState(challenge.starterCode ?? '');
  const [language, setLanguage] = useState(challenge.language ?? 'javascript');
  const [referenceSolution, setReferenceSolution] = useState(challenge.referenceSolution ?? '');
  const [explanation, setExplanation] = useState(challenge.explanation);
  const [tests, setTests] = useState<TestDraft[]>(() =>
    (challenge.tests ?? []).map((t) => ({
      name: t.name,
      stdin: t.stdin,
      expectedStdout: t.expectedStdout,
      hidden: t.hidden === true,
    })),
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  function updateTest(i: number, patch: Partial<TestDraft>) {
    setTests((list) => list.map((t, idx) => (idx === i ? { ...t, ...patch } : t)));
  }

  async function save() {
    setError(null);
    setNotice(null);
    setSaving(true);
    try {
      const result = await api.updateCodeExercise(challenge.id, {
        prompt,
        starterCode,
        language,
        tests,
        referenceSolution,
        explanation,
      });
      setNotice(result.verified ? 'Saved — reference solution passed every test.' : 'Saved (code runner offline, so it was not verified).');
      onSaved(result.challenge);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  const inputStyle: React.CSSProperties = { fontFamily: 'var(--font-term)', fontSize: '1rem', width: '100%' };

  return (
    <div className="pixel-panel pixel-panel--stone" style={{ marginTop: '0.6rem' }}>
      <p className="pixel-font" style={{ fontSize: '0.6rem', marginTop: 0 }}>EDIT CODE EXERCISE</p>

      <label className="term-font" style={{ fontSize: '0.9rem' }}>Task</label>
      <textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} rows={3} style={inputStyle} />

      <div style={{ display: 'flex', gap: '0.6rem', alignItems: 'center', margin: '0.5rem 0' }}>
        <label className="term-font" style={{ fontSize: '0.9rem' }}>Language</label>
        <select value={language} onChange={(e) => setLanguage(e.target.value)} style={{ ...inputStyle, width: 'auto' }}>
          {LANGUAGES.map((l) => (
            <option key={l} value={l}>{l}</option>
          ))}
        </select>
      </div>

      <label className="term-font" style={{ fontSize: '0.9rem' }}>Starter code</label>
      <textarea value={starterCode} onChange={(e) => setStarterCode(e.target.value)} rows={6} spellCheck={false} style={inputStyle} />

      <label className="term-font" style={{ fontSize: '0.9rem' }}>Reference solution (never shown to students)</label>
      <textarea value={referenceSolution} onChange={(e) => setReferenceSolution(e.target.value)} rows={6} spellCheck={false} style={inputStyle} />

      <label className="term-font" style={{ fontSize: '0.9rem' }}>Explanation (shown after a pass / as a hint)</label>
      <textarea value={explanation} onChange={(e) => setExplanation(e.target.value)} rows={2} style={inputStyle} />

      <p className="pixel-font" style={{ fontSize: '0.55rem', color: 'var(--p-yellow)', margin: '0.8rem 0 0.3rem' }}>
        TESTS · 3–5, at least one hidden
      </p>
      {tests.map((t, i) => (
        <div key={i} style={{ border: '2px solid rgba(0,0,0,0.35)', padding: '0.45rem', marginBottom: '0.4rem' }}>
          <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
            <input
              value={t.name}
              onChange={(e) => updateTest(i, { name: e.target.value })}
              placeholder={`Test ${i + 1}`}
              style={{ ...inputStyle, flex: 1 }}
            />
            <label className="term-font" style={{ fontSize: '0.85rem', whiteSpace: 'nowrap' }}>
              <input type="checkbox" checked={t.hidden} onChange={(e) => updateTest(i, { hidden: e.target.checked })} /> hidden
            </label>
            <button
              className="pixel-btn pixel-btn--ghost"
              style={{ fontSize: '0.5rem', padding: '0.2rem 0.4rem' }}
              onClick={() => setTests((list) => list.filter((_, idx) => idx !== i))}
              disabled={tests.length <= 1}
            >
              ✕
            </button>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.4rem', marginTop: '0.35rem' }}>
            <div>
              <span className="pixel-font" style={{ fontSize: '0.45rem' }}>STDIN</span>
              <textarea value={t.stdin} onChange={(e) => updateTest(i, { stdin: e.target.value })} rows={3} spellCheck={false} style={inputStyle} />
            </div>
            <div>
              <span className="pixel-font" style={{ fontSize: '0.45rem' }}>EXPECTED STDOUT</span>
              <textarea value={t.expectedStdout} onChange={(e) => updateTest(i, { expectedStdout: e.target.value })} rows={3} spellCheck={false} style={inputStyle} />
            </div>
          </div>
        </div>
      ))}
      <button
        className="pixel-btn pixel-btn--ghost"
        style={{ fontSize: '0.55rem' }}
        onClick={() => setTests((list) => [...list, { name: `Test ${list.length + 1}`, stdin: '', expectedStdout: '', hidden: false }])}
      >
        + ADD TEST
      </button>

      {error && <p className="error-text">{error}</p>}
      {notice && <p className="status-text" style={{ color: 'var(--p-brightgreen)' }}>{notice}</p>}

      <div style={{ display: 'flex', gap: '0.6rem', justifyContent: 'flex-end', marginTop: '0.7rem' }}>
        <button className="pixel-btn pixel-btn--ghost" onClick={onCancel} disabled={saving}>CANCEL</button>
        <button className="pixel-btn pixel-btn--primary" onClick={() => void save()} disabled={saving}>
          {saving ? 'VERIFYING…' : 'SAVE & VERIFY'}
        </button>
      </div>
    </div>
  );
}
