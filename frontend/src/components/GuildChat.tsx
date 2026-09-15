import { useCallback, useEffect, useRef, useState } from 'react';
import * as api from '../api';
import type { AuthUser } from '../types';
import AvatarSprite, { DEFAULT_AVATAR } from './AvatarSprite';
import RankBadge from './RankBadge';

interface Props {
  user: AuthUser;
  /** Is the user a teacher/admin (guild owner)? Controls delete permissions. */
  isTeacher: boolean;
  /**
   * docked: always-open panel on the hall page.
   * pill:   floating button that opens the panel; shows an unread badge and
   *         AUTO-OPENS when new messages arrive (unless suppressed — e.g. a
   *         quest is running — in which case they count as unread instead).
   */
  mode?: 'docked' | 'pill';
  /** Pill mode only: initial open state. */
  startOpen?: boolean;
  /** Pill mode only: when true, arrivals never auto-open (they badge instead). */
  suppressAutoOpen?: boolean;
}

/**
 * Guild Chat — polling panel for the user's guild.
 *
 * The repeat-loop bug this panel is built to avoid: naive "fetch ?since=<last>
 * and append" clients re-receive their own just-sent message (inclusive
 * backend, or millisecond cursors vs microsecond timestamps) and stack it
 * forever. Defense in depth:
 *   1. the server cursor is an opaque monotonic `seq`, so every message is
 *      delivered EXACTLY once, and
 *   2. this client merges by message ID, so a duplicate can never render
 *      twice no matter what the server does.
 */
