import { useCallback, useEffect, useState } from 'react';
import * as api from '../api';
import type { AuthUser } from '../types';

interface Props {
  user: AuthUser;
  /** Is the user a teacher/admin (guild owner)? Controls posting permissions. */
  isTeacher: boolean;
  /** Called when unread status changes (parent drives a nav badge). */
  onUnreadChange?: (hasUnread: boolean) => void;
}

/**
 * Announcements — the guild's notice board: a one-way broadcast from the
 * teacher. Teachers post/delete; students view and get an unread indicator
 * until they open the board (last-seen is stored in user preferences).
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
    if (isTeacher) return; // teachers write the board; they don't need an unread dot
    try {
      const res = await api.getUnreadAnnouncements();
      setHasUnread(res.hasUnread);
      onUnreadChange?.(res.hasUnread);
    } catch {
      // silent — the dot is a nicety, not a guarantee
    }
  }, [isTeacher, onUnreadChange]);

  useEffect(() => {
    void fetchAnnouncements();
    void checkUnread();
  }, [fetchAnnouncements, checkUnread]);

  // Viewing the board marks it seen (students only).
  useEffect(() => {
    if (isTeacher || announcements.length === 0) return;
    void api.markAnnouncementsSeen().then(() => {
      setHasUnread(false);
      onUnreadChange?.(false);
    }).catch(() => { /* best-effort */ });
  }, [isTeacher, announcements.length, onUnreadChange]);

  async function handlePost() {
    if (!title.trim() || !message.trim() || busy) return;
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

  return (
    <div className="pixel-panel notice-board">
      {!isTeacher && hasUnread && <span className="notice-board__dot" aria-label="New announcements">!</span>}

      <div className="notice-board__head">
        <p className="pixel-font notice-board__title">📜 NOTICE BOARD</p>
        {isTeacher && (
          <button className="pixel-btn pixel-btn--ghost" style={{ fontSize: '0.6rem' }} onClick={() => setShowForm(!showForm)}>
            {showForm ? '✕ CANCEL' : '+ NEW'}
          </button>
        )}
      </div>

      {error && <p className="error-text" style={{ margin: '0 0 0.5rem' }}>{error}</p>}

      {showForm && isTeacher && (
        <div className="notice-board__form">
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
            placeholder="Write your announcement…"
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
            {busy ? '…' : 'POST ANNOUNCEMENT'}
          </button>
        </div>
      )}

      {announcements.length === 0 ? (
        <p className="term-font notice-board__empty">No announcements yet.</p>
      ) : (
        <div className="notice-board__list">
          {announcements.map((a) => (
            <div key={a.id} className="notice-board__item">
              <div className="notice-board__item-head">
                <h4 className="term-font notice-board__item-title">{a.title}</h4>
                {isTeacher && (
                  <button
                    className="pixel-btn pixel-btn--ghost notice-board__del"
                    title="Delete announcement"
                    onClick={() => void handleDelete(a.id)}
                  >
                    ✕
                  </button>
                )}
              </div>
              <p className="term-font notice-board__item-text">{a.message}</p>
              <div className="term-font notice-board__item-by">— {a.teacherName} · {new Date(a.createdAt).toLocaleDateString()}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
