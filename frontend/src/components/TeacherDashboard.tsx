import { useCallback, useEffect, useRef, useState } from 'react';
import * as api from '../api';
import type { AuthUser, BookChallengeReview, BookMeta, QuizMode, RosterEntry, Term, TermSettings } from '../types';
import GuildSettings from './GuildSettings';
import Leaderboard from './Leaderboard';
import AvatarSprite, { DEFAULT_AVATAR } from './AvatarSprite';
import Wardrobe from './Wardrobe';
import RoyalGate from './RoyalGate';
import ChallengeReview from './ChallengeReview';

interface Props {
  user: AuthUser;
  guild: { id: string; name: string; passcode?: string } | null;
  onRefreshUser: () => Promise<void>;
  onSignOut: () => void;
}

type View = 'home' | 'settings' | 'leaderboard' | 'wardrobe' | 'review';

export default function TeacherDashboard({ user, guild, onRefreshUser, onSignOut }: Props) {
  const [view, setView] = useState<View>('home');
  /** Which tome the review screen is open on. */
  const [reviewBook, setReviewBook] = useState<string | null>(null);
  const [guildName, setGuildName] = useState('');
  const [passcode, setPasscode] = useState(guild?.passcode ?? '');
  const [roster, setRoster] = useState<RosterEntry[]>([]);
  const [books, setBooks] = useState<BookMeta[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [term, setTerm] = useState<Term>('prelims');
  /** Quest count chosen for the NEXT upload ('' = auto). */
  const [uploadQuestCount, setUploadQuestCount] = useState('');
  /** Quiz mode for the NEXT upload ('auto' = detect from filename). */
  const [uploadQuizMode, setUploadQuizMode] = useState<'auto' | QuizMode>('auto');
  /** Per-tome quest count edits (bookId → select value, '' = auto). */
  const [bookCounts, setBookCounts] = useState<Record<string, string>>({});
  const fileRef = useRef<HTMLInputElement>(null);

  const QUEST_COUNT_CHOICES = ['5', '8', '10', '12', '15', '20', '30', '40', '50'];

  const refreshGuildData = useCallback(async () => {
    setError(null);
    try {
      const mine = await api.getMyGuild();
      if (mine.guild) {
        setPasscode(mine.guild.passcode ?? '');
        setRoster(mine.roster ?? []);
      }
      setBooks(await api.listBooks());
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    void refreshGuildData();
  }, [refreshGuildData]);

  async function handleCreateGuild() {
    setError(null);
    setBusy('Founding guild…');
    try {
      const res = await api.createGuild(guildName);
      setPasscode(res.guild.passcode ?? '');
      setNotice(`Guild "${res.guild.name}" founded! Share passcode ${res.guild.passcode} with your students.`);
      await onRefreshUser();
      await refreshGuildData();
      api.refreshApp();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function handleRegeneratePasscode() {
    if (!window.confirm('Regenerate the passcode? The old one stops working immediately.')) return;
    try {
      const res = await api.regeneratePasscode();
      setPasscode(res.passcode);
      setNotice(`New passcode: ${res.passcode}`);
      api.refreshApp();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  /** Remove a student from the guild (their account, coins, and scores survive). */
  async function handleRemoveMember(m: RosterEntry) {
    if (!window.confirm(`Dismiss ${m.name} from the guild? Their progress is kept — they can rejoin with the code.`)) return;
    setError(null);
    setBusy(`Dismissing ${m.name}…`);
    try {
      await api.removeGuildMember(m.id);
      setNotice(`${m.name} has left the guild.`);
      await refreshGuildData();
      api.refreshApp();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function handleUpload(file: File) {
    setError(null);
    setNotice(null);
    setBusy('Deciphering the ancient tome…');
    try {
      const questCount = uploadQuestCount ? Number(uploadQuestCount) : null;
      const up = await api.uploadPdf(file, questCount, uploadQuizMode);
      setBusy('Summoning monsters…');
      const gen = await api.generateChallenges(up.bookId, term);
      const modeNote = up.quizMode === 'programming' ? ' programming mode' : '';
      setNotice(`"${up.title}" is ready for your adventurers — ${up.chapters.length} quests, ${gen.challengeCount} monsters (${gen.mode} mode,${modeNote} auto-detected from the filename unless overridden).`);
      await refreshGuildData();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  /** Apply a tome's new quest count and regenerate its challenges. */
  async function handleBookCount(book: BookMeta) {
    const value = bookCounts[book.id] ?? (book.questCount != null ? String(book.questCount) : '');
    const next = value ? Number(value) : null;
    setError(null);
    setBusy(`Re-summoning "${book.title}"…`);
    try {
      await api.setBookQuestCount(book.id, next);
      await api.regenerateBook(book.id);
      const gen = await api.generateChallenges(book.id, term);
      setNotice(`"${book.title}" now holds ${gen.challengeCount} monsters.`);
      await refreshGuildData();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  /** Toggle a tome's quiz mode and regenerate so the new angle takes hold. */
  async function handleBookMode(book: BookMeta) {
    const next: QuizMode = book.quizMode === 'programming' ? 'general' : 'programming';
    setError(null);
    setBusy(`Re-summoning "${book.title}"…`);
    try {
      await api.setBookQuestCount(book.id, book.questCount, next);
      await api.regenerateBook(book.id);
      const gen = await api.generateChallenges(book.id, term);
      setNotice(`"${book.title}" re-summoned in ${next} mode — ${gen.challengeCount} monsters.`);
      await refreshGuildData();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div style={{ minHeight: '100vh', padding: '1.5rem', position: 'relative' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.5rem', marginBottom: '1rem', flexWrap: 'wrap' }}>
        <div className="hud">
          <AvatarSprite avatar={user.avatar ?? DEFAULT_AVATAR} size={28} title={`${user.name}'s heraldic avatar`} />
          <span>🏰 {user.name}</span>
          {guild && <span className="label">GUILD MASTER of {guild.name}</span>}
        </div>
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          {view !== 'home' && <button className="pixel-btn pixel-btn--ghost" onClick={() => setView('home')}>◀ HALL</button>}
          <button className="pixel-btn pixel-btn--ghost" style={{ fontSize: '0.65rem' }} onClick={() => setView('wardrobe')} title="Customize your heraldic look">
            👤 WARDROBE
          </button>
          <button className="pixel-btn pixel-btn--ghost" onClick={onSignOut}>SIGN OUT</button>
        </div>
      </div>

      {error && <p className="error-text">{error}</p>}
      {notice && <p className="status-text">{notice}</p>}

      {view === 'home' && (
        <>
          {!guild && (
            <div className="pixel-panel" style={{ maxWidth: 520, margin: '0 auto 1.25rem' }}>
              <p className="pixel-font" style={{ fontSize: '0.8rem', marginTop: 0 }}>FOUND YOUR GUILD</p>
              <p className="term-font" style={{ color: 'var(--d-stone-light)' }}>
                Name your guild — students join with the passcode you receive.
              </p>
              <input className="pixel-input" placeholder="GUILD NAME" value={guildName} onChange={(e) => setGuildName(e.target.value)} style={{ marginBottom: '0.6rem' }} />
              <button className="pixel-btn pixel-btn--primary" onClick={handleCreateGuild} disabled={!!busy || guildName.trim().length < 2}>
                {busy ?? 'FOUND GUILD'}
              </button>
            </div>
          )}

          {guild && (
            <>
              <div className="pixel-panel" style={{ maxWidth: 640, margin: '0 auto 1.25rem' }}>
                <p className="pixel-font" style={{ fontSize: '0.85rem', marginTop: 0 }}>🏰 {guild.name.toUpperCase()}</p>
                <p className="term-font" style={{ fontSize: '1.15rem', margin: '0.2rem 0 0.6rem' }}>
                  Guild code: <strong style={{ color: 'var(--d-gold)', fontSize: '1.5rem', letterSpacing: '0.2em' }}>{passcode}</strong>
                </p>
                <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                  <button className="pixel-btn pixel-btn--ghost" style={{ fontSize: '0.6rem' }} onClick={handleRegeneratePasscode}>
                    REGENERATE GUILD CODE
                  </button>
                  <button className="pixel-btn pixel-btn--gold" style={{ fontSize: '0.6rem' }} onClick={() => setView('settings')}>
                    ⚙ GUILD SETTINGS
                  </button>
                  <button className="pixel-btn pixel-btn--ghost" style={{ fontSize: '0.6rem' }} onClick={() => setView('leaderboard')}>
                    ⚔ LEADERBOARD
                  </button>
                </div>
              </div>

              <div className="pixel-panel" style={{ maxWidth: 640, margin: '0 auto 1.25rem' }}>
                <p className="pixel-font" style={{ fontSize: '0.8rem', marginTop: 0 }}>⚔ UPLOAD A QUEST FOR YOUR ADVENTURERS</p>
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
                <select
                  className="pixel-select"
                  value={uploadQuestCount}
                  onChange={(e) => setUploadQuestCount(e.target.value)}
                  style={{ marginRight: '0.4rem' }}
                  title="How many monsters this tome summons (per book)"
                >
                  <option value="">QUESTS: AUTO</option>
                  {QUEST_COUNT_CHOICES.map((c) => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>
                <select
                  className="pixel-select"
                  value={uploadQuizMode}
                  onChange={(e) => setUploadQuizMode(e.target.value as 'auto' | QuizMode)}
                  style={{ marginRight: '0.4rem' }}
                  title="AUTO detects programming books from the filename (topicname_code.pdf)"
                >
                  <option value="auto">MODE: AUTO</option>
                  <option value="general">GENERAL</option>
                  <option value="programming">PROGRAMMING</option>
                </select>
                <button className="pixel-btn" style={{ fontSize: '0.65rem' }} onClick={() => fileRef.current?.click()} disabled={!!busy}>
                  {busy ?? 'UPLOAD QUEST (PDF)'}
                </button>
                <p className="term-font" style={{ color: 'var(--d-stone-light)', marginBottom: 0, marginTop: '0.5rem' }}>
                  Monsters are generated using the selected term's difficulty settings. "Quests: Auto" picks a sensible amount per tome.
                </p>
              </div>

              <div className="pixel-panel" style={{ maxWidth: 640, margin: '0 auto 1.25rem' }}>
                <p className="pixel-font" style={{ fontSize: '0.8rem', marginTop: 0 }}>ADVENTURERS ({roster.length})</p>
                {roster.length === 0 && <p className="status-text" style={{ margin: 0 }}>No students have joined yet — share the passcode.</p>}
                {roster.map((m) => (
                  <div key={m.id} className="leaderboard-row">
                    <AvatarSprite avatar={m.avatar ?? DEFAULT_AVATAR} size={26} title={`${m.name}'s heraldic avatar`} />
                    <span className="term-font" style={{ fontSize: '1.15rem', flex: 1 }}>{m.name}</span>
                    <span className="pixel-font" style={{ fontSize: '0.6rem', color: 'var(--d-stone-light)' }}>
                      last active {new Date(m.lastActive).toLocaleDateString()}
                    </span>
                    <span className="pixel-font" style={{ fontSize: '0.7rem', color: 'var(--d-gold)' }}>{m.score}</span>
                    <button
                      className="pixel-btn pixel-btn--ghost"
                      style={{ fontSize: '0.55rem', padding: '0.25rem 0.5rem' }}
                      title="Dismiss from the guild (progress is kept)"
                      onClick={() => void handleRemoveMember(m)}
                      disabled={!!busy}
                    >
                      ✖ DISMISS
                    </button>
                  </div>
                ))}
              </div>

              <div className="pixel-panel" style={{ maxWidth: 640, margin: '0 auto' }}>
                <p className="pixel-font" style={{ fontSize: '0.8rem', marginTop: 0 }}>ASSIGNED TOMES</p>
                {books.length === 0 && <p className="status-text" style={{ margin: 0 }}>No tomes assigned yet.</p>}
                <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
                  {books.map((b) => {
                    const current = bookCounts[b.id] ?? (b.questCount != null ? String(b.questCount) : '');
                    return (
                      <li key={b.id} className="term-font" style={{ fontSize: '1.1rem', marginBottom: '0.35rem', display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                        <span style={{ flex: 1, minWidth: '8rem' }}>
                          ▸ {b.title}
                          {b.quizMode === 'programming' && (
                            <span className="pixel-font" style={{ fontSize: '0.5rem', color: 'var(--p-yellow)', marginLeft: '0.4rem' }} title="Programming mode — code-reading challenges">⌨ CODE</span>
                          )}
                        </span>
                        <select
                          className="pixel-select"
                          style={{ fontSize: '0.6rem' }}
                          value={current}
                          title="Monsters per tome (AUTO picks by length)"
                          onChange={(e) => setBookCounts((m) => ({ ...m, [b.id]: e.target.value }))}
                        >
                          <option value="">AUTO</option>
                          {QUEST_COUNT_CHOICES.map((c) => (
                            <option key={c} value={c}>{c}</option>
                          ))}
                        </select>
                        <button
                          className="pixel-btn pixel-btn--ghost"
                          style={{ fontSize: '0.55rem', padding: '0.25rem 0.5rem' }}
                          disabled={!!busy || current === (b.questCount != null ? String(b.questCount) : '')}
                          title="Apply this count and re-summon the tome's monsters"
                          onClick={() => void handleBookCount(b)}
                        >
                          ⟳ RE-SUMMON
                        </button>
                        <button
                          className="pixel-btn pixel-btn--ghost"
                          style={{ fontSize: '0.55rem', padding: '0.25rem 0.5rem' }}
                          title={`Quiz mode: ${b.quizMode}. Click to toggle general ↔ programming.`}
                          onClick={() => void handleBookMode(b)}
                          disabled={!!busy}
                        >
                          {b.quizMode === 'programming' ? '⌨→📖' : '📖→⌨'}
                        </button>
                        <button
                          className="pixel-btn pixel-btn--ghost"
                          style={{ fontSize: '0.55rem', padding: '0.25rem 0.5rem' }}
                          title="Review the challenges and re-summon any bad ones"
                          onClick={() => { setReviewBook(b.id); setView('review'); }}
                        >
                          🔍 REVIEW
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </div>
            </>
          )}
        </>
      )}

      {view === 'review' && reviewBook && (
        <ChallengeReview
          bookId={reviewBook}
          term={term}
          onBack={() => setView('home')}
          onRegenerated={() => setNotice('Fresh challenge summoned in its place.')}
        />
      )}

      {view === 'settings' && guild && <GuildSettings onSaved={() => setNotice('Guild settings saved. New monster generations will use them.')} />}

      {view === 'leaderboard' && guild && (
        <Leaderboard userRole="teacher" userGuildId={guild.id} currentUserId={user.id} />
      )}

      {view === 'wardrobe' && (
        <RoyalGate feature="wardrobe">
          <Wardrobe initial={user.avatar ?? DEFAULT_AVATAR} onSaved={async (avatar) => { await onRefreshUser(); setNotice('Look saved! Your heraldry rides with you.'); void avatar; }} />
        </RoyalGate>
      )}
    </div>
  );
}