export default function GuildChat({ user, isTeacher, mode = 'docked', startOpen = false, suppressAutoOpen = false }: Props) {
  const isPill = mode === 'pill';
  const [open, setOpen] = useState(!isPill || startOpen);
  const [unread, setUnread] = useState(0);
  const [messages, setMessages] = useState<api.ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  /** Mirror of `open` for use inside the polling callback. */
  const openRef = useRef(open);
  openRef.current = open;
  const suppressRef = useRef(suppressAutoOpen);
  suppressRef.current = suppressAutoOpen;
  /** IDs already held — the dedupe source of truth (duplicate-proof). */
  const seenIdsRef = useRef<Set<string>>(new Set());
  /**
   * Server-minted opaque cursor of the newest message we already hold. It
   * carries full precision — immune to the JSON millisecond truncation that
   * made timestamp cursors re-deliver the last message forever.
   */
  const cursorRef = useRef<string | null>(null);

  const mergeIncoming = useCallback((incoming: api.ChatMessage[]) => {
    const fresh = incoming.filter((m) => !seenIdsRef.current.has(m.id));
    if (fresh.length === 0) return 0;
    for (const m of fresh) seenIdsRef.current.add(m.id);
    setMessages((prev) => [...prev, ...fresh].sort((a, b) => a.createdAt.localeCompare(b.createdAt)));
    cursorRef.current = incoming[incoming.length - 1].cursor;
    return fresh.length;
  }, []);

  const fetchMessages = useCallback(async (polling: boolean) => {
    try {
      const cur = polling ? cursorRef.current ?? undefined : undefined;
      const res = await api.getGuildChat(cur);
      if (res.messages.length === 0) return;
      const freshCount = mergeIncoming(res.messages);
      // Badge/auto-open only for arrivals we didn't already show: the initial
      // load is "reading history", never an unread event.
      if (polling && freshCount > 0 && !openRef.current) {
        setUnread((u) => u + freshCount);
        if (!suppressRef.current) {
          // Auto-open puts the new messages on screen, so they are read
          // messages — the badge would only confuse.
          setOpen(true);
          setUnread(0);
        }
      }
    } catch (e) {
      // A failed poll must never spam the panel; only full loads report.
      if (!polling) setError((e as Error).message);
    }
  }, [mergeIncoming]);

  useEffect(() => {
    void fetchMessages(false);
    const interval = setInterval(() => void fetchMessages(true), 3000);
    return () => clearInterval(interval);
  }, [fetchMessages]);

  // Keep the newest message in view; only auto-scroll when already near bottom
  // so reading history isn't yanked around by poll arrivals.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || !open) return;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
    if (nearBottom) el.scrollTop = el.scrollHeight;
  }, [messages, open]);

  function toggle() {
    setOpen((o) => {
      // Opening OR closing both mean "caught up": what's in the log has been
      // on screen, and a fresh close implies the user just looked at it.
      setUnread(0);
      return !o;
    });
  }

  async function handleSend() {
    const text = input.trim();
    if (!text || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await api.postGuildChat(text);
      mergeIncoming([res.message]);
      // Rebase the cursor onto the server's own token for our message; a
      // skewed client clock could otherwise make the next poll skip posts.
      cursorRef.current = res.message.cursor;
      setInput('');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete(messageId: string) {
    if (!window.confirm('Delete this message?')) return;
    try {
      await api.deleteGuildChatMessage(messageId);
      setMessages((prev) => prev.filter((m) => m.id !== messageId));
    } catch (e) {
      setError((e as Error).message);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void handleSend();
    }
    if (e.key === 'Escape' && isPill) setOpen(false);
  }

  // --- collapsed pill (floating button with unread badge) --------------------------
  if (isPill && !open) {
    // Suppressed (e.g. a quest is running): render nothing at all so the pill
    // can never overlap the game — but the poller above keeps counting, so a
    // badge greets the player when they return to the hall.
    if (suppressAutoOpen) return null;
    return (
      <button type="button" className="chat-fab" onClick={toggle} aria-label={`Open guild chat${unread ? `, ${unread} unread` : ''}`}>
        💬
        {unread > 0 && <span className="chat-fab__badge">{unread > 9 ? '9+' : unread}</span>}
      </button>
    );
  }

  return (
    <div className={isPill ? 'chat-panel chat-panel--floating' : 'chat-panel'}>
      <div className="chat-panel__head">
        <p className="pixel-font chat-panel__title">💬 GUILD CHAT</p>
        {isPill && (
          <button className="pixel-btn pixel-btn--ghost chat-panel__min" onClick={toggle} aria-label="Minimize chat" title="Minimize">
            —
          </button>
        )}
      </div>

      {error && <p className="error-text" style={{ margin: '0 0 0.5rem' }}>{error}</p>}

      <div ref={scrollRef} className="chat-panel__log">
        {messages.length === 0 && (
          <p className="term-font chat-panel__empty">No messages yet. Say hello to your guild!</p>
        )}
        {messages.map((msg) => (
          <div key={msg.id} className={`chat-msg ${msg.userId === user.id ? 'chat-msg--mine' : ''}`}>
            <AvatarSprite avatar={(msg.avatar as any) ?? DEFAULT_AVATAR} size={24} title={msg.userName} />
            <div className="chat-msg__body">
              <div className="chat-msg__meta">
                <span className="term-font chat-msg__name">{msg.userName}</span>
                {msg.userRole === 'student' && <RankBadge rank={msg.rank} />}
                {msg.userRole !== 'student' && (
                  <span className="pixel-font chat-msg__role">⚔ TEACHER</span>
                )}
                <span className="term-font chat-msg__time">
                  {new Date(msg.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </span>
              </div>
              <p className="term-font chat-msg__text">{msg.message}</p>
            </div>
            {isTeacher && (
              <button
                className="pixel-btn pixel-btn--ghost chat-msg__del"
                title="Delete message"
                aria-label={`Delete message from ${msg.userName}`}
                onClick={() => void handleDelete(msg.id)}
              >
                ✕
              </button>
            )}
          </div>
        ))}
      </div>

      <div className="chat-panel__composer">
        <input
          className="pixel-input chat-panel__input"
          placeholder="Type a message…"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={busy}
          maxLength={1000}
        />
        <button
          className="pixel-btn pixel-btn--gold chat-panel__send"
          onClick={() => void handleSend()}
          disabled={busy || !input.trim()}
        >
          {busy ? '…' : 'SEND'}
        </button>
      </div>
    </div>
  );
}
