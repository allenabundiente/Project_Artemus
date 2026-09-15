import { useCallback, useEffect, useRef, useState } from 'react';
import * as api from '../api';
import type { AuthUser } from '../types';
import AvatarSprite, { DEFAULT_AVATAR } from './AvatarSprite';
import RankBadge from './RankBadge';

interface Props {
  user: AuthUser;
  /** Is the user a teacher (guild owner)? Controls delete permissions. */
  isTeacher: boolean;
}

/**
 * Guild Chat panel — simple polling-based MVP.
 * TODO: upgrade to Supabase Realtime for true push notifications.
 * Polls every 3 seconds for new messages when the panel is open.
 */
export default function GuildChat({ user, isTeacher }: Props) {
  const [messages, setMessages] = useState<api.ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const lastMessageTime = useRef<string | null>(null);

  // Fetch messages (initial load + polling)
  const fetchMessages = useCallback(async (polling = false) => {
    try {
      const since = polling && lastMessageTime.current ? lastMessageTime.current : undefined;
      const res = await api.getGuildChat(since);
      if (res.messages.length > 0) {
        if (polling && lastMessageTime.current) {
          // Append new messages
          setMessages((prev) => [...prev, ...res.messages]);
        } else {
          // Initial load or full refresh
          setMessages(res.messages);
        }
        lastMessageTime.current = res.messages[res.messages.length - 1].createdAt;
      }
    } catch (e) {
      // Silently fail on poll — don't spam errors
      if (!polling) setError((e as Error).message);
    }
  }, []);

  // Initial fetch
  useEffect(() => {
    void fetchMessages(false);
  }, [fetchMessages]);

  // Poll every 3 seconds
  useEffect(() => {
    const interval = setInterval(() => {
      void fetchMessages(true);
    }, 3000);
    return () => clearInterval(interval);
  }, [fetchMessages]);

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  async function handleSend() {
    const text = input.trim();
    if (!text) return;
    setBusy(true);
    setError(null);
    try {
      const res = await api.postGuildChat(text);
      setMessages((prev) => [...prev, res.message]);
      lastMessageTime.current = res.message.createdAt;
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
  }

  return (
    <div className="pixel-panel" style={{ display: 'flex', flexDirection: 'column', height: '400px' }}>
      <p className="pixel-font" style={{ fontSize: '0.75rem', marginTop: 0, marginBottom: '0.5rem' }}>
        💬 GUILD CHAT
      </p>

      {error && <p className="error-text" style={{ margin: '0 0 0.5rem' }}>{error}</p>}

      {/* Message list */}
      <div
        ref={scrollRef}
        style={{
          flex: 1,
          overflowY: 'auto',
          padding: '0.5rem',
          border: '1px solid rgba(255,255,255,0.1)',
          borderRadius: '4px',
          marginBottom: '0.5rem',
          background: 'rgba(0,0,0,0.2)',
        }}
      >
        {messages.length === 0 && (
          <p className="term-font" style={{ textAlign: 'center', color: 'var(--d-stone-light)', margin: '2rem 0' }}>
            No messages yet. Say hello to your guild!
          </p>
        )}
        {messages.map((msg) => (
          <div
            key={msg.id}
            style={{
              display: 'flex',
              gap: '0.5rem',
              marginBottom: '0.75rem',
              padding: '0.4rem',
              background: msg.userId === user.id ? 'rgba(255,215,0,0.1)' : 'rgba(255,255,255,0.05)',
              borderRadius: '4px',
              position: 'relative',
            }}
          >
            <AvatarSprite avatar={(msg.avatar as any) ?? DEFAULT_AVATAR} size={24} title={msg.userName} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', marginBottom: '0.15rem' }}>
                <span className="term-font" style={{ fontWeight: 'bold', fontSize: '0.85rem' }}>
                  {msg.userName}
                </span>
                {msg.userRole === 'student' && <RankBadge rank={msg.rank} />}
                {msg.userRole === 'teacher' && (
                  <span className="pixel-font" style={{ fontSize: '0.5rem', color: 'var(--d-gold)' }}>⚔ TEACHER</span>
                )}
                <span className="term-font" style={{ fontSize: '0.7rem', color: 'var(--d-stone-light)' }}>
                  {new Date(msg.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </span>
              </div>
              <p className="term-font" style={{ margin: 0, wordBreak: 'break-word' }}>
                {msg.message}
              </p>
            </div>
            {isTeacher && (
              <button
                className="pixel-btn pixel-btn--ghost"
                style={{ fontSize: '0.5rem', padding: '0.1rem 0.3rem', alignSelf: 'flex-start' }}
                title="Delete message"
                onClick={() => void handleDelete(msg.id)}
              >
                ✕
              </button>
            )}
          </div>
        ))}
      </div>

      {/* Input */}
      <div style={{ display: 'flex', gap: '0.5rem' }}>
        <input
          className="pixel-input"
          style={{ flex: 1, fontSize: '0.85rem' }}
          placeholder="Type a message..."
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={busy}
          maxLength={1000}
        />
        <button
          className="pixel-btn pixel-btn--gold"
          style={{ fontSize: '0.7rem' }}
          onClick={() => void handleSend()}
          disabled={busy || !input.trim()}
        >
          {busy ? '...' : 'SEND'}
        </button>
      </div>
    </div>
  );
}
