import { useCallback, useEffect, useState } from 'react';
import * as api from './api';
import type { AuthUser, GuildInfo } from './types';
import AuthScreen from './components/AuthScreen';
import StudentDashboard from './components/StudentDashboard';
import TeacherDashboard from './components/TeacherDashboard';
import AdminPanel from './components/AdminPanel';

export default function App() {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [guild, setGuild] = useState<GuildInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [crtOn, setCrtOn] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showAdmin, setShowAdmin] = useState(false);

  const refreshUser = useCallback(async () => {
    if (!api.getToken()) {
      setLoading(false);
      return;
    }
    try {
      const me = await api.getMe();
      setUser(me.user);
      setGuild(me.guild);
    } catch (e) {
      // Bad/expired token — clear it and show the auth screen.
      api.setToken(null);
      setUser(null);
      setGuild(null);
      if (!String((e as Error).message).includes('401')) setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refreshUser();
  }, [refreshUser]);

  function signOut() {
    api.setToken(null);
    setUser(null);
    setGuild(null);
  }

  if (loading) {
    return (
      <div style={{ minHeight: '100vh', padding: '1.5rem', position: 'relative' }}>
        {crtOn && <div className="crt-overlay" />}
        <p className="pixel-font" style={{ textAlign: 'center', marginTop: '3rem', fontSize: '0.8rem' }}>
          LOADING THE REALM…
        </p>
      </div>
    );
  }

  if (!user) {
    return (
      <div style={{ minHeight: '100vh', padding: '1.5rem', position: 'relative' }}>
        {crtOn && <div className="crt-overlay" />}
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '1rem' }}>
          <button className="pixel-btn pixel-btn--ghost" onClick={() => setCrtOn(!crtOn)}>
            CRT {crtOn ? 'ON' : 'OFF'}
          </button>
        </div>
        {error && <p className="error-text" style={{ textAlign: 'center' }}>{error}</p>}
        <AuthScreen onAuthed={() => void refreshUser()} />
      </div>
    );
  }

  return (
    <div style={{ minHeight: '100vh', padding: '1.5rem', position: 'relative' }}>
      {crtOn && <div className="crt-overlay" />}
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '0.5rem' }}>
        <button className="pixel-btn pixel-btn--ghost" style={{ fontSize: '0.6rem' }} onClick={() => setCrtOn(!crtOn)}>
          CRT {crtOn ? 'ON' : 'OFF'}
        </button>
      </div>
      {error && <p className="error-text" style={{ textAlign: 'center' }}>{error}</p>}

      {showAdmin && user.role === 'admin' ? (
        <AdminPanel onExit={() => setShowAdmin(false)} />
      ) : user.role === 'teacher' ? (
        <TeacherDashboard user={user} guild={guild} onRefreshUser={refreshUser} onSignOut={signOut} />
      ) : (
        <StudentDashboard
          user={user}
          guild={guild}
          onUserUpdated={setUser}
          onSignOut={signOut}
          isAdmin={user.role === 'admin'}
          onToggleAdmin={() => setShowAdmin((v) => !v)}
        />
      )}
    </div>
  );
}
