import { useState } from 'react';
import * as api from '../api';

interface Props {
  onAuthed: () => void;
}

export default function AuthScreen({ onAuthed }: Props) {
  const [mode, setMode] = useState<'login' | 'signup'>('login');
  const [role, setRole] = useState<'teacher' | 'student'>('student');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setError(null);
    setBusy(true);
    try {
      const res = mode === 'login'
        ? await api.login(email, password)
        : await api.signup(name, email, password, role);
      api.setToken(res.token);
      onAuthed();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="title-screen" style={{ maxWidth: 480, margin: '0 auto' }}>
      <img
        src="/favicon.svg"
        alt="QuestBook logo"
        width={96}
        height={96}
        style={{ display: 'block', margin: '0 auto 0.75rem', imageRendering: 'pixelated' }}
      />
      <h1>QUESTBOOK</h1>
      <p className="term-font" style={{ fontSize: '1.3rem', color: 'var(--d-gold)' }}>
        Choose your hero. Enter the realm.
      </p>

      <div className="pixel-panel" style={{ marginTop: '1.5rem' }}>
        <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem' }}>
          <button
            className={`pixel-btn ${mode === 'login' ? 'pixel-btn--gold' : 'pixel-btn--ghost'}`}
            style={{ flex: 1 }}
            onClick={() => setMode('login')}
          >
            ENTER
          </button>
          <button
            className={`pixel-btn ${mode === 'signup' ? 'pixel-btn--gold' : 'pixel-btn--ghost'}`}
            style={{ flex: 1 }}
            onClick={() => setMode('signup')}
          >
            NEW HERO
          </button>
        </div>

        {mode === 'signup' && (
          <>
            <p className="pixel-font" style={{ fontSize: '0.6rem', margin: '0 0 0.4rem' }}>CHOOSE YOUR PATH</p>
            <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.8rem' }}>
              <button
                className={`pixel-btn ${role === 'student' ? 'pixel-btn--primary' : 'pixel-btn--ghost'}`}
                style={{ flex: 1, fontSize: '0.7rem' }}
                onClick={() => setRole('student')}
              >
                ⚔ STUDENT
              </button>
              <button
                className={`pixel-btn ${role === 'teacher' ? 'pixel-btn--primary' : 'pixel-btn--ghost'}`}
                style={{ flex: 1, fontSize: '0.7rem' }}
                onClick={() => setRole('teacher')}
              >
                🏰 TEACHER
              </button>
            </div>
            <input className="pixel-input" placeholder="Hero name" value={name} onChange={(e) => setName(e.target.value)} style={{ marginBottom: '0.5rem' }} />
          </>
        )}

        <input className="pixel-input" placeholder="Email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} style={{ marginBottom: '0.5rem' }} />
        <input className="pixel-input" placeholder="Password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && submit()} />

        {error && <p className="error-text" style={{ marginBottom: 0 }}>{error}</p>}

        <button className="pixel-btn pixel-btn--primary" style={{ width: '100%', marginTop: '0.9rem' }} onClick={submit} disabled={busy || !email || !password || (mode === 'signup' && !name)}>
          {busy ? 'SUMMONING…' : mode === 'login' ? 'ENTER THE REALM' : 'CREATE HERO'}
        </button>
      </div>

      <p className="term-font" style={{ color: 'var(--d-stone-light)', textAlign: 'center' }}>
        Teachers found guilds and set the trials. Students join with a passcode or quest solo.
      </p>
    </div>
  );
}
