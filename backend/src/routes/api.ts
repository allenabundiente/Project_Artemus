import { Router, json } from 'express';
import type * as express from 'express';
import multer from 'multer';
import { parsePdf } from '../services/pdfParser.js';
import { generateWithLlm, generateHeuristically, perChapterTarget, clampTargetCount, detectQuizMode, type ChapterContent, type GeneratedChallenge, type GenerationOptions, type QuizMode } from '../services/contentGenerator.js';
import { isLlmConfigured, activeProvider, llmModeLabel } from '../services/llmClient.js';
import { computeScore, DEFAULT_SCORE_WEIGHTS, type ScoreWeights } from '../services/scoring.js';
import { resolveTermSettings, sanitizeTermSettings, TERMS, type TermSettings } from '../services/termSettings.js';
import { buildLessonOverview } from '../services/lesson.js';
import { hashPassword, verifyPassword, requireAuth, requireAdmin, requireRole, signToken } from '../services/auth.js';
import { isFeatureLocked, sanitizeAvatar } from '../db/admin.js';
import { registerAdminRoutes, fetchCustomThemes } from './admin.js';
import {
  initDbResilient, query, queryOne, withTransaction, applyCoinsTx, insertScoreTx, upsertProgressTx,
  insertBook, insertChapter, insertChallenge, getBook, listBooks, updateBookQuestCount, updateBookQuizMode,
  deleteBook, updateBookAccess, isBookPlayable, updateBookQuestChapters,
  getChapters, getChapter, getChallengesForChapter, getChapterWithText,
  countChallenges, deleteChallengesForBook, deleteChallengesForChapter, getProgress, upsertProgress,
  getUserByEmail, getUserById, insertUser, addCoins,
  insertGuild, regeneratePasscode, getGuild, getGuildByTeacher, getGuildByPasscode,
  getGuildMessages, getGuildMessagesSince, insertGuildMessage, deleteGuildMessage,
  getAnnouncements, insertAnnouncement, deleteAnnouncement, getLatestAnnouncementTime,
  getStreak, updateStreak, STREAK_BONUS_COINS, getStreakCalendar, getGuildStreaks, isStreakAtRisk, effectiveStreak,
  updateGuildTermSettings, joinGuild, leaveGuild, listGuildMembers,
  insertScore, getLeaderboard, getTermScore, rankForScore, DEFAULT_RANK_TIERS,
  getChallenge, replaceChallenge, nextChallengeOrd,
  getGlobalMapConfig, getGuildMapSettings, setGuildMapTheme, applyBookRules,
  listGuildsWithCounts, removeGuildMember,
  pool,
  type GuildRow, type UserRow, type ChapterRow, type BookRow,
} from '../db/db.js';

/**
 * Quest-fail coin penalty: a random fraction of the coins gathered during the
 * failed run is lost. The penalty NEVER dips into coins banked from earlier
 * quests — the balance only ever receives max(0, gathered − penalty).
 */
const FAIL_PENALTY_MIN_PCT = 0.05; // lose at least 5% of gathered coins
const FAIL_PENALTY_MAX_PCT = 0.20; // ... and at most 20%

/**
 * Generate challenges for every chapter of a book, honoring the guild's term
 * settings. Shared by POST /books/:id/generate and POST /llm/regenerate-all.
 */
export async function generateChallengesForBook(
  bookId: string,
  term: string,
  guildSettings: Record<string, unknown> | null,
  /**
   * 'replace' (default for regenerate-all) FIRST deletes each chapter's old
   * challenges right before writing its new batch. The wipe is per-chapter
   * and only after that chapter's generation has already succeeded — the
   * old quest stays playable when a chapter's generation fails midway.
   * 'append' never deletes (POST /books/:id/generate on an empty book).
   */
  mode: 'append' | 'replace' = 'append',
  /** Teacher single-chapter regenerate: touch only this chapter, leave the rest of the tome alone. */
  onlyChapterId?: string
): Promise<{ challengeCount: number; llmFailures: number; failedChapters: number; mode: 'llm' | 'heuristic' }> {
  const ts = resolveTermSettings(term, guildSettings);
  // The teacher's per-book quest count (null = auto) and quiz mode steer
  // generation.
  const book = await getBook(bookId);
  const target = book?.questCount ?? null;
  const genOpts: GenerationOptions = {
    term,
    monsterDifficulty: ts.monsterDifficulty,
    difficultyMix: ts.difficultyMix,
    targetCount: target,
    quizMode: book?.quizMode ?? 'general',
  };
  const chapters = await getChapters(bookId);
  // "1–2 long quests per PDF": only the first N chapters become quests
  // (book.quest_chapters; null = auto, capped at 12). This is the efficiency
  // lever — generation (LLM calls!) only runs for quest chapters.
  const questChapterCount = book?.questChapters ?? null;
  const effectiveChapters = questChapterCount ? chapters.slice(0, questChapterCount) : chapters.slice(0, 12);
  // Single-chapter mode narrows the loop below to just that chapter (an empty
  // filter means the id belongs to a non-quest chapter — the caller 404s).
  const selectedChapters = onlyChapterId ? effectiveChapters.filter((c) => c.id === onlyChapterId) : effectiveChapters;
  const useLlm = isLlmConfigured();
  let generated = 0;
  let llmFailures = 0;
  let failedChapters = 0;

  for (const chapter of selectedChapters) {
    let content: ChapterContent;
    try {
      content = useLlm ? await generateWithLlm(chapter, genOpts) : generateHeuristically(chapter, perChapterTarget(target, chapters.length));
    } catch (e) {
      llmFailures++;
      failedChapters++;
      console.error(`[generate] chapter "${chapter.title}" fell back to heuristics:`, (e as Error).message);
      try {
        content = generateHeuristically(chapter, perChapterTarget(target, chapters.length));
      } catch (he) {
        // Even the deterministic fallback died (corrupt chapter data?). Keep
        // the OLD challenges for this chapter and move on — never leave the
        // book empty because one chapter could not be rebuilt.
        console.error(`[generate] heuristic fallback also failed for "${chapter.title}":`, (he as Error).message);
        continue;
      }
    }
    if (content.challenges.length === 0) continue;
    // Replace-mode wipes THIS chapter's old set only after the new batch is
    // in hand, so a wipe is always followed by a successful write (no more
    // "regenerate failed → tome left with zero monsters").
    if (mode === 'replace') await deleteChallengesForChapter(chapter.id);
    for (let i = 0; i < content.challenges.length; i++) {
      await insertChallenge({ bookId, chapterId: chapter.id, ...content.challenges[i], ord: i, quest: null });
    }
    generated += content.challenges.length;
  }
  return { challengeCount: generated, llmFailures, failedChapters, mode: useLlm ? 'llm' : 'heuristic' };
}

/** Can this user manage the book (owner, guild teacher, or any admin)? */
function canManageBook(user: UserRow, book: BookRow): boolean {
  if (user.role === 'admin') return true;
  if (book.ownerId === user.id) return true;
  return !!(book.guildId && user.role === 'teacher' && user.guildId === book.guildId);
}

/** Human-readable reason a book is not playable right now. */
function bookLockedMessage(book: BookRow): string {
  if (book.locked) return 'This quest is locked by your teacher.';
  const now = Date.now();
  if (book.availableFrom && book.availableFrom.getTime() > now) {
    return `This quest opens ${book.availableFrom.toLocaleString('en-US')}.`;
  }
  return 'This quest window has closed.';
}

/** Serialized access gate for API responses. */
function bookAccessPayload(book: BookRow | null) {
  return {
    locked: book?.locked ?? false,
    availableFrom: book?.availableFrom?.toISOString() ?? null,
    availableUntil: book?.availableUntil?.toISOString() ?? null,
  };
}

/**
 * Resolve the acting user's guild: students are members (users.guild_id),
 * teachers and admins lead one (guilds.teacher_id) — their users.guild_id
 * stays NULL.
 */
async function resolveUserGuild(user: UserRow): Promise<GuildRow | null> {
  if (user.guildId) return getGuild(user.guildId);
  if (user.role === 'teacher' || user.role === 'admin') return getGuildByTeacher(user.id);
  return null;
}

/** Same as resolveUserGuild, but admins may address ANY guild by :guildId. */
async function resolveManagedGuild(user: UserRow, guildId: string | null): Promise<GuildRow | null> {
  if (user.role === 'admin') return guildId ? getGuild(guildId) : null;
  const own = await resolveUserGuild(user);
  if (own && guildId && own.id !== guildId) return null; // teachers stay in their lane
  return own;
}

