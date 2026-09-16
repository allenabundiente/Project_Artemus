import { useCallback, useEffect, useRef, useState } from 'react';
import * as api from '../api';
import type { AuthUser, BookChallengeReview, BookMeta, QuizMode, RosterEntry, Term, TermSettings } from '../types';
import BookRulesRow from './BookRulesRow';
import GuildSettings from './GuildSettings';
import Leaderboard from './Leaderboard';
import AvatarSprite, { DEFAULT_AVATAR } from './AvatarSprite';
import Wardrobe from './Wardrobe';
import RoyalGate from './RoyalGate';
import ChallengeReview from './ChallengeReview';
import Announcements from './Announcements';
import GuildChat from './GuildChat';

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
  /** Quest-chapter count for the NEXT upload ('' = auto). */
  const [uploadQuestChapters, setUploadQuestChapters] = useState('');
  /** Quiz mode for the NEXT upload ('auto' = detect from filename). */
  const [uploadQuizMode, setUploadQuizMode] = useState<'auto' | QuizMode>('auto');
  /** Per-tome quest count edits (bookId → select value, '' = auto). */
  const [bookCounts, setBookCounts] = useState<Record<string, string>>({});
  /** Per-tome quest-chapter edits (bookId → select value, '' = auto). */
  const [bookQuestChapters, setBookQuestChapters] = useState<Record<string, string>>({});
  /** Which tomes are expanded (showing controls). */
  const [expandedBooks, setExpandedBooks] = useState<Record<string, boolean>>({});
  /** Per-tome availability-window edits (bookId → datetime-local strings). */
  const [bookWindows, setBookWindows] = useState<Record<string, { from: string; until: string }>>({});
  const fileRef = useRef<HTMLInputElement>(null);

  const QUEST_COUNT_CHOICES = ['5', '8', '10', '12', '15', '20', '30', '40', '50'];
  const QUEST_CHAPTER_CHOICES = ['1', '2', '3', '4', '5', '6'];

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
      const questChapters = uploadQuestChapters ? Number(uploadQuestChapters) : null;
      const up = await api.uploadPdf(file, questCount, uploadQuizMode, questChapters);
      setBusy('Summoning monsters…');
      const gen = await api.generateChallenges(up.bookId, term);
      const modeNote = up.quizMode === 'programming' ? ' programming mode' : up.quizMode === 'language' ? ' language mode' : '';
      const questNote = questChapters ? `${questChapters} long quest${questChapters === 1 ? '' : 's'}` : `${up.chapters.length} quests (auto)`;
      setNotice(`"${up.title}" is ready — ${questNote}, ${gen.challengeCount} monsters (${gen.mode} mode${modeNote}).`);
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

  /** Apply a tome's new quest-chapter count (1–6, '' = auto) and regenerate. */
  async function handleBookQuestChapters(book: BookMeta) {
    const value = bookQuestChapters[book.id] ?? (book.questChapters != null ? String(book.questChapters) : '');
    const next = value ? Number(value) : null;
    setError(null);
    setBusy(`Reshaping "${book.title}"…`);
    try {
      await api.setBookQuestCount(book.id, book.questCount, undefined, next);
      await api.regenerateBook(book.id);
      const gen = await api.generateChallenges(book.id, term);
      setNotice(`"${book.title}" now offers ${next ?? 'auto'} quest${(next ?? 2) === 1 ? '' : 's'} — ${gen.challengeCount} monsters.`);
      await refreshGuildData();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  /** Remove a tome entirely — its challenges and player progress go with it. */
  async function handleBookRemove(book: BookMeta) {
    if (!window.confirm(`Remove "${book.title}"? Chapters, challenges, and ALL player progress on it are deleted.`)) return;
    setError(null);
    setBusy('Removing tome…');
    try {
      await api.deleteBook(book.id);
      setNotice(`"${book.title}" removed.`);
      await refreshGuildData();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  /** Toggle the tome's lock (hidden from players until unlocked). */
  async function handleBookLock(book: BookMeta) {
    setError(null);
    setBusy(book.locked ? 'Unlocking…' : 'Locking…');
    try {
      await api.setBookAccess(book.id, { locked: !book.locked });
      setNotice(book.locked ? `"${book.title}" is open to players again.` : `"${book.title}" locked — players no longer see it.`);
      await refreshGuildData();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  /** Apply the edited availability window (clears whichever side is empty). */
  async function handleBookWindow(book: BookMeta) {
    const w = bookWindows[book.id] ?? { from: toLocalInput(book.availableFrom), until: toLocalInput(book.availableUntil) };
    setError(null);
    setBusy('Saving schedule…');
    try {
      await api.setBookAccess(book.id, {
        availableFrom: w.from ? new Date(w.from).toISOString() : null,
        availableUntil: w.until ? new Date(w.until).toISOString() : null,
      });
      setNotice(`"${book.title}" availability updated.`);
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

  // Render a UTC instant as a datetime-local input value (no TZ suffix).
  function toLocalInput(iso: string | null | undefined): string {
    if (!iso) return '';
    const d = new Date(iso);
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
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
                </select>                <select
                  className="pixel-select"
                  value={uploadQuestChapters}
                  onChange={(e) => setUploadQuestChapters(e.target.value)}
                  style={{ marginRight: '0.4rem' }}
                  title="How many chapters of this PDF become quests (fewer = longer, richer quests)"
                >
                  <option value="">QUESTS: AUTO</option>
                  {QUEST_CHAPTER_CHOICES.map((c) => (
                    <option key={c} value={c}>{c} QUEST{c === '1' ? '' : 'S'}</option>
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
                  <option value="language">LANGUAGE</option>
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
                <p className="term-font" style={{ fontSize: '0.85rem', color: 'var(--d-stone-light)', margin: '0 0 0.5rem' }}>
                  Cap how many quests each PDF yields and schedule when it opens — students see locks on their realm map.
                </p>
                {books.length === 0 && <p className="status-text" style={{ margin: 0 }}>No tomes assigned yet.</p>}
                <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
                  {books.map((b) => {
                    const expanded = !!expandedBooks[b.id];
                    return (
                      <li key={b.id} className="term-font" style={{ fontSize: '1.1rem', marginBottom: '0.5rem', borderBottom: '1px solid rgba(255,255,255,0.1)', paddingBottom: '0.5rem' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                          <button
                            className="pixel-btn pixel-btn--ghost"
                            style={{ flex: 1, textAlign: 'left', textTransform: 'none', fontSize: '1rem' }}
                            onClick={() => setExpandedBooks((m) => ({ ...m, [b.id]: !m[b.id] }))}
                          >
                            {expanded ? '▾' : '▸'} {b.title}
                          </button>
                          {b.quizMode === 'programming' && (
                            <span className="pixel-font" style={{ fontSize: '0.5rem', color: 'var(--p-yellow)' }} title="Programming mode">⌨</span>
                          )}
                          {b.quizMode === 'language' && (
                            <span className="pixel-font" style={{ fontSize: '0.5rem', color: 'var(--p-yellow)' }} title="Language mode">🗣</span>
                          )}
                          {b.locked && (
                            <span className="pixel-font" style={{ fontSize: '0.5rem', color: 'var(--p-red)' }} title="Locked">🔒</span>
                          )}
                        </div>
                        {expanded && (
                          <div style={{ marginLeft: '1.5rem', marginTop: '0.5rem', display: 'flex', flexWrap: 'wrap', gap: '0.4rem', alignItems: 'center' }}>
                            <select
                              className="pixel-select"
                              style={{ fontSize: '0.55rem' }}
                              value={bookQuestChapters[b.id] ?? (b.questChapters != null ? String(b.questChapters) : '')}
                              title="Chapters that become quests"
                              onChange={(e) => setBookQuestChapters((m) => ({ ...m, [b.id]: e.target.value }))}
                            >
                              <option value="">AUTO</option>
                              {QUEST_CHAPTER_CHOICES.map((c) => (
                                <option key={c} value={c}>{c}</option>
                              ))}
                            </select>
                            <button className="pixel-btn pixel-btn--ghost" style={{ fontSize: '0.5rem' }} onClick={() => void handleBookQuestChapters(b)}>⟳</button>
                            <select
                              className="pixel-select"
                              style={{ fontSize: '0.55rem' }}
                              value={bookCounts[b.id] ?? (b.questCount != null ? String(b.questCount) : '')}
                              title="Monsters per tome"
                              onChange={(e) => setBookCounts((m) => ({ ...m, [b.id]: e.target.value }))}
                            >
                              <option value="">AUTO</option>
                              {QUEST_COUNT_CHOICES.map((c) => (
                                <option key={c} value={c}>{c}</option>
                              ))}
                            </select>
                            <button className="pixel-btn pixel-btn--ghost" style={{ fontSize: '0.5rem' }} onClick={() => void handleBookCount(b)}>⟳</button>
                            <button className="pixel-btn pixel-btn--ghost" style={{ fontSize: '0.5rem' }} onClick={() => void handleBookMode(b)} title="Toggle quiz mode">
                              {b.quizMode === 'programming' ? '⌨→📖' : '📖→⌨'}
                            </button>
                            <button className="pixel-btn pixel-btn--ghost" style={{ fontSize: '0.5rem' }} onClick={() => { setReviewBook(b.id); setView('review'); }}>🔍</button>
                            <button className={`pixel-btn ${b.locked ? 'pixel-btn--gold' : 'pixel-btn--ghost'}`} style={{ fontSize: '0.5rem' }} onClick={() => void handleBookLock(b)}>
                              {b.locked ? '🔓' : '🔒'}
                            </button>
                            <button className="pixel-btn pixel-btn--ghost" style={{ fontSize: '0.5rem', color: 'var(--p-red)' }} onClick={() => void handleBookRemove(b)}>🗑</button>
                          </div>
                        )}
                        {expanded && (
                          <ul style={{ listStyle: 'none', padding: 0, margin: '0.45rem 0 0.1rem 1.5rem' }}>
                            <BookRulesRow
                              book={b}
                              onSaved={(rules) => setBooks((list) => list.map((x) => (x.id === b.id ? { ...x, ...rules } : x)))}
                            />
                          </ul>
                        )}
                      </li>
                    );
                  })}
                </ul>
                <p className="pixel-font" style={{ fontSize: '0.55rem', margin: '0.75rem 0 0.35rem', color: 'var(--d-stone-light)' }}>⏳ TIME-LIMITED ACCESS (optional)</p>
                <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
                  {books.map((b) => {
                    const w = bookWindows[b.id] ?? { from: toLocalInput(b.availableFrom), until: toLocalInput(b.availableUntil) };
                    return (
                      <li key={b.id} className="term-font" style={{ fontSize: '1rem', marginBottom: '0.35rem', display: 'flex', alignItems: 'center', gap: '0.4rem', flexWrap: 'wrap' }}>
                        <span style={{ flex: 1, minWidth: '8rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={b.title}>
                          {b.title}
                        </span>
                        <input
                          type="datetime-local"
                          className="pixel-input"
                          style={{ fontSize: '0.7rem', width: 190 }}
                          value={w.from}
                          onChange={(e) => setBookWindows((m) => ({ ...m, [b.id]: { ...w, from: e.target.value } }))}
                          title="Opens at (empty = no start bound)"
                        />
                        <span style={{ color: 'var(--d-stone-light)' }}>→</span>
                        <input
                          type="datetime-local"
                          className="pixel-input"
                          style={{ fontSize: '0.7rem', width: 190 }}
                          value={w.until}
                          onChange={(e) => setBookWindows((m) => ({ ...m, [b.id]: { ...w, until: e.target.value } }))}
                          title="Closes at (empty = no end bound)"
                        />
                        <button
                          className="pixel-btn pixel-btn--ghost"
                          style={{ fontSize: '0.55rem', padding: '0.25rem 0.5rem' }}
                          disabled={!!busy}
                          title="Save the availability window"
                          onClick={() => void handleBookWindow(b)}
                        >
                          ⏳ SET
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

      {/* Guild master tools: post to the notice board; chat pill stays handy. */}
      {view === 'home' && guild && (
        <RoyalGate feature="chat">
          <Announcements user={user} isTeacher />
        </RoyalGate>
      )}
      {guild && (
        <RoyalGate feature="chat">
          <GuildChat user={user} isTeacher mode="pill" />
        </RoyalGate>
      )}
    </div>
  );
}
