import { useCallback, useEffect, useRef, useState } from 'react';
import * as api from '../api';
import type { AuthUser, BookDetail, BookMeta, GuildInfo, Progress, Term } from '../types';
import { spriteDataUrl } from '../game/sprites';
import { rankForScore } from '../game/ranks';
import RankBadge from './RankBadge';
import AvatarSprite, { DEFAULT_AVATAR } from './AvatarSprite';
import WorldMap from './WorldMap';
import LevelScreen from './LevelScreen';
import LessonScreen from './LessonScreen';
import Leaderboard from './Leaderboard';
import Shop from './Shop';
import Wardrobe from './Wardrobe';
import RoyalGate from './RoyalGate';

interface Props {
  user: AuthUser;
  guild: GuildInfo | null;
  onUserUpdated: (user: AuthUser) => void;
  onSignOut: () => void;
  /** Admins get a crown button toggling the royal panel. */
  isAdmin?: boolean;
  onToggleAdmin?: () => void;
}

type View =
  | { name: 'home' }
  | { name: 'map'; bookId: string }
  | { name: 'lesson'; bookId: string; chapterId: string; chapterIdx: number }
  | { name: 'level'; bookId: string; chapterId: string; chapterIdx: number }
  | { name: 'leaderboard' }
  | { name: 'shop' }
  | { name: 'wardrobe' };