export function createApiRouter(): Router {
  const router = Router();
  initDbResilient();

  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 25 * 1024 * 1024 },
    fileFilter: (_req, file, cb) => {
      if (file.mimetype === 'application/pdf' || file.originalname.toLowerCase().endsWith('.pdf')) cb(null, true);
      else cb(new Error('Only PDF files are accepted'));
    },
  });

  // --- helpers ---------------------------------------------------------------

  function publicUser(u: UserRow) {
    return { id: u.id, name: u.name, email: u.email, role: u.role, guildId: u.guildId, coins: u.coins };
  }

  // --- admin: guild management (any guild, by id) -------------------------------------

  /** The guild directory: every guild, its leader, code, and member count. */
  router.get('/admin/guilds', requireAdmin, async (_req, res) => {
    const guilds = await listGuildsWithCounts();
    const leaders = await Promise.all(guilds.map(async (g) => ({
      ...g,
      teacherName: (await getUserById(g.teacherId))?.name ?? '—',
    })));
    res.json({ guilds: leaders });
  });

  /** Admin view of one guild's roster (same shape as the teacher roster). */
  router.get('/admin/guilds/:guildId/members', requireAdmin, async (req, res) => {
    const guild = await getGuild(String(req.params.guildId));
    if (!guild) return res.status(404).json({ error: 'Guild not found' });
    const members = await listGuildMembers(guild.id);
    const roster = await Promise.all(members.map(async (m) => {
      const termScore = await getTermScore(m.id, null);
      return {
        id: m.id, name: m.name, rank: rankForScore(termScore), score: termScore, lastActive: m.createdAt,
        avatar: sanitizeAvatar((m.preferences as { avatar?: unknown })?.avatar ?? m.preferences),
      };
    }));
    res.json({ roster });
  });

  /** Admin kick: same effect as the teacher kick, on any guild's member. */
  router.delete('/admin/guilds/:guildId/members/:userId', requireAdmin, async (req, res) => {
    const guild = await getGuild(String(req.params.guildId));
    if (!guild) return res.status(404).json({ error: 'Guild not found' });
    const member = await getUserById(String(req.params.userId));
    if (!member || member.guildId !== guild.id) {
      return res.status(404).json({ error: 'That adventurer is not in this guild' });
    }
    const updated = await removeGuildMember(member.id);
    res.json({ removed: { id: updated.id, name: updated.name } });
  });

  /** Admin regenerates any guild's join code. */
  router.post('/admin/guilds/:guildId/regenerate-passcode', requireAdmin, async (req, res) => {
    const guild = await getGuild(String(req.params.guildId));
    if (!guild) return res.status(404).json({ error: 'Guild not found' });
    const updated = await regeneratePasscode(guild.id);
    res.json({ passcode: updated.passcode });
  });

  /**
   * Admin reads/writes a guild's term settings through the same
   * resolve/sanitize pipeline the teacher routes use — scoped to :guildId.
   */
  router.get('/admin/guilds/:guildId/settings', requireAdmin, async (req, res) => {
    const guild = await getGuild(String(req.params.guildId));
    if (!guild) return res.status(404).json({ error: 'Guild not found' });
    const resolved = Object.fromEntries(TERMS.map((t) => [t, resolveTermSettings(t, guild.termSettings)]));
    res.json({ guildId: guild.id, termSettings: resolved });
  });

  router.put('/admin/guilds/:guildId/settings', requireAdmin, async (req, res) => {
    try {
      const guild = await getGuild(String(req.params.guildId));
      if (!guild) return res.status(404).json({ error: 'Guild not found' });
      const sanitized = sanitizeTermSettings(req.body?.termSettings);
      const updated = await updateGuildTermSettings(guild.id, sanitized);
      const resolved = Object.fromEntries(TERMS.map((t) => [t, resolveTermSettings(t, updated.termSettings)]));
      res.json({ guildId: guild.id, termSettings: resolved });
    } catch (e: any) {
      console.error('[adminSaveGuildSettings]', e);
      res.status(500).json({ error: 'Could not save settings' });
    }
  });

  // --- auth ------------------------------------------------------------------

  router.post('/auth/signup', async (req, res) => {
    try {
      const { name, email, password, role } = req.body ?? {};
      if (typeof name !== 'string' || name.trim().length < 2) return res.status(400).json({ error: 'Name must be at least 2 characters' });
      if (typeof email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: 'Valid email required' });
      if (typeof password !== 'string' || password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });
      if (!['teacher', 'student'].includes(role)) return res.status(400).json({ error: 'Role must be teacher or student' });

      const existing = await getUserByEmail(email);
      if (existing) return res.status(409).json({ error: 'An account with this email already exists' });

      const passwordHash = await hashPassword(password);
      const user = await insertUser(name.trim(), email.trim(), passwordHash, role);
      res.status(201).json({ token: signToken({ id: user.id, role: user.role, name: user.name }), user: publicUser(user) });
    } catch (e: any) {
      console.error('[signup]', e);
      res.status(500).json({ error: 'Signup failed' });
    }
  });

  router.post('/auth/login', async (req, res) => {
    try {
      const { email, password } = req.body ?? {};
      if (typeof email !== 'string' || typeof password !== 'string') return res.status(400).json({ error: 'Email and password required' });
      const user = await getUserByEmail(email);
      if (!user) return res.status(401).json({ error: 'Invalid email or password' });
      const ok = await verifyPassword(password, user.passwordHash);
      if (!ok) return res.status(401).json({ error: 'Invalid email or password' });
      res.json({ token: signToken({ id: user.id, role: user.role, name: user.name }), user: publicUser(user) });
    } catch (e: any) {
      console.error('[login]', e);
      res.status(500).json({ error: 'Login failed' });
    }
  });

  router.get('/me', requireAuth, async (req, res) => {
    const user = await getUserById(req.user!.id);
    if (!user) return res.status(404).json({ error: 'User not found' });
    const guild = await resolveUserGuild(user);
    const prefs = user.preferences as { avatar?: Record<string, unknown> } | null;
    res.json({
      user: { ...publicUser(user), avatar: sanitizeAvatar(prefs?.avatar ?? prefs) },
      guild: guild ? { id: guild.id, name: guild.name } : null,
    });
  });

  // Which map themes exist (used by teacher skin picker + admin panel): the
  // static built-ins plus admin-defined custom themes (colors + sprite swaps
  // persisted backend-side, registered into the game at quest start).
  router.get('/themes', requireAuth, async (_req, res) => {
    res.json({
      themes: [
        { id: 'dungeon', name: 'Dungeon Night', builtin: true },
        { id: 'forest', name: 'Firefly Glade', builtin: true },
        { id: 'lava', name: 'Volcano Caldera', builtin: true },
        ...(await fetchCustomThemes()).map((t) => ({ id: t.id, name: String(t.name ?? t.id), builtin: false })),
      ],
    });
  });

  registerAdminRoutes(router, { importLegacyThemes: true });

  // --- map (theme) resolution ---------------------------------------------------
  //
  // Resolution order: teacher's guild skin → admin global config →
  // random by difficulty (deterministic per chapter+difficulty so all students
  // in the same chapter+difficulty see the same realm, and revisits match).
  // Custom themes join the random pools so admins' maps appear without a
  // teacher pinning them. Fetched per request (DB-backed, so custom themes
  // survive redeploys) and merged into the built-in difficulty pools.
  const BUILTIN_DIFFICULTY_THEMES: Record<string, string[]> = {
    easy: ['forest', 'dungeon'],
    medium: ['dungeon', 'forest', 'lava'],
    hard: ['lava', 'dungeon'],
  };
  router.get('/map/resolve', requireAuth, async (req, res) => {
    const user = await getUserById(req.user!.id);
    if (!user) return res.status(404).json({ error: 'User not found' });
    const guild = await resolveUserGuild(user);

    // 1. Teacher set a fixed skin for the guild?
    const guildTheme = (guild?.mapSettings as { theme?: string } | null)?.theme;
    if (guildTheme) return res.json({ theme: guildTheme, source: 'guild' as const });

    // 2. Admin global config.
    const cfg = await getGlobalMapConfig();
    if (cfg.mode === 'fixed') {
      // A pinned theme may have been deleted since — verify it still exists.
      const known = ['dungeon', 'forest', 'lava'].includes(cfg.fixedTheme) || (await fetchCustomThemes()).some((t) => t.id === cfg.fixedTheme);
      if (known) return res.json({ theme: cfg.fixedTheme, source: 'admin' as const });
    }

    // 3. Random by difficulty — deterministic hash so revisits agree.
    const diff = typeof req.query.difficulty === 'string' ? req.query.difficulty : 'medium';
    const base = BUILTIN_DIFFICULTY_THEMES[diff] ?? BUILTIN_DIFFICULTY_THEMES.medium;
    const customIds = (await fetchCustomThemes()).map((t) => t.id);
    const pool = customIds.length > 0 ? [...base, ...customIds] : base;
    let h = 0;
    const seed = `${String(req.query.chapterId ?? '')}:${diff}`;
    for (let i = 0; i < seed.length; i++) h = (Math.imul(31, h) + seed.charCodeAt(i)) | 0;
    const theme = pool[Math.abs(h) % pool.length];
    res.json({ theme, source: 'random' as const });
  });

  // Teacher: get/set their guild's map skin (overrides admin config).
  router.get('/guilds/mine/map', requireRole('teacher'), async (req, res) => {
    const guild = await getGuildByTeacher(req.user!.id);
    if (!guild) return res.status(404).json({ error: 'You do not lead a guild' });
    const settings = await getGuildMapSettings(guild.id);
    res.json({ theme: settings?.theme ?? null });
  });

  router.put('/guilds/mine/map', requireRole('teacher'), async (req, res) => {
    const guild = await getGuildByTeacher(req.user!.id);
    if (!guild) return res.status(404).json({ error: 'You do not lead a guild' });
    const theme = req.body?.theme === null || req.body?.theme === '' ? null : String(req.body?.theme ?? '');
    if (theme !== null && !/^[a-z0-9_-]{1,32}$/.test(theme)) return res.status(400).json({ error: 'Invalid theme id' });
    await setGuildMapTheme(guild.id, theme);
    res.json({ theme });
  });

  // --- guilds ------------------------------------------------------------------

  router.post('/guilds', requireRole('teacher'), async (req, res) => {
    try {
      const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
      if (name.length < 2) return res.status(400).json({ error: 'Guild name must be at least 2 characters' });
      const existing = await getGuildByTeacher(req.user!.id);
      if (existing) return res.status(409).json({ error: 'You already lead a guild' });
      const guild = await insertGuild(name, req.user!.id);
      res.status(201).json({ guild: { id: guild.id, name: guild.name, passcode: guild.passcode, teacherId: guild.teacherId, termSettings: guild.termSettings } });
    } catch (e: any) {
      console.error('[createGuild]', e);
      res.status(500).json({ error: 'Could not create guild' });
    }
  });

  router.get('/guilds/mine', requireRole('teacher'), async (req, res) => {
    const guild = await getGuildByTeacher(req.user!.id);
    if (!guild) return res.json({ guild: null });
    const members = await listGuildMembers(guild.id);
    const roster = await Promise.all(members.map(async (m) => {
      const termScore = await getTermScore(m.id, null);
      return {
        id: m.id, name: m.name, rank: rankForScore(termScore), score: termScore, lastActive: m.createdAt,
        avatar: sanitizeAvatar((m.preferences as { avatar?: unknown })?.avatar ?? m.preferences),
      };
    }));
    res.json({ guild: { id: guild.id, name: guild.name, passcode: guild.passcode, termSettings: guild.termSettings }, roster });
  });

  router.post('/guilds/mine/regenerate-passcode', requireRole('teacher'), async (req, res) => {
    const guild = await getGuildByTeacher(req.user!.id);
    if (!guild) return res.status(404).json({ error: 'You do not lead a guild' });
    const updated = await regeneratePasscode(guild.id);
    res.json({ passcode: updated.passcode });
  });

  router.get('/guilds/mine/roster', requireRole('teacher'), async (req, res) => {
    const guild = await getGuildByTeacher(req.user!.id);
    if (!guild) return res.status(404).json({ error: 'You do not lead a guild' });
    const members = await listGuildMembers(guild.id);
    const roster = await Promise.all(members.map(async (m) => {
      const termScore = await getTermScore(m.id, null);
      return {
        id: m.id, name: m.name, rank: rankForScore(termScore), score: termScore, lastActive: m.createdAt,
        avatar: sanitizeAvatar((m.preferences as { avatar?: unknown })?.avatar ?? m.preferences),
      };
    }));
    res.json({ roster });
  });

  // --- teacher: manage guild members ------------------------------------------------
  //
  // Kicking clears the student's guild_id (their account, coins, and scores
  // survive — they simply leave the guild and can rejoin with a code).

  router.delete('/guilds/mine/members/:userId', requireRole('teacher'), async (req, res) => {
    const guild = await getGuildByTeacher(req.user!.id);
    if (!guild) return res.status(404).json({ error: 'You do not lead a guild' });
    const member = await getUserById(String(req.params.userId));
    if (!member || member.guildId !== guild.id) {
      return res.status(404).json({ error: 'That adventurer is not in your guild' });
    }
    const updated = await removeGuildMember(member.id);
    res.json({ removed: { id: updated.id, name: updated.name } });
  });

  router.post('/guilds/join', requireRole('student'), async (req, res) => {
    try {
      const passcode = typeof req.body?.passcode === 'string' ? req.body.passcode.trim() : '';
      if (!passcode) return res.status(400).json({ error: 'Passcode required' });
      const guild = await getGuildByPasscode(passcode);
      if (!guild) return res.status(404).json({ error: 'No guild found for that passcode' });
      const user = await joinGuild(req.user!.id, guild.id);
      res.json({ user: publicUser(user), guild: { id: guild.id, name: guild.name } });
    } catch (e: any) {
      console.error('[joinGuild]', e);
      res.status(500).json({ error: 'Could not join guild' });
    }
  });

  router.post('/guilds/leave', requireRole('student'), async (req, res) => {
    const user = await leaveGuild(req.user!.id);
    res.json({ user: publicUser(user) });
  });

  // --- guild chat -----------------------------------------------------------------
  // Polling MVP: clients fetch new messages every few seconds with ?since=.
  // NB: these MUST stay registered before GET /guilds/:id below — otherwise the
  // parametric route swallows /guilds/mine/chat and the panel never loads.

  /** Recent guild messages (all of them, oldest-first) or only ?since= newer ones. */
  router.get('/guilds/mine/chat', requireAuth, async (req, res) => {
    const user = await getUserById(req.user!.id);
    if (!user) return res.status(404).json({ error: 'User not found' });
    const guild = await resolveUserGuild(user);
    if (!guild) return res.status(400).json({ error: 'You must be in a guild to use chat' });

    // Opaque full-precision cursor (µs + id) — immune to the JSON/Postgres
    // precision mismatch that made a timestamp cursor re-deliver the last
    // message on every poll ("chat repeats forever").
    const cursor = typeof req.query.cursor === 'string' && req.query.cursor ? req.query.cursor : null;
    const messages = cursor
      ? await getGuildMessagesSince(guild.id, cursor)
      : await getGuildMessages(guild.id, 50);

    // Rank per sender, resolved once per id (not per message — most messages
    // come from the same handful of guildmates).
    const scores = new Map<string, number>();
    const rankOf = async (userId: string) => {
      if (!scores.has(userId)) scores.set(userId, await getTermScore(userId, null));
      return rankForScore(scores.get(userId)!);
    };
    const enriched = await Promise.all(messages.map(async (m) => ({ ...m, rank: await rankOf(m.userId) })));
    res.json({ messages: enriched });
  });

  /** Post a message to the guild chat. */
  router.post('/guilds/mine/chat', requireAuth, async (req, res) => {
    try {
      const user = await getUserById(req.user!.id);
      if (!user) return res.status(404).json({ error: 'User not found' });
      const guild = await resolveUserGuild(user);
      if (!guild) return res.status(400).json({ error: 'You must be in a guild to use chat' });

      const message = typeof req.body?.message === 'string' ? req.body.message.trim() : '';
      if (!message) return res.status(400).json({ error: 'Message cannot be empty' });
      if (message.length > 1000) return res.status(400).json({ error: 'Message too long (max 1000 characters)' });

      const newMsg = await insertGuildMessage(guild.id, user.id, message);
      res.status(201).json({ message: { ...newMsg, rank: rankForScore(await getTermScore(user.id, null)) } });
    } catch (e: any) {
      console.error('[postChat]', e);
      res.status(500).json({ error: 'Could not send message' });
    }
  });

  /** Delete a message (teacher/admin of the guild only). */
  router.delete('/guilds/mine/chat/:messageId', requireAuth, async (req, res) => {
    const user = await getUserById(req.user!.id);
    if (!user) return res.status(404).json({ error: 'User not found' });
    const guild = await resolveUserGuild(user);
    if (!guild) return res.status(400).json({ error: 'You must be in a guild' });
    if (user.role !== 'teacher' && user.role !== 'admin') {
      return res.status(403).json({ error: 'Only teachers can moderate chat' });
    }
    const deleted = await deleteGuildMessage(String(req.params.messageId), guild.id);
    if (!deleted) return res.status(404).json({ error: 'Message not found' });
    res.json({ ok: true });
  });

  // --- announcements ---------------------------------------------------------------
  // One-way broadcast: teachers post to their guild's notice board, students view.

  /** Get announcements for the user's guild (newest-first). */
  router.get('/guilds/mine/announcements', requireAuth, async (req, res) => {
    const user = await getUserById(req.user!.id);
    if (!user) return res.status(404).json({ error: 'User not found' });
    const guild = await resolveUserGuild(user);
    if (!guild) return res.json({ announcements: [] });

    const announcements = await getAnnouncements(guild.id);
    res.json({ announcements });
  });

  /** Create an announcement (teacher/admin of the guild only). */
  router.post('/guilds/mine/announcements', requireAuth, async (req, res) => {
    try {
      const user = await getUserById(req.user!.id);
      if (!user) return res.status(404).json({ error: 'User not found' });
      if (user.role !== 'teacher' && user.role !== 'admin') {
        return res.status(403).json({ error: 'Only teachers can post announcements' });
      }
      const guild = await resolveUserGuild(user);
      if (!guild) return res.status(400).json({ error: 'You must lead a guild to post announcements' });

      const title = typeof req.body?.title === 'string' ? req.body.title.trim() : '';
      const message = typeof req.body?.message === 'string' ? req.body.message.trim() : '';
      if (!title) return res.status(400).json({ error: 'Title required' });
      if (title.length > 200) return res.status(400).json({ error: 'Title too long (max 200 characters)' });
      if (!message) return res.status(400).json({ error: 'Message required' });
      if (message.length > 2000) return res.status(400).json({ error: 'Message too long (max 2000 characters)' });

      const announcement = await insertAnnouncement(guild.id, user.id, title, message);
      res.status(201).json({ announcement });
    } catch (e: any) {
      console.error('[postAnnouncement]', e);
      res.status(500).json({ error: 'Could not post announcement' });
    }
  });

  /** Delete an announcement (teacher/admin of the guild only). */
  router.delete('/guilds/mine/announcements/:id', requireAuth, async (req, res) => {
    const user = await getUserById(req.user!.id);
    if (!user) return res.status(404).json({ error: 'User not found' });
    if (user.role !== 'teacher' && user.role !== 'admin') {
      return res.status(403).json({ error: 'Only teachers can delete announcements' });
    }
    const guild = await resolveUserGuild(user);
    if (!guild) return res.status(400).json({ error: 'You must lead a guild' });

    const deleted = await deleteAnnouncement(String(req.params.id), guild.id);
    if (!deleted) return res.status(404).json({ error: 'Announcement not found' });
    res.json({ ok: true });
  });

  /** Unread check: does the guild have announcements newer than the user's last seen? */
  router.get('/guilds/mine/announcements/unread', requireAuth, async (req, res) => {
    const user = await getUserById(req.user!.id);
    if (!user) return res.status(404).json({ error: 'User not found' });
    const guild = await resolveUserGuild(user);
    if (!guild) return res.json({ hasUnread: false, latestAnnouncementAt: null });

    const prefs = (user.preferences ?? {}) as Record<string, unknown>;
    const lastSeenStr = typeof prefs.lastAnnouncementSeen === 'string' ? prefs.lastAnnouncementSeen : null;
    const lastSeen = lastSeenStr ? new Date(lastSeenStr) : null;
    const latest = await getLatestAnnouncementTime(guild.id);
    const hasUnread = latest ? (!lastSeen || latest > lastSeen) : false;
    res.json({ hasUnread, latestAnnouncementAt: latest?.toISOString() ?? null });
  });

  /** Mark announcements as seen (student viewed the notice board). */
  router.post('/guilds/mine/announcements/seen', requireAuth, async (req, res) => {
    const user = await getUserById(req.user!.id);
    if (!user) return res.status(404).json({ error: 'User not found' });
    const prefs = (user.preferences ?? {}) as Record<string, unknown>;
    prefs.lastAnnouncementSeen = new Date().toISOString();
    await query(`UPDATE users SET preferences = $1::jsonb WHERE id = $2`, [JSON.stringify(prefs), user.id]);
    res.json({ ok: true });
  });

  // --- personal streaks ------------------------------------------------------------

  /** The signed-in user's quest streak. */
  router.get('/me/streak', requireAuth, async (req, res) => {
    const user = await getUserById(req.user!.id);
    if (!user) return res.status(401).json({ error: 'User not found' });
    const info = await getStreak(user.id);
    // "At risk" = streak alive but no quest yet today and the local evening
    // has begun — the client nudges chat-pill style before the day runs out.
    // Deliberately the STORED streak: at-risk only fires before midnight, while
    // the streak is still salvageable; past midnight the effective streak is 0
    // and there is nothing left to save.
    const atRisk = isStreakAtRisk(info.lastActiveDate, info.currentStreak);
    // The displayed streak reads as 0 once the local day after the last quest
    // has begun — the midnight reset rule (see effectiveStreak in db.ts).
    res.json({ ...info, currentStreak: effectiveStreak(info), atRisk });
  });

  /** This adventurer's quested-day history (streak calendar + 7-day milestones). */
  router.get('/me/streak/calendar', requireAuth, async (req, res) => {
    const user = await getUserById(req.user!.id);
    if (!user) return res.status(401).json({ error: 'User not found' });
    res.json({ days: await getStreakCalendar(user.id) });
  });

  /** Guild streak standings — members by current streak, longest as tiebreak. */
  router.get('/guilds/mine/streaks', requireAuth, async (req, res) => {
    const user = await getUserById(req.user!.id);
    if (!user) return res.status(401).json({ error: 'User not found' });
    const guild = await resolveUserGuild(user);
    if (!guild) return res.status(404).json({ error: 'You are not in a guild' });
    const entries = await getGuildStreaks(guild.id);
    res.json({ guildId: guild.id, entries: entries.map((e) => ({ ...e, avatar: sanitizeAvatar(e.avatar) })) });
  });

  // --- guild settings (teacher-only) ---------------------------------------------

  router.get('/guilds/mine/settings', requireRole('teacher'), async (req, res) => {
    const guild = await getGuildByTeacher(req.user!.id);
    if (!guild) return res.status(404).json({ error: 'You do not lead a guild' });
    const resolved = Object.fromEntries(TERMS.map((t) => [t, resolveTermSettings(t, guild.termSettings)]));
    res.json({ guildId: guild.id, termSettings: resolved });
  });

  router.put('/guilds/mine/settings', requireRole('teacher'), async (req, res) => {
    try {
      const guild = await getGuildByTeacher(req.user!.id);
      if (!guild) return res.status(404).json({ error: 'You do not lead a guild' });
      const sanitized = sanitizeTermSettings(req.body?.termSettings);
      const updated = await updateGuildTermSettings(guild.id, sanitized);
      const resolved = Object.fromEntries(TERMS.map((t) => [t, resolveTermSettings(t, updated.termSettings)]));
      res.json({ guildId: guild.id, termSettings: resolved });
    } catch (e: any) {
      console.error('[saveSettings]', e);
      res.status(500).json({ error: 'Could not save settings' });
    }
  });

  router.get('/terms/current', requireAuth, async (req, res) => {
    const user = await getUserById(req.user!.id);
    if (!user) return res.status(404).json({ error: 'User not found' });
    const guild = await resolveUserGuild(user);
    const term = typeof req.query.term === 'string' && TERMS.includes(req.query.term as any) ? req.query.term : 'prelims';
    const settings = resolveTermSettings(term, guild?.termSettings ?? null);
    res.json({ term, settings, guildId: guild?.id ?? null });
  });

  // --- guild chat ----------------------------------------------------------------
  // Polling-based MVP: clients fetch new messages every few seconds.
  // TODO: upgrade to Supabase Realtime for true push notifications.

  /** Get recent messages for the user's guild. */

  // --- upload & parse a PDF (owner-scoped) ---------------------------------------

  router.post('/upload', requireAuth, upload.single('pdf'), async (req, res) => {
    try {
      if (!req.file) return res.status(400).json({ error: 'No PDF file uploaded (field name must be "pdf").' });
      const fallbackTitle = req.file.originalname.replace(/\.pdf$/i, '').replace(/[_-]+/g, ' ');

      const user = await getUserById(req.user!.id);
      if (!user) return res.status(401).json({ error: 'User not found' });

      // Students in a guild cannot upload their own books — books come from the guild.
      if (user.role === 'student' && user.guildId) {
        return res.status(403).json({ error: 'Guild members play the books their teacher assigns — leave the guild to upload your own.' });
      }

      const parsed = await parsePdf(req.file.buffer, fallbackTitle);
      // Teacher/admin uploads are assigned to the guild they lead; solo students own their books.
      let guildId: string | null = null;
      if (user.role === 'teacher' || user.role === 'admin') {
        const guild = await getGuildByTeacher(user.id);
        guildId = guild?.id ?? null;
      }
      const questCount = clampTargetCount(req.body?.questCount);
      // "1–2 long quests per PDF": how many chapters become quests. Body may be
      // 1-12, or absent/null/'' for auto (capped at 12 at generation time).
      const rawChapters = req.body?.questChapters;
      const nChapters = rawChapters == null || rawChapters === '' ? null : Math.round(Number(rawChapters));
      if (rawChapters != null && rawChapters !== '' && (!Number.isFinite(nChapters) || (nChapters as number) < 1 || (nChapters as number) > 12)) {
        return res.status(400).json({ error: 'questChapters must be 1-12 or null for auto' });
      }
      const questChapters = Number.isFinite(nChapters as number) ? (nChapters as number) : null;
      // Filename detection (${topic}_code.pdf → programming) with explicit
      // teacher override taking precedence.
      const quizMode = detectQuizMode(req.file.originalname, req.body?.quizMode);
      const bookId = await insertBook(parsed.title, req.file.originalname, user.id, guildId, questCount, quizMode, questChapters);
      for (let i = 0; i < parsed.chapters.length; i++) {
        const ch = parsed.chapters[i];
        await insertChapter(bookId, i, ch.title, ch.text, ch.codeBlocks);
      }
      res.json({ bookId, title: parsed.title, quizMode, chapters: parsed.chapters.map((c, i) => ({ idx: i, title: c.title })) });
    } catch (e: any) {
      console.error('[upload]', e);
      res.status(400).json({ error: e?.message || 'Failed to parse PDF' });
    }
  });

  // --- Generate challenges for a book ---------------------------------------------

  router.post('/books/:id/generate', requireAuth, async (req, res) => {
    const bookId = String(req.params.id);
    const book = await getBook(bookId);
    if (!book) return res.status(404).json({ error: 'Book not found' });

    // Only the uploader or the guild teacher can (re)generate.
    const user = await getUserById(req.user!.id);
    if (!user) return res.status(401).json({ error: 'User not found' });
    const isOwner = book.ownerId === user.id;
    const isGuildTeacher = book.guildId && (user.role === 'teacher' || user.role === 'admin') && user.guildId === book.guildId;
    if (!isOwner && !isGuildTeacher) return res.status(403).json({ error: 'Not allowed' });

    // Cache: if challenges already exist, skip regeneration.
    if (await countChallenges(bookId) > 0) {
      return res.json({ bookId, cached: true, challengeCount: await countChallenges(bookId) });
    }

    const term = typeof req.body?.term === 'string' ? req.body.term : 'prelims';
    // A teacher may pass a new quest count on (re)generation; it persists on
    // the book so later auto-cached runs use the same setting.
    if (req.body?.questCount !== undefined) {
      const updated = await updateBookQuestCount(bookId, clampTargetCount(req.body.questCount));
      if (updated) book.questCount = updated.questCount;
    }
    if (req.body?.questChapters !== undefined) {
      const raw = req.body.questChapters;
      const n = raw === null || raw === '' ? null : Math.max(1, Math.min(12, Math.round(Number(raw))));
      if (raw !== null && raw !== '' && !Number.isFinite(n)) {
        return res.status(400).json({ error: 'questChapters must be 1-12 or null for auto' });
      }
      const updated = await updateBookQuestChapters(bookId, Number.isFinite(n as number) ? (n as number) : null);
      if (updated) book.questChapters = updated.questChapters;
    }
    const guild = book.guildId ? await getGuild(book.guildId) : null;
    const result = await generateChallengesForBook(bookId, term, guild?.termSettings ?? null);
    res.json({ bookId, cached: false, questCount: book.questCount, ...result });
  });

  // --- LLM status + regenerate-all (teacher-only) --------------------------------

  router.get('/llm/status', requireRole('teacher'), async (_req, res) => {
    const provider = activeProvider();
    res.json({
      provider, // 'anthropic' | 'openai_compat' | 'none'
      mode: llmModeLabel(),
      model: provider === 'none' ? null : (process.env.LLM_MODEL || process.env.ANTHROPIC_MODEL || null),
      baseUrl: provider === 'openai_compat' ? process.env.OPENAI_BASE_URL : null,
    });
  });

  /**
   * Wipe and regenerate challenges for every book the teacher can touch
   * (guild books for guild leaders, owned books otherwise). Slow with a local
   * LLM — the frontend shows progress and can keep playing meanwhile.
   */
  router.post('/llm/regenerate-all', requireRole('teacher'), async (req, res) => {
    const user = await getUserById(req.user!.id);
    if (!user) return res.status(401).json({ error: 'User not found' });
    const guild = user.role === 'teacher' || user.role === 'admin' ? await getGuildByTeacher(user.id) : null;
    const books = (await listBooks(user.id, guild?.id ?? null)).filter((b) =>
      guild ? b.guildId === guild.id : b.ownerId === user.id
    );
    if (books.length === 0) return res.status(404).json({ error: 'No books to regenerate' });

    const term = typeof req.body?.term === 'string' && TERMS.includes(req.body.term as any) ? req.body.term : 'prelims';
    const results: { bookId: string; title: string; challengeCount: number; llmFailures: number }[] = [];
    for (const book of books) {
      // Replace-per-chapter: each chapter's old challenges are deleted only
      // AFTER its new batch is ready — a failed LLM run can no longer leave a
      // tome empty ("regenerate-all killed every monster").
      const r = await generateChallengesForBook(book.id, term, guild?.termSettings ?? null, 'replace');
      results.push({ bookId: book.id, title: book.title, challengeCount: r.challengeCount, llmFailures: r.llmFailures });
    }
    res.json({ term, mode: isLlmConfigured() ? 'llm' : 'heuristic', results });
  });

  // --- Books / chapters / challenges (owner- or guild-scoped) ----------------------

  router.get('/books', requireAuth, async (req, res) => {
    const user = await getUserById(req.user!.id);
    if (!user) return res.status(401).json({ error: 'User not found' });
    const guild = await resolveUserGuild(user);
    const all = await listBooks(user.id, guild?.id ?? null);
    // Locked / out-of-window books stay invisible to players; their teacher
    // (or owner) still sees them so they can unlock or remove them.
    const books = all.filter((b) => isBookPlayable(b) || canManageBook(user, b));
    // Attach the tome's total challenge count so the dashboard can flag the
    // "no monsters" state (generation failed) instead of a mysterious empty
    // quest on the map.
    const withCounts = await Promise.all(books.map(async (b) => ({
      ...b,
      challengeCount: await countChallenges(b.id),
    })));
    res.json(withCounts);
  });

  router.get('/books/:id', requireAuth, async (req, res) => {
    const book = await getBook(String(req.params.id));
    if (!book) return res.status(404).json({ error: 'Book not found' });
    const user = await getUserById(req.user!.id);
    const allowed = book.ownerId === user?.id || (book.guildId && user?.guildId === book.guildId);
    if (!allowed) return res.status(403).json({ error: 'Not allowed' });
    if (!isBookPlayable(book) && !canManageBook(user!, book)) {
      return res.status(423).json({ error: bookLockedMessage(book) });
    }
    const chapters = await getChapters(book.id);
    const withCounts = await Promise.all(chapters.map(async (c) => ({
      id: c.id, idx: c.idx, title: c.title,
      challengeCount: (await getChallengesForChapter(c.id)).length,
    })));
    res.json({ ...book, chapters: withCounts });
  });

  router.get('/books/:id/chapters/:chapterId/challenges', requireAuth, async (req, res) => {
    const chapterId = String(req.params.chapterId);
    const chapter = await getChapter(chapterId);
    if (!chapter || chapter.bookId !== String(req.params.id)) {
      return res.status(404).json({ error: 'Chapter not found' });
    }
    const book = await getBook(chapter.bookId);
    const user = await getUserById(req.user!.id);
    const allowed = book && (book.ownerId === user?.id || (book.guildId && user?.guildId === book.guildId));
    if (!allowed) return res.status(403).json({ error: 'Not allowed' });
    if (book && !isBookPlayable(book) && !canManageBook(user!, book)) {
      return res.status(423).json({ error: bookLockedMessage(book) });
    }

    // Enforce the teacher's quest rules server-side — for STUDENTS only.
    // Teachers/admins keep preview access to tomes they assigned (their own
    // lock must not lock them out), while guild members and solo students
    // are bound by the cap and the availability window.
    if (user!.role === 'student') {
      const { playable, status } = applyBookRules(book, await getChapters(book.id));
      if (status !== 'open') {
        return res.status(423).json({ error: status === 'locked_window' ? 'locked_window' : 'locked_limit', feature: 'quest' });
      }
      if (!playable.some((c) => c.id === chapterId)) {
        return res.status(423).json({ error: 'locked_limit', feature: 'quest' });
      }
    }

    res.json({ chapter: { id: chapter.id, title: chapter.title }, challenges: await getChallengesForChapter(chapterId) });
  });

  // Lesson overview shown before a student starts the quest. Same access
  // rules as the challenges endpoint — guild members or the book owner.
  router.get('/books/:id/chapters/:chapterId/lesson', requireAuth, async (req, res) => {
    const chapter = await getChapterWithText(String(req.params.chapterId));
    if (!chapter || chapter.bookId !== String(req.params.id)) {
      return res.status(404).json({ error: 'Chapter not found' });
    }
    const book = await getBook(chapter.bookId);
    const user = await getUserById(req.user!.id);
    const allowed = book && (book.ownerId === user?.id || (book.guildId && user?.guildId === book.guildId));
    if (!allowed) return res.status(403).json({ error: 'Not allowed' });
    if (book && !isBookPlayable(book) && !canManageBook(user!, book)) {
      return res.status(423).json({ error: bookLockedMessage(book) });
    }
    res.json(buildLessonOverview(chapter));
  });

  /**
   * Remove a tome entirely. Owner or guild teacher only. Chapters,
   * challenges, progress, and scores cascade away with the book (0001
   * schema); the confirm dialog in the UI makes that cost explicit.
   */
  router.delete('/books/:id', requireAuth, async (req, res) => {
    const book = await getBook(String(req.params.id));
    if (!book) return res.status(404).json({ error: 'Book not found' });
    const user = await getUserById(req.user!.id);
    if (!user || !canManageBook(user, book)) return res.status(403).json({ error: 'Not allowed' });
    await deleteBook(book.id);
    res.json({ ok: true, title: book.title });
  });

  /**
   * Access gate: lock/unlock the tome outright, or set an availability window
   * (time-limited access). Owner or guild teacher only. Body may carry any
   * combination of { locked, availableFrom, availableUntil }; a field set to
   * null clears that bound. Returns the merged gate state.
   */
  router.put('/books/:id/access', requireAuth, async (req, res) => {
    const book = await getBook(String(req.params.id));
    if (!book) return res.status(404).json({ error: 'Book not found' });
    const user = await getUserById(req.user!.id);
    if (!user || !canManageBook(user, book)) return res.status(403).json({ error: 'Not allowed' });

    const body = req.body ?? {};
    const locked = typeof body.locked === 'boolean' ? body.locked : book.locked;
    const parseBound = (v: unknown): Date | null | undefined => {
      if (v === undefined) return undefined;           // leave as-is
      if (v === null || v === '') return null;          // clear
      const d = new Date(String(v));
      return Number.isNaN(d.getTime()) ? undefined : d; // invalid → ignore
    };
    // NB: parseBound's undefined means "leave as-is"; an explicit null must
    // CLEAR the bound, so a plain ?? here would silently keep the old value.
    const fromParsed = parseBound(body.availableFrom);
    const from = fromParsed === undefined ? book.availableFrom : fromParsed;
    const untilParsed = parseBound(body.availableUntil);
    const until = untilParsed === undefined ? book.availableUntil : untilParsed;
    if (from && until && from > until) return res.status(400).json({ error: 'availableFrom must be before availableUntil' });

    await updateBookAccess(book.id, { locked, availableFrom: from, availableUntil: until });
    res.json(bookAccessPayload(await getBook(book.id)));
  });

  router.post('/books/:id/regenerate', requireAuth, async (req, res) => {
    const bookId = String(req.params.id);
    const book = await getBook(bookId);
    if (!book) return res.status(404).json({ error: 'Book not found' });
    const user = await getUserById(req.user!.id);
    const isOwner = book.ownerId === user?.id;
    const isGuildTeacher = book.guildId && (user?.role === 'teacher' || user?.role === 'admin') && user?.guildId === book.guildId;
    if (!isOwner && !isGuildTeacher) return res.status(403).json({ error: 'Not allowed' });

    const term = typeof req.body?.term === 'string' && TERMS.includes(req.body.term as any) ? req.body.term : 'prelims';
    const guild = book.guildId ? await getGuild(book.guildId) : null;
    // Replace-per-chapter, all in one call: every chapter's new batch is
    // generated FIRST and only then swapped in. The old quests stay playable
    // on any failure, and the response reports exactly what happened.
    const result = await generateChallengesForBook(bookId, term, guild?.termSettings ?? null, 'replace');
    res.json({
      ok: result.challengeCount > 0,
      challengeCount: result.challengeCount,
      llmFailures: result.llmFailures,
      failedChapters: result.failedChapters,
      mode: result.mode,
      note: result.challengeCount > 0
        ? 'Challenges regenerated.'
        : 'Generation produced no challenges this run — the previous quests were kept.',
    });
  });

  /**
   * Teacher single-chapter regenerate: rebuild ONE chapter's quest set and
   * leave every other chapter of the tome untouched. Same replace-after-
   * generate safety as the whole-book flow, scoped to a single chapter.
   */
  router.post('/books/:id/chapters/:chapterId/regenerate', requireAuth, async (req, res) => {
    const bookId = String(req.params.id);
    const chapterId = String(req.params.chapterId);
    const book = await getBook(bookId);
    if (!book) return res.status(404).json({ error: 'Book not found' });
    const chapter = await getChapter(chapterId);
    if (!chapter || chapter.bookId !== bookId) return res.status(404).json({ error: 'Chapter not found' });
    const user = await getUserById(req.user!.id);
    if (!user || !canManageBook(user, book)) return res.status(403).json({ error: 'Not allowed' });

    const term = typeof req.body?.term === 'string' && TERMS.includes(req.body.term as any) ? req.body.term : 'prelims';
    const guild = book.guildId ? await getGuild(book.guildId) : null;
    const result = await generateChallengesForBook(bookId, term, guild?.termSettings ?? null, 'replace', chapterId);
    res.json({
      ok: result.challengeCount > 0,
      chapterId,
      challengeCount: result.challengeCount,
      llmFailures: result.llmFailures,
      mode: result.mode,
      note: result.challengeCount > 0
        ? `"${chapter.title}" regenerated — ${result.challengeCount} fresh monsters. The rest of the tome is untouched.`
        : `Generation produced no challenges for "${chapter.title}" this run — its previous quests were kept.`,
    });
  });

  /**
   * Per-book quest settings. Today: questCount (challenges this PDF yields;
   * null clears the override back to "auto") and quizMode ('general' or
   * 'programming' — the teacher override for filename detection). Editing
   * here does NOT regenerate; changes apply on the next (re)generation.
   */
  router.put('/books/:id/settings', requireAuth, async (req, res) => {
    const bookId = String(req.params.id);
    const book = await getBook(bookId);
    if (!book) return res.status(404).json({ error: 'Book not found' });
    const user = await getUserById(req.user!.id);
    const isOwner = book.ownerId === user?.id;
    const isGuildTeacher = book.guildId && (user?.role === 'teacher' || user?.role === 'admin') && user?.guildId === book.guildId;
    if (!isOwner && !isGuildTeacher) return res.status(403).json({ error: 'Not allowed' });

    if (req.body?.questCount !== undefined || req.body?.questChapters !== undefined || req.body?.quizMode !== undefined) {
      let updated = book;
      if (req.body?.questCount !== undefined) {
        updated = await updateBookQuestCount(bookId, clampTargetCount(req.body.questCount)) ?? book;
      }
      if (req.body?.questChapters !== undefined) {
        const raw = req.body.questChapters;
        const n = raw === null || raw === '' ? null : Math.round(Number(raw));
        if (raw !== null && raw !== '' && (!Number.isFinite(n) || (n as number) < 1 || (n as number) > 12)) {
          return res.status(400).json({ error: 'questChapters must be 1-12 or null for auto' });
        }
        updated = await updateBookQuestChapters(bookId, Number.isFinite(n as number) ? (n as number) : null) ?? book;
      }
      if (req.body?.quizMode !== undefined) {
        const raw = req.body.quizMode;
        const mode = ['programming', 'general', 'language'].includes(raw) ? raw : null;
        if (!mode) return res.status(400).json({ error: 'quizMode must be "general" or "programming"' });
        updated = await updateBookQuizMode(bookId, mode) ?? book;
      }
      if (!updated) return res.status(500).json({ error: 'Could not save quest settings' });
      return res.json({ bookId, questCount: updated.questCount, questChapters: updated.questChapters, quizMode: updated.quizMode });
    }
    res.json({ bookId, questCount: book.questCount, questChapters: book.questChapters, quizMode: book.quizMode });
  });

  // --- teacher: review / regenerate individual challenges ------------------------

  /** Every challenge in a book, grouped by chapter — the review screen's feed. */
  router.get('/books/:id/challenges', requireAuth, async (req, res) => {
    const bookId = String(req.params.id);
    const book = await getBook(bookId);
    if (!book) return res.status(404).json({ error: 'Book not found' });
    const user = await getUserById(req.user!.id);
    const allowed = book.ownerId === user?.id || (book.guildId && user?.guildId === book.guildId);
    if (!allowed) return res.status(403).json({ error: 'Not allowed' });
    const chapters = await getChapters(bookId);
    const out = await Promise.all(chapters.map(async (c) => ({
      chapterId: c.id, idx: c.idx, title: c.title,
      challenges: await getChallengesForChapter(c.id),
    })));
    res.json({ bookId, chapters: out });
  });

  /**
   * Reject + regenerate ONE challenge. The LLM is asked for a fresh question on
   * the same chapter; heuristic mode mutates type so the swap is always real.
   * The replacement keeps the same slot (same chapter, new ord at the end of
   * the chapter's bench) so runs in progress are not invalidated mid-flight.
   */
  router.post('/challenges/:id/regenerate', requireAuth, async (req, res) => {
    const challenge = await getChallenge(String(req.params.id));
    if (!challenge) return res.status(404).json({ error: 'Challenge not found' });
    const book = await getBook(challenge.bookId);
    if (!book) return res.status(404).json({ error: 'Book not found' });
    const user = await getUserById(req.user!.id);
    const isOwner = book.ownerId === user?.id;
    const isGuildTeacher = book.guildId && (user?.role === 'teacher' || user?.role === 'admin') && user?.guildId === book.guildId;
    if (!isOwner && !isGuildTeacher) return res.status(403).json({ error: 'Not allowed' });

    const chapter = await getChapter(challenge.chapterId);
    if (!chapter) return res.status(404).json({ error: 'Chapter not found' });
    const term = typeof req.body?.term === 'string' ? req.body.term : 'prelims';
    const guild = book.guildId ? await getGuild(book.guildId) : null;
    const ts = resolveTermSettings(term, guild?.termSettings ?? null);
    const genOpts: GenerationOptions = {
      term,
      monsterDifficulty: ts.monsterDifficulty,
      difficultyMix: ts.difficultyMix,
      targetCount: book.questCount,
    };

    let fresh: GeneratedChallenge | null = null;
    if (isLlmConfigured()) {
      try {
        // Ask for a whole batch, then pick the first challenge that is genuinely
        // different from the rejected one (models love to echo the same idea).
        const content = await generateWithLlm(chapter, genOpts);
        fresh = content.challenges.find((c) => c.prompt.trim() !== challenge.prompt.trim()) ?? content.challenges[0] ?? null;
      } catch (e) {
        console.error('[challengeRegenerate] LLM path failed:', (e as Error).message);
      }
    }
    if (!fresh) {
      // Deterministic fallback: rebuild heuristically and take a challenge whose
      // prompt differs; if nothing differs, still rotate so the teacher sees change.
      const content = generateHeuristically(chapter);
      fresh = content.challenges.find((c) => c.prompt.trim() !== challenge.prompt.trim()) ?? content.challenges[0] ?? null;
    }
    if (!fresh) return res.status(500).json({ error: 'Could not generate a replacement challenge' });

    const ord = await nextChallengeOrd(chapter.id);
    await replaceChallenge(challenge.id, { ...fresh, bookId: chapter.bookId, chapterId: chapter.id, ord, quest: null });
    const updated = await getChallenge(challenge.id);
    res.json({ challenge: updated });
  });

  // --- Progress --------------------------------------------------------------------

  // --- Book quest rules (teacher): per-PDF quest cap + availability window ---
  //
  // quest_limit caps how many chapters of the tome are playable; the window
  // (available_from / available_until) schedules when the whole tome is open.
  // null = unlimited / always. Stored on the books row so every client sees
  // the same rules.

  const TS_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/; // datetime-local or ISO

  router.put('/books/:id/rules', requireAuth, async (req, res) => {
    const book = await getBook(String(req.params.id));
    if (!book) return res.status(404).json({ error: 'Book not found' });
    const user = await getUserById(req.user!.id);
    if (!user) return res.status(401).json({ error: 'User not found' });
    const isOwner = book.ownerId === user.id;
    const isGuildTeacher = book.guildId && (user.role === 'teacher' || user.role === 'admin') && user.guildId === book.guildId;
    if (!isOwner && !isGuildTeacher) return res.status(403).json({ error: 'Not allowed' });

    const b = req.body ?? {};
    let questLimit: number | null = null;
    if (b.questLimit !== null && b.questLimit !== undefined && b.questLimit !== '') {
      questLimit = Math.floor(Number(b.questLimit));
      if (!Number.isFinite(questLimit) || questLimit < 1 || questLimit > 500) {
        return res.status(400).json({ error: 'questLimit must be between 1 and 500 (or null to remove)' });
      }
    }
    const parseTs = (v: unknown): Date | null | string => {
      if (v === null || v === undefined || v === '') return null;
      if (typeof v !== 'string' || !TS_RE.test(v)) return 'bad';
      const d = new Date(v);
      return Number.isNaN(d.getTime()) ? 'bad' : d;
    };
    const from = parseTs(b.availableFrom);
    const until = parseTs(b.availableUntil);
    if (from === 'bad' || until === 'bad') return res.status(400).json({ error: 'availableFrom/availableUntil must be ISO or datetime-local strings' });
    if (from instanceof Date && until instanceof Date && from > until) {
      return res.status(400).json({ error: 'availableFrom must come before availableUntil' });
    }

    const row = await queryOne<{ id: string; quest_limit: number | null; available_from: Date | null; available_until: Date | null }>(
      `UPDATE books
       SET quest_limit = $1, available_from = $2, available_until = $3
       WHERE id = $4
       RETURNING quest_limit, available_from, available_until`,
      [questLimit, from ?? null, until ?? null, book.id],
    );
    res.json({
      ok: true,
      rules: {
        questLimit: row!.quest_limit,
        availableFrom: row!.available_from,
        availableUntil: row!.available_until,
      },
    });
  });

  router.get('/books/:id/progress', requireAuth, async (req, res) => {
    res.json(await getProgress(req.user!.id, String(req.params.id)));
  });

  router.post('/books/:id/progress', requireAuth, async (req, res) => {
    const bookId = String(req.params.id);
    const book = await getBook(bookId);
    if (!book) return res.status(404).json({ error: 'Book not found' });
    const { completedChapters, score, bestStreak } = req.body ?? {};
    const current = await getProgress(req.user!.id, bookId);
    await upsertProgress(req.user!.id, bookId, {
      completedChapters: Array.isArray(completedChapters) ? completedChapters.map(String) : current.completedChapters,
      score: typeof score === 'number' ? score : current.score,
      bestStreak: typeof bestStreak === 'number' ? bestStreak : current.bestStreak,
    });
    res.json(await getProgress(req.user!.id, bookId));
  });

  // --- Score submission (quest completion) -------------------------------------------

  /**
   * Shared quest settlement: writes the score row, applies the coin delta, and
   * updates per-book progress inside ONE Postgres transaction so the score and
   * the balance can never desync (any failure rolls both back).
   *
   * `netCoins` is what actually reaches the balance:
   *   success → the full coin award from the scoring formula;
   *   fail    → max(0, coinsGathered − penalty) — banked coins are never touched.
   */
  async function settleQuest(user: UserRow, chapter: ChapterRow, opts: {
    mistakes: number; timeSeconds: number; finished: boolean; livesRemaining: number;
    term: string; coinsGathered: number; failReason: 'out_of_lives' | 'out_of_time' | null;
    bestStreak: number;
  }) {
    const guild = await resolveUserGuild(user);
    const ts = resolveTermSettings(opts.term, guild?.termSettings ?? null);
    const weights: ScoreWeights = ts.scoreWeights ?? DEFAULT_SCORE_WEIGHTS;

    // The existing scoring formula, unchanged — the fail path feeds it a
    // not-finished (and out-of-life) run so its own penalties apply.
    const result = computeScore(
      { mistakes: opts.mistakes, timeSeconds: opts.timeSeconds, finished: opts.finished, livesRemaining: opts.livesRemaining, outOfLife: opts.failReason === 'out_of_lives' },
      weights,
    );
    const scaled = Math.round(result.rawScore * (ts.pointsMultiplier ?? 1));

    let coinsAwarded: number;
    let coinsPenalty = 0;
    let netCoins: number;
    if (opts.failReason === null) {
      coinsAwarded = result.coins;
      netCoins = coinsAwarded;
    } else {
      // Random penalty against ONLY the coins gathered this run.
      const base = Math.max(0, opts.coinsGathered);
      const frac = FAIL_PENALTY_MIN_PCT + Math.random() * (FAIL_PENALTY_MAX_PCT - FAIL_PENALTY_MIN_PCT);
      coinsPenalty = base > 0 ? Math.min(base, Math.max(1, Math.round(base * frac))) : 0;
      netCoins = Math.max(0, base - coinsPenalty);
      coinsAwarded = 0;
    }

    // Streak tracking: only successful completions advance the daily streak;
    // every 7th consecutive day pays STREAK_BONUS_COINS, credited inside the
    // same transaction as the quest's own coins so the balance stays exact.
    let streak = 0;
    let streakBonus = 0;
    const { scoreRow, newCoins } = await withTransaction(async (tx) => {
      const scoreRow = await insertScoreTx(tx, {
        userId: user.id, chapterId: chapter.id, rawScore: scaled, mistakes: opts.mistakes,
        timeSeconds: opts.timeSeconds, finished: opts.finished, livesRemaining: opts.livesRemaining,
        term: opts.term, coinsAwarded, coinsGathered: opts.coinsGathered, coinsPenalty, netCoins,
        failReason: opts.failReason,
      });
      let coins = await applyCoinsTx(tx, user.id, netCoins);
      if (opts.failReason === null) {
        const s = await updateStreak(user.id, tx);
        streak = s.streak;
        streakBonus = s.bonusAwarded;
        if (streakBonus > 0) {
          coins = await applyCoinsTx(tx, user.id, streakBonus);
          console.log('[streakBonus]', JSON.stringify({ userId: user.id, streak, bonus: streakBonus }));
        }
      }
      const bookProgress = await getProgress(user.id, chapter.bookId);
      // Only a finished quest completes the chapter (and unlocks the next);
      // failed runs still add their score to the book's tally.
      const completed = opts.failReason === null && !bookProgress.completedChapters.includes(chapter.id)
        ? [...bookProgress.completedChapters, chapter.id]
        : bookProgress.completedChapters;
      await upsertProgressTx(tx, user.id, chapter.bookId, {
        completedChapters: completed,
        score: bookProgress.score + scaled,
        bestStreak: Math.max(bookProgress.bestStreak, opts.bestStreak),
      });
      return { scoreRow, newCoins: coins };
    });
    // Fail-event log (score, gathered, penalty, net) — feed for a future
    // teacher guild-roster report.
    console.log('[questSettle]', JSON.stringify({
      userId: user.id, chapterId: chapter.id, term: opts.term,
      outcome: opts.failReason ?? 'completed', score: scaled,
      coinsGathered: opts.coinsGathered, coinsPenalty, netCoins, balance: newCoins,
    }));

    return {
      scoreId: scoreRow.id,
      rawScore: scaled,
      coinsAwarded,
      coinsPenalty,
      netCoins,
      coins: newCoins,
      breakdown: result.breakdown,
      rank: rankForScore(await getTermScore(user.id, opts.term)),
      term: opts.term,
      streak,
      streakBonus,
    };
  }

  router.post('/quests/:chapterId/complete', requireRole('student'), async (req, res) => {
    try {
      const chapterId = String(req.params.chapterId);
      const chapter = await getChapter(chapterId);
      if (!chapter) return res.status(404).json({ error: 'Chapter not found' });

      const user = await getUserById(req.user!.id);
      if (!user) return res.status(401).json({ error: 'User not found' });

      const body = req.body ?? {};
      const finished = body.finished !== false;
      const outOfLife = body.outOfLife === true;

      const r = await settleQuest(user, chapter, {
        mistakes: Math.max(0, Math.floor(Number(body.mistakes) || 0)),
        timeSeconds: Math.max(0, Math.floor(Number(body.timeSeconds) || 0)),
        finished,
        livesRemaining: Math.max(0, Math.min(3, Math.floor(Number(body.livesRemaining) || 0))),
        term: typeof body.term === 'string' && TERMS.includes(body.term) ? body.term : 'prelims',
        coinsGathered: Math.max(0, Math.floor(Number(body.coinsGathered) || 0)),
        bestStreak: Math.floor(Number(body.bestStreak) || 0),
        failReason: finished ? null : (outOfLife ? 'out_of_lives' : 'out_of_time'),
      });

      res.json({
        scoreId: r.scoreId,
        rawScore: r.rawScore,
        coinsAwarded: r.netCoins,
        coins: r.coins,
        breakdown: r.breakdown,
        rank: r.rank,
        term: r.term,
        streak: r.streak,
        streakBonus: r.streakBonus,
      });
    } catch (e: any) {
      console.error('[questComplete]', e);
      res.status(500).json({ error: 'Could not record quest completion' });
    }
  });

  /**
   * Quest FAILED — out of lives or out of time. Scored via the same formula
   * (unfinished + out-of-life penalties apply), then a random coin penalty is
   * taken against only the coins gathered during the run. Banked coins are
   * never touched: the balance receives max(0, gathered − penalty).
   */
  router.post('/quests/:chapterId/fail', requireRole('student'), async (req, res) => {
    try {
      const chapterId = String(req.params.chapterId);
      const chapter = await getChapter(chapterId);
      if (!chapter) return res.status(404).json({ error: 'Chapter not found' });

      const user = await getUserById(req.user!.id);
      if (!user) return res.status(401).json({ error: 'User not found' });

      const body = req.body ?? {};
      const reason = body.reason === 'out_of_time' ? 'out_of_time' : 'out_of_lives';

      const r = await settleQuest(user, chapter, {
        mistakes: Math.max(0, Math.floor(Number(body.mistakes) || 0)),
        timeSeconds: Math.max(0, Math.floor(Number(body.timeSeconds) || 0)),
        finished: false,
        livesRemaining: reason === 'out_of_lives' ? 0 : Math.max(0, Math.min(3, Math.floor(Number(body.livesRemaining) || 0))),
        term: typeof body.term === 'string' && TERMS.includes(body.term) ? body.term : 'prelims',
        coinsGathered: Math.max(0, Math.floor(Number(body.coinsGathered) || 0)),
        bestStreak: Math.floor(Number(body.bestStreak) || 0),
        failReason: reason,
      });

      res.json({
        scoreId: r.scoreId,
        rawScore: r.rawScore,
        coinsAwarded: r.netCoins,
        coinsPenalty: r.coinsPenalty,
        coins: r.coins,
        breakdown: r.breakdown,
        rank: r.rank,
        term: r.term,
      });
    } catch (e: any) {
      console.error('[questFail]', e);
      res.status(500).json({ error: 'Could not record quest failure' });
    }
  });

  // --- Leaderboard --------------------------------------------------------------------

  router.get('/leaderboard', requireAuth, async (req, res) => {
    if (await isFeatureLocked('leaderboard')) return res.status(423).json({ error: 'locked', feature: 'leaderboard' });
    const user = await getUserById(req.user!.id);
    if (!user) return res.status(401).json({ error: 'User not found' });
    const termParam = typeof req.query.term === 'string' ? req.query.term : null;
    const term = termParam && TERMS.includes(termParam as any) ? termParam : null; // null = all-time
    const scope = typeof req.query.scope === 'string' ? req.query.scope : 'guild';

    let guildId: string | null = null;
    if (scope === 'global') {
      guildId = null; // global = all solo adventurers (and only them)
    } else if (user.role === 'teacher') {
      const guild = await getGuildByTeacher(user.id);
      guildId = guild?.id ?? null;
    } else {
      guildId = user.guildId;
    }

    const entries = await getLeaderboard(guildId, term);
    res.json({
      scope: guildId ? 'guild' : 'global',
      term,
      entries: entries.map((e) => ({ ...e, avatar: sanitizeAvatar(e.avatar) })),
    });
  });

  // Express 4 does not catch rejected promises from async handlers — wrap each
  // route's handle in place so rejections become 500s, not process crashes.
  const wrap = (orig: Function) => (req: any, res: any, next: any) =>
    Promise.resolve(orig(req, res, next)).catch(next);
  router.stack.forEach((layer: any) => {
    if (layer.route) {
      for (const h of layer.route.stack) {
        if (h.handle.length < 4) {
          const orig = h.handle;
          h.handle = wrap(orig);
        }
      }
    }
  });

  // --- Coins ----------------------------------------------------------------------------

  router.get('/coins', requireAuth, async (req, res) => {
    const user = await getUserById(req.user!.id);
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json({ coins: user.coins });
  });

  // --- error handling -----------------------------------------------------------------

  /**
   * Body-parser / multer errors arrive here as `next(err)` with a 4xx-ish
   * `status` (oversized JSON, non-PDF upload, malformed multipart). Without
   * this handler Express answers with its HTML error page, which the client's
   * `await res.json()` turns into the opaque "Request failed (500)".
   */
  router.use((err: any, _req: express.Request, res: express.Response, next: express.NextFunction) => {
    if (res.headersSent) return next(err);
    // Multer errors (wrong field name, non-PDF, oversized file) carry a `code`
    // but no `status` — map them to 400 instead of falling through to 500.
    if (err?.name === 'MulterError') {
      const friendly = err.code === 'LIMIT_FILE_SIZE'
        ? 'That file is too large (25 MB max for PDFs).'
        : `Upload rejected: ${err.message}`;
      return res.status(400).json({ error: friendly });
    }
    const status = Number(err?.status || err?.statusCode || 0);
    if (status >= 400 && status < 600) {
      return res.status(status).json({ error: String(err.message || err.code || 'Bad request') });
    }
    return next(err);
  });

  /** Final handler: anything uncaught becomes JSON, never an HTML stack page. */
  router.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    console.error('[api] unhandled route error:', err);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Something went wrong on the server — please try again.' });
    }
  });

  return router;
}
