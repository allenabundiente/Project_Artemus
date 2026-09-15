import { useCallback, useEffect, useState } from 'react';
import * as api from '../api';
import type { AuthUser } from '../types';

interface Props {
  user: AuthUser;
  /** Is the user a teacher (guild owner)? Controls posting permissions. */
  isTeacher: boolean;
  /** Called when unread status changes (for parent to update badge). */
  onUnreadChange?: (hasUnread: boolean) => void;
}

/**
 * Announcements panel — one-way broadcast from teacher to guild.
 * Teachers can post/delete; students view only.
 * Shows as a medieval notice board / scroll.
 */
export default function Announcements({ user, isTeacher, onUnreadChange }: Props) {
  const [announcements, setAnnouncements] = useState<api.Announcement[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [title, setTitle] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasUnread, setHasUnread] = useState(false);

  const fetchAnnouncements = useCallback(async () => {
    try {
      const res = await api.getAnnouncements();
      setAnnouncements(res.announcements);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  const checkUnread = useCallback(async () => {
    if (isTeacher) return; // Teachers don't need unread indicators
    try {
      const res = await api.getUnreadAnnouncements();
      setHasUnread(res.hasUnread);
      onUnreadChange?.(res.hasUnread);
    } catch {
      // Silent fail
    }
  }, [isTeacher, onUnreadChange]);

  useEffect(() => {
    void fetchAnnouncements();
    void checkUnread();
  }, [fetchAnnouncements, checkUnread]);

  async function handlePost() {
    if (!title.trim() || !message.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const res = await api.postAnnouncement(title.trim(), message.trim());
      setAnnouncements((prev) => [res.announcement, ...prev]);
      setTitle('');
      setMessage('');
      setShowForm(false);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete(id: string) {
    if (!window.confirm('Delete this announcement?')) return;
    try {
      await api.deleteAnnouncement(id);
      setAnnouncements((prev) => prev.filter((a) => a.id !== id));
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function handleMarkSeen() {
    if (hasUnread) {
      await api.markAnnouncementsSeen();
      setHasUnread(false);
      onUnreadChange?.(false);
    }
  }

  // Mark as seen when student views the panel
  useEffect(() => {
    if (!isTeacher && announcements.length > 0) {
      void handleMarkSeen();
    }
  }, [announcements, isTeacher]);

  return (
    <div className="pixel-panel" style={{ position: 'relative' }}>
      {/* Unread badge for students */}
      {!isTeacher && hasUnread && (
        <span
          style={{
            position: 'absolute',
            top: -8,
            right: -8,
            background: 'var(--p-red)',
            color: 'white',
            borderRadius: '50%',
            width: 20,
            height: 20,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: '0.6rem',
            fontWeight: 'bold',
          }}
        >
          !
        </span>
      )}

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
        <p className="pixel-font" style={{ fontSize: '0.75rem', margin: 0 }}>
          📜 NOTICE BOARD
        </p>
        {isTeacher && (
          <button
            className="pixel-btn pixel-btn--ghost"
            style={{ fontSize: '0.6rem' }}
            onClick={() => setShowForm(!showForm)}
          >
            {showForm ? '✕ CANCEL' : '+ NEW'}
          </button>
        )}
      </div>

      {error && <p className="error-text" style={{ margin: '0 0 0.5rem' }}>{error}</p>}

      {/* Teacher posting form */}
      {showForm && isTeacher && (
        <div style={{ marginBottom: '1rem', padding: '0.75rem', border: '1px solid rgba(255,255,255,0.15)', borderRadius: '4px' }}>
          <input
            className="pixel-input"
            style={{ width: '100%', marginBottom: '0.5rem', fontSize: '0.85rem' }}
            placeholder="Announcement title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            maxLength={200}
          />
          <textarea
            className="pixel-input"
            style={{ width: '100%', minHeight: 80, marginBottom: '0.5rem', fontSize: '0.85rem', resize: 'vertical' }}
            placeholder="Write your announcement..."
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            maxLength={2000}
          />
          <button
            className="pixel-btn pixel-btn--gold"
            style={{ fontSize: '0.65rem' }}
            onClick={() => void handlePost()}
            disabled={busy || !title.trim() || !message.trim()}
          >
            {busy ? '...' : 'POST ANNOUNCEMENT'}
          </button>
        </div>
      )}

      {/* Announcements list */}
      {announcements.length === 0 ? (
        <p className="term-font" style={{ textAlign: 'center', color: 'var(--d-stone-light)', margin: '1rem 0' }}>
          No announcements yet.
        </p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
          {announcements.map((a) => (
            <div
              key={a.id}
              style={{
                padding: '0.75rem',
                background: 'rgba(255,215,0,0.08)',
                border: '1px solid rgba(255,215,0,0.2)',
                borderRadius: '4px',
                position: 'relative',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '0.3rem' }}>
                <h4 className="term-font" style={{ margin: 0, fontSize: '1rem', color: 'var(--d-gold)' }}>
                  {a.title}
                </h4>
                {isTeacher && (
                  <button
                    className="pixel-btn pixel-btn--ghost"
                    style={{ fontSize: '0.5rem', padding: '0.1rem 0.3rem' }}
                    title="Delete announcement"
                    onClick={() => void handleDelete(a.id)}
                  >
                    ✕
                  </button>
                )}
              </div>
              <p className="term-font" style={{ margin: '0 0 0.4rem', whiteSpace: 'pre-wrap' }}>
                {a.message}
              </p>
              <div className="term-font" style={{ fontSize: '0.75rem', color: 'var(--d-stone-light)' }}>
                — {a.teacherName} · {new Date(a.createdAt).toLocaleDateString()}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
