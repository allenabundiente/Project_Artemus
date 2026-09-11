import { Router, json } from 'express';
import multer from 'multer';
import { parsePdf } from '../services/pdfParser.js';
import { generateWithLlm, generateHeuristically, type ChapterContent, type GenerationOptions } from '../services/contentGenerator.js';
import { isLlmConfigured, activeProvider, llmModeLabel } from '../services/llmClient.js';
import { computeScore, DEFAULT_SCORE_WEIGHTS, type ScoreWeights } from '../services/scoring.js';
import { resolveTermSettings, sanitizeTermSettings, TERMS, type TermSettings } from '../services/termSettings.js';
import { buildLessonOverview } from '../services/lesson.js';
import { hashPassword, verifyPassword, requireAuth, requireAdmin, requireRole, signToken } from '../services/auth.js';
import { isFeatureLocked, sanitizeAvatar } from '../db/admin.js';
import { registerAdminRoutes, listCustomThemes } from './admin.js';
import {
  initDbResilient, query, queryOne, withTransaction, applyCoinsTx, insertScoreTx, upsertProgressTx,
  insertBook, insertChapter, insertChallenge, getBook, listBooks,
  getChapters, getChapter, getChallengesForChapter, getChapterWithText,
  countChallenges, deleteChallengesForBook, getProgress, upsertProgress,
  getUserByEmail, getUserById, insertUser, addCoins,
  insertGuild, regeneratePasscode, getGuild, getGuildByTeacher, getGuildByPasscode,
  updateGuildTermSettings, joinGuild, leaveGuild, listGuildMembers,
  insertScore, getLeaderboard, getTermScore, rankForScore, DEFAULT_RANK_TIERS,
  getGlobalMapConfig, getGuildMapSettings, setGuildMapTheme,
  listGuildsWithCounts, removeGuildMember,
  type GuildRow, type UserRow, type ChapterRow,
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
  guildSettings: Record<string, unknown> | null
): Promise<{ challengeCount: number; llmFailures: number; mode: 'llm' | 'heuristic' }> {
  const ts = resolveTermSettings(term, guildSettings);
  const genOpts: GenerationOptions = {
    term,
    monsterDifficulty: ts.monsterDifficulty,
    difficultyMix: ts.difficultyMix,
  };
  const chapters = await getChapters(bookId);
  const useLlm = isLlmConfigured();
  let generated = 0;
  let llmFailures = 0;

  for (const chapter of chapters.slice(0, 12)) {
    let content: ChapterContent;
    try {
      content = useLlm ? await generateWithLlm(chapter, genOpts) : generateHeuristically(chapter);
    } catch (e) {
      llmFailures++;
      console.error(`[generate] chapter "${chapter.title}" fell back to heuristics:`, (e as Error).message);
      content = generateHeuristically(chapter);
    }
    for (let i = 0; i < content.challenges.length; i++) {
      await insertChallenge({ bookId, chapterId: chapter.id, ...content.challenges[i], ord: i });
    }
    generated += content.challenges.length;
  }
  return { challengeCount: generated, llmFailures, mode: useLlm ? 'llm' : 'heuristic' };
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
  router.get('/themes', requireAuth, (_req, res) => {
    res.json({
      themes: [
        { id: 'dungeon', name: 'Dungeon Night', builtin: true },
        { id: 'forest', name: 'Firefly Glade', builtin: true },
        ...listCustomThemes().map((t) => ({ id: t.id, name: String(t.name ?? t.id), builtin: false })),
      ],
    });
  });

  registerAdminRoutes(router);

  // --- map (theme) resolution ---------------------------------------------------
  //
  // Resolution order: teacher's guild skin → admin global config →
  // random by difficulty (deterministic per chapter+difficulty so all students
  // in the same chapter+difficulty see the same realm, and revisits match).
  const DIFFICULTY_THEMES: Record<string, string[]> = {
    easy: ['forest', 'dungeon'],
    medium: ['dungeon', 'forest'],
    hard: ['dungeon'],
  };
  // Custom themes join the random pools so admins' maps appear without a
  // teacher pinning them.
  const customIds = listCustomThemes().map((t) => t.id);
  if (customIds.length > 0) {
    DIFFICULTY_THEMES.easy = [...DIFFICULTY_THEMES.easy, ...customIds];
    DIFFICULTY_THEMES.medium = [...DIFFICULTY_THEMES.medium, ...customIds];
    DIFFICULTY_THEMES.hard = [...DIFFICULTY_THEMES.hard, ...customIds];
  }
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
      const known = ['dungeon', 'forest'].includes(cfg.fixedTheme) || listCustomThemes().some((t) => t.id === cfg.fixedTheme);
      if (known) return res.json({ theme: cfg.fixedTheme, source: 'admin' as const });
    }

    // 3. Random by difficulty — deterministic hash so revisits agree.
    const diff = typeof req.query.difficulty === 'string' ? req.query.difficulty : 'medium';
    const pool = DIFFICULTY_THEMES[diff] ?? DIFFICULTY_THEMES.medium;
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
      const bookId = await insertBook(parsed.title, req.file.originalname, user.id, guildId);
      for (let i = 0; i < parsed.chapters.length; i++) {
        const ch = parsed.chapters[i];
        await insertChapter(bookId, i, ch.title, ch.text, ch.codeBlocks);
      }
      res.json({ bookId, title: parsed.title, chapters: parsed.chapters.map((c, i) => ({ idx: i, title: c.title })) });
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
    const guild = book.guildId ? await getGuild(book.guildId) : null;
    const result = await generateChallengesForBook(bookId, term, guild?.termSettings ?? null);
    res.json({ bookId, cached: false, ...result });
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
      await deleteChallengesForBook(book.id);
      const r = await generateChallengesForBook(book.id, term, guild?.termSettings ?? null);
      results.push({ bookId: book.id, title: book.title, challengeCount: r.challengeCount, llmFailures: r.llmFailures });
    }
    res.json({ term, mode: isLlmConfigured() ? 'llm' : 'heuristic', results });
  });

  // --- Books / chapters / challenges (owner- or guild-scoped) ----------------------

  router.get('/books', requireAuth, async (req, res) => {
    const user = await getUserById(req.user!.id);
    if (!user) return res.status(401).json({ error: 'User not found' });
    const guild = await resolveUserGuild(user);
    const books = await listBooks(user.id, guild?.id ?? null);
    res.json(books);
  });

  router.get('/books/:id', requireAuth, async (req, res) => {
    const book = await getBook(String(req.params.id));
    if (!book) return res.status(404).json({ error: 'Book not found' });
    const user = await getUserById(req.user!.id);
    const allowed = book.ownerId === user?.id || (book.guildId && user?.guildId === book.guildId);
    if (!allowed) return res.status(403).json({ error: 'Not allowed' });
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
    res.json(buildLessonOverview(chapter));
  });

  router.post('/books/:id/regenerate', requireAuth, async (req, res) => {
    const bookId = String(req.params.id);
    const book = await getBook(bookId);
    if (!book) return res.status(404).json({ error: 'Book not found' });
    const user = await getUserById(req.user!.id);
    const isOwner = book.ownerId === user?.id;
    const isGuildTeacher = book.guildId && (user?.role === 'teacher' || user?.role === 'admin') && user?.guildId === book.guildId;
    if (!isOwner && !isGuildTeacher) return res.status(403).json({ error: 'Not allowed' });
    await deleteChallengesForBook(bookId);
    res.json({ ok: true, note: 'Challenges cleared; call generate again.' });
  });

  // --- Progress --------------------------------------------------------------------

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

    const { scoreRow, newCoins } = await withTransaction(async (tx) => {
      const scoreRow = await insertScoreTx(tx, {
        userId: user.id, chapterId: chapter.id, rawScore: scaled, mistakes: opts.mistakes,
        timeSeconds: opts.timeSeconds, finished: opts.finished, livesRemaining: opts.livesRemaining,
        term: opts.term, coinsAwarded, coinsGathered: opts.coinsGathered, coinsPenalty, netCoins,
        failReason: opts.failReason,
      });
      const newCoins = await applyCoinsTx(tx, user.id, netCoins);
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
      return { scoreRow, newCoins };
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

  return router;
}