export default function StudentDashboard({ user: userProp, guild, onUserUpdated, onSignOut, isAdmin, onToggleAdmin }: Props) {
  // Derive the current rank from all-time score for badge display.
  const [user, setUser] = useState<AuthUser>(userProp);
  useEffect(() => setUser(userProp), [userProp]);
  const [rank, setRank] = useState<string>('copper');
  useEffect(() => {
    api.getLeaderboard(null, 'global')
      .then((lb) => {
        const me = lb.entries.find((e) => e.userId === user.id);
        if (me) setRank(me.rank);
      })
      .catch(() => { /* badge stays at default */ });
  }, [user.id]);
  const [view, setView] = useState<View>({ name: 'home' });
  const [books, setBooks] = useState<BookMeta[]>([]);
  const [book, setBook] = useState<BookDetail | null>(null);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [passcode, setPasscode] = useState('');
  const [guildCode, setGuildCode] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [term, setTerm] = useState<Term>('prelims');
  const fileRef = useRef<HTMLInputElement>(null);

  const refreshBooks = useCallback(async () => {
    try {
      setBooks(await api.listBooks());
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  // The wardrobe's locked-set rows deep-link into the shop.
  useEffect(() => {
    const go = () => setView({ name: 'shop' });
    window.addEventListener('arcade:goto-shop', go);
    return () => window.removeEventListener('arcade:goto-shop', go);
  }, []);

  useEffect(() => {
    if (view.name === 'home') void refreshBooks();
  }, [view, refreshBooks]);

  // Admins route through this dashboard and *lead* the guild — pull its code.
  const leads = user.role === 'admin' && !!guild;
  useEffect(() => {
    if (leads) {
      api.getMyGuild().then((r) => setGuildCode(r.guild?.passcode ?? '')).catch(() => setGuildCode(''));
    }
  }, [leads]);

  async function handleRegenerateCode() {
    if (!window.confirm('Regenerate the guild code? The old one stops working immediately.')) return;
    try {
      const res = await api.regeneratePasscode();
      setGuildCode(res.passcode);
      setNotice(`New guild code: ${res.passcode}`);
      api.refreshApp();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  const openBook = useCallback(async (bookId: string) => {
    setError(null);
    try {
      const detail = await api.getBook(bookId);
      setBook(detail);
      setProgress(await api.getProgress(bookId));
      setView({ name: 'map', bookId });
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  async function handleUpload(file: File) {
    setError(null);
    setNotice(null);
    setBusy('Deciphering the ancient tome…');
    try {
      const up = await api.uploadPdf(file);
      setBusy('Summoning monsters…');
      const gen = await api.generateChallenges(up.bookId, term);
      setNotice(`"${up.title}" is ready — ${up.chapters.length} quests, ${gen.challengeCount} monsters (${gen.mode} mode).`);
      await refreshBooks();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function handleJoinGuild() {
    setError(null);
    setBusy('Seeking the guild…');
    try {
      const res = await api.joinGuild(passcode);
      onUserUpdated(res.user);
      setNotice(`You joined the guild "${res.guild.name}"!`);
      setPasscode('');
      api.refreshApp();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function handleLeaveGuild() {
    if (!window.confirm('Leave your guild? Your guild quest progress and standings will no longer count toward it.')) return;
    setError(null);
    try {
      const res = await api.leaveGuild();
      onUserUpdated(res.user);
      setNotice('You left the guild. You are a solo adventurer once more.');
      api.refreshApp();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  const onQuestComplete = useCallback(
    async (chapterId: string, result: { rawScore: number; coinsAwarded: number; coins: number; rank: string }) => {
      // result.coins is the server-confirmed balance AFTER the transaction
      // committed — always reconcile to it rather than doing local math.
      onUserUpdated({ ...user, coins: result.coins });
      if (book) {
        setProgress(await api.getProgress(book.id));
        setView({ name: 'map', bookId: book.id });
      }
      setNotice(`Quest complete! +${result.rawScore} points · +${result.coinsAwarded} coins · Rank: ${result.rank}`);
    },
    [book, user, onUserUpdated]
  );

  // A failed quest settled server-side: sync the (possibly reduced) balance and
  // refresh progress in the background. Do NOT navigate — the Game Over popup
  // lives inside LevelScreen and must stay visible until the player picks
  // retry or kingdom map.
  const onQuestFailSettled = useCallback(
    (chapterId: string, result: { coins: number; rawScore: number }) => {
      onUserUpdated({ ...user, coins: result.coins });
      if (book) {
        void api.getProgress(book.id).then(setProgress).catch(() => { /* stale progress is fine */ });
      }
    },
    [book, user, onUserUpdated]
  );

  return (
    <div style={{ minHeight: '100vh', padding: '1.5rem', position: 'relative' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.5rem', marginBottom: '1rem', flexWrap: 'wrap' }}>
        <div className="hud">
          <AvatarSprite avatar={user.avatar ?? DEFAULT_AVATAR} size={28} title={`${user.name}'s heraldic avatar`} />
          <span>⚔ {user.name}</span>
          <RankBadge rank={rank} />
          <span className="coin-count">
            <img src={spriteDataUrl('coin')} alt="" style={{ width: 14, height: 14 }} />
            <span className="label">{user.coins}</span>
          </span>
          {guild && <span className="label">🏰 {guild.name}</span>}
        </div>
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          {view.name !== 'home' && <button className="pixel-btn pixel-btn--ghost" onClick={() => setView({ name: 'home' })}>◀ HALL</button>}
          {isAdmin && (
            <button className="pixel-btn pixel-btn--ghost" onClick={onToggleAdmin} title="Royal admin panel">👑</button>
          )}
          <button className="pixel-btn pixel-btn--ghost" onClick={onSignOut}>SIGN OUT</button>
        </div>
      </div>

      {error && <p className="error-text">{error}</p>}
      {notice && <p className="status-text">{notice}</p>}

      {view.name === 'home' && (
        <>
          {leads && (
            <>
              <div className="pixel-panel" style={{ maxWidth: 640, margin: '0 auto 1.25rem' }}>
                <p className="pixel-font" style={{ fontSize: '0.85rem', marginTop: 0 }}>⚔ UPLOAD A QUEST FOR YOUR ADVENTURERS</p>
                <p className="term-font" style={{ fontSize: '1rem', margin: '0 0 0.6rem', color: 'var(--d-stone-light)' }}>
                  Drop in a PDF tome — it becomes monsters for {guild?.name ?? 'your guild'} instantly.
                </p>
                <select className="pixel-select" value={term} onChange={(e) => setTerm(e.target.value as Term)} style={{ marginRight: '0.4rem' }}>
                  {(['prelims', 'midterms', 'semis', 'finals'] as Term[]).map((t) => (
                    <option key={t} value={t}>{t.toUpperCase()}</option>
                  ))}
                </select>
                <button className="pixel-btn" style={{ fontSize: '0.65rem' }} onClick={() => fileRef.current?.click()} disabled={!!busy}>
                  {busy ?? 'UPLOAD QUEST (PDF)'}
                </button>
              </div>

              <div className="pixel-panel" style={{ maxWidth: 640, margin: '0 auto 1.25rem' }}>
                <p className="pixel-font" style={{ fontSize: '0.8rem', marginTop: 0 }}>🔑 GUILD CODE</p>
                <p className="term-font" style={{ fontSize: '1.15rem', margin: '0.2rem 0 0.6rem' }}>
                  Adventurers join with: <strong style={{ color: 'var(--d-gold)', fontSize: '1.5rem', letterSpacing: '0.2em' }}>{guildCode || '…'}</strong>
                </p>
                <button className="pixel-btn pixel-btn--ghost" style={{ fontSize: '0.6rem' }} onClick={handleRegenerateCode}>
                  REGENERATE GUILD CODE
                </button>
              </div>
            </>
          )}

          {!guild && (
            <div className="pixel-panel" style={{ maxWidth: 640, margin: '0 auto 1.25rem' }}>
              <p className="pixel-font" style={{ fontSize: '0.8rem', marginTop: 0 }}>CHOOSE YOUR PATH</p>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                <div>
                  <p className="term-font" style={{ fontSize: '1.15rem', margin: '0 0 0.4rem' }}>🛡 Solo Adventurer</p>
                  <p className="term-font" style={{ fontSize: '1rem', margin: '0 0 0.5rem', color: 'var(--d-stone-light)' }}>
                    Upload your own tomes and quest alone. Progress is yours alone.
                  </p>
                  <input
                    ref={fileRef}
                    type="file"
                    accept="application/pdf"
                    style={{ display: 'none' }}
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) void handleUpload(f);
                      e.target.value = '';
                    }}
                  />
                  <select className="pixel-select" value={term} onChange={(e) => setTerm(e.target.value as Term)} style={{ marginRight: '0.4rem' }}>
                    {(['prelims', 'midterms', 'semis', 'finals'] as Term[]).map((t) => (
                      <option key={t} value={t}>{t.toUpperCase()}</option>
                    ))}
                  </select>
                  <button className="pixel-btn" style={{ fontSize: '0.65rem' }} onClick={() => fileRef.current?.click()} disabled={!!busy}>
                    {busy ?? 'UPLOAD TOME (PDF)'}
                  </button>
                </div>
                <div>
                  <p className="term-font" style={{ fontSize: '1.15rem', margin: '0 0 0.4rem' }}>🏰 Join a Guild</p>
                  <p className="term-font" style={{ fontSize: '1rem', margin: '0 0 0.5rem', color: 'var(--d-stone-light)' }}>
                    Enter your teacher's passcode to join their guild and play the quests they assign.
                  </p>
                  <input
                    className="pixel-input"
                    placeholder="GUILD PASSCODE"
                    value={passcode}
                    maxLength={6}
                    onChange={(e) => setPasscode(e.target.value.toUpperCase())}
                    style={{ marginBottom: '0.5rem', textTransform: 'uppercase' }}
                  />
                  <button className="pixel-btn pixel-btn--gold" style={{ fontSize: '0.65rem' }} onClick={handleJoinGuild} disabled={!!busy || passcode.length !== 6}>
                    JOIN GUILD
                  </button>
                </div>
              </div>
            </div>
          )}

          {guild && !leads && (
            <div className="pixel-panel" style={{ maxWidth: 640, margin: '0 auto 1.25rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '1rem' }}>
              <div>
                <p className="pixel-font" style={{ fontSize: '0.8rem', margin: 0 }}>🏰 {guild.name}</p>
                <p className="term-font" style={{ margin: 0, color: 'var(--d-stone-light)' }}>
                  You quest with your guild — the books below are assigned by your teacher.
                </p>
              </div>
              <button className="pixel-btn pixel-btn--ghost" style={{ fontSize: '0.6rem' }} onClick={handleLeaveGuild}>
                LEAVE GUILD
              </button>
            </div>
          )}

          <div className="pixel-panel" style={{ maxWidth: 640, margin: '0 auto' }}>
            <p className="pixel-font" style={{ fontSize: '0.85rem', marginTop: 0 }}>📜 QUEST TOMES</p>
            {books.length === 0 && (
              <p className="status-text" style={{ margin: 0 }}>
                {guild ? (leads ? 'No quests yet — upload a PDF above to arm your adventurers.' : 'Your teacher has not uploaded any tomes yet.') : 'Upload a tome above to begin your quest.'}
              </p>
            )}
            <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
              {books.map((b) => (
                <li key={b.id} style={{ marginBottom: '0.5rem' }}>
                  <button className="pixel-btn pixel-btn--ghost" style={{ width: '100%', textAlign: 'left', textTransform: 'none' }} onClick={() => openBook(b.id)}>
                    ▸ {b.title}
                  </button>
                </li>
              ))}
            </ul>
            <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.9rem', flexWrap: 'wrap' }}>
              <button className="pixel-btn pixel-btn--gold" style={{ fontSize: '0.65rem' }} onClick={() => setView({ name: 'leaderboard' })}>
                ⚔ LEADERBOARD
              </button>
              <button className="pixel-btn pixel-btn--ghost" style={{ fontSize: '0.65rem' }} onClick={() => setView({ name: 'shop' })}>
                🪙 SHOP
              </button>
              <button className="pixel-btn pixel-btn--ghost" style={{ fontSize: '0.65rem' }} onClick={() => setView({ name: 'wardrobe' })}>
                👤 WARDROBE
              </button>
            </div>
          </div>
        </>
      )}

      {view.name === 'map' && book && progress && (
        <WorldMap
          book={book}
          progress={progress}
          term={term}
          onEnterLevel={(chapterId, chapterIdx) => setView({ name: 'lesson', bookId: book.id, chapterId, chapterIdx })}
        />
      )}

      {view.name === 'lesson' && (
        <LessonScreen
          bookId={view.bookId}
          chapterId={view.chapterId}
          chapterIdx={view.chapterIdx}
          onStart={() => setView({ name: 'level', bookId: view.bookId, chapterId: view.chapterId, chapterIdx: view.chapterIdx })}
          onBack={() => setView({ name: 'map', bookId: view.bookId })}
        />
      )}

      {view.name === 'level' && (
        <LevelScreen
          bookId={view.bookId}
          chapterId={view.chapterId}
          chapterIdx={view.chapterIdx}
          term={term}
          avatar={user.avatar}
          onExit={() => setView({ name: 'map', bookId: view.bookId })}
          onComplete={onQuestComplete}
          onFailSettled={onQuestFailSettled}
        />
      )}

      {view.name === 'leaderboard' && (
        <Leaderboard userRole="student" userGuildId={user.guildId} currentUserId={user.id} />
      )}

      {view.name === 'shop' && (
        <RoyalGate feature="shop">
          <Shop user={user} onUserUpdated={onUserUpdated} />
        </RoyalGate>
      )}

      {view.name === 'wardrobe' && (
        <RoyalGate feature="wardrobe">
          <Wardrobe initial={user.avatar ?? DEFAULT_AVATAR} onSaved={(avatar) => onUserUpdated({ ...user, avatar })} />
        </RoyalGate>
      )}
    </div>
  );
}
