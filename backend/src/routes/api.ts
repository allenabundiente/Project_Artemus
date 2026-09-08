import { Router, json } from 'express';
import multer from 'multer';
import { parsePdf } from '../services/pdfParser.js';
import { generateWithLlm, generateHeuristically, type ChapterContent, type GenerationOptions } from '../services/contentGenerator.js';
import { computeScore, DEFAULT_SCORE_WEIGHTS, type ScoreWeights } from '../services/scoring.js';
import { resolveTermSettings, sanitizeTermSettings, TERMS, type TermSettings } from '../services/termSettings.js';
import { hashPassword, verifyPassword, requireAuth, requireRole, signToken } from '../services/auth.js';
import {
  initDbResilient, query, queryOne,
  insertBook, insertChapter, insertChallenge, getBook, listBooks,
  getChapters, getChapter, getChallengesForChapter,
  countChallenges, deleteChallengesForBook, getProgress, upsertProgress,
  getUserByEmail, getUserById, insertUser, addCoins,
  insertGuild, regeneratePasscode, getGuild, getGuildByTeacher, getGuildByPasscode,
  updateGuildTermSettings, joinGuild, leaveGuild, listGuildMembers,
  insertScore, getLeaderboard, getTermScore, rankForScore, DEFAULT_RANK_TIERS,
  type GuildRow, type UserRow,
} from '../db/db.js';

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
    const guild = user.guildId ? await getGuild(user.guildId) : null;
    res.json({ user: publicUser(user), guild: guild ? { id: guild.id, name: guild.name } : null });
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
      return { id: m.id, name: m.name, rank: rankForScore(termScore), score: termScore, lastActive: m.createdAt };
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
      return { id: m.id, name: m.name, rank: rankForScore(termScore), score: termScore, lastActive: m.createdAt };
    }));
    res.json({ roster });
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
    const guild = user.guildId ? await getGuild(user.guildId) : null;
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
      // Teacher uploads are assigned to the guild they lead; solo students own their books.
      let guildId: string | null = null;
      if (user.role === 'teacher') {
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
    const isGuildTeacher = book.guildId && user.role === 'teacher' && user.guildId === book.guildId;
    if (!isOwner && !isGuildTeacher) return res.status(403).json({ error: 'Not allowed' });

    // Cache: if challenges already exist, skip regeneration.
    if (await countChallenges(bookId) > 0) {
      return res.json({ bookId, cached: true, challengeCount: await countChallenges(bookId) });
    }

    const term = typeof req.body?.term === 'string' ? req.body.term : 'prelims';
    const guild = book.guildId ? await getGuild(book.guildId) : null;
    const ts = resolveTermSettings(term, guild?.termSettings ?? null);
    const genOpts: GenerationOptions = {
      term,
      monsterDifficulty: ts.monsterDifficulty,
      difficultyMix: ts.difficultyMix,
    };

    const chapters = await getChapters(bookId);
    const useLlm = !!process.env.ANTHROPIC_API_KEY;
    let generated = 0;
    let llmFailures = 0;

    for (const chapter of chapters.slice(0, 12)) {
      let content: ChapterContent;
      try {
        content = useLlm ? await generateWithLlm(chapter, genOpts) : generateHeuristically(chapter);
      } catch (e) {
        llmFailures++;
        content = generateHeuristically(chapter);
      }
      for (let i = 0; i < content.challenges.length; i++) {
        await insertChallenge({ bookId, chapterId: chapter.id, ...content.challenges[i], ord: i });
      }
      generated += content.challenges.length;
    }

    res.json({ bookId, cached: false, challengeCount: generated, llmFailures, mode: useLlm ? 'llm' : 'heuristic' });
  });

  // --- Books / chapters / challenges (owner- or guild-scoped) ----------------------

  router.get('/books', requireAuth, async (req, res) => {
    const user = await getUserById(req.user!.id);
    if (!user) return res.status(401).json({ error: 'User not found' });
    const books = await listBooks(user.id, user.guildId);
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

  router.post('/books/:id/regenerate', requireAuth, async (req, res) => {
    const bookId = String(req.params.id);
    const book = await getBook(bookId);
    if (!book) return res.status(404).json({ error: 'Book not found' });
    const user = await getUserById(req.user!.id);
    const isOwner = book.ownerId === user?.id;
    const isGuildTeacher = book.guildId && user?.role === 'teacher' && user?.guildId === book.guildId;
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

  router.post('/quests/:chapterId/complete', requireRole('student'), async (req, res) => {
    try {
      const chapterId = String(req.params.chapterId);
      const chapter = await getChapter(chapterId);
      if (!chapter) return res.status(404).json({ error: 'Chapter not found' });

      const user = await getUserById(req.user!.id);
      if (!user) return res.status(401).json({ error: 'User not found' });

      const body = req.body ?? {};
      const mistakes = Math.max(0, Math.floor(Number(body.mistakes) || 0));
      const timeSeconds = Math.max(0, Math.floor(Number(body.timeSeconds) || 0));
      const finished = body.finished !== false;
      const livesRemaining = Math.max(0, Math.min(3, Math.floor(Number(body.livesRemaining) || 0)));
      const outOfLife = body.outOfLife === true;
      const term = typeof body.term === 'string' && TERMS.includes(body.term) ? body.term : 'prelims';

      const guild = user.guildId ? await getGuild(user.guildId) : null;
      const ts = resolveTermSettings(term, guild?.termSettings ?? null);
      const weights: ScoreWeights = ts.scoreWeights ?? DEFAULT_SCORE_WEIGHTS;

      const result = computeScore({ mistakes, timeSeconds, finished, livesRemaining, outOfLife }, weights);
      const scaled = Math.round(result.rawScore * (ts.pointsMultiplier ?? 1));
      const coins = result.coins;

      const scoreRow = await insertScore({
        userId: user.id, chapterId, rawScore: scaled, mistakes, timeSeconds,
        finished, livesRemaining, term, coinsAwarded: coins,
      });
      const newCoins = await addCoins(user.id, coins);

      // Also update per-book progress (score accumulates).
      const bookProgress = await getProgress(user.id, chapter.bookId);
      const completed = bookProgress.completedChapters.includes(chapterId)
        ? bookProgress.completedChapters
        : [...bookProgress.completedChapters, chapterId];
      await upsertProgress(user.id, chapter.bookId, {
        completedChapters: completed,
        score: bookProgress.score + scaled,
        bestStreak: Math.max(bookProgress.bestStreak, Math.floor(Number(body.bestStreak) || 0)),
      });

      res.json({
        scoreId: scoreRow.id,
        rawScore: scaled,
        coinsAwarded: coins,
        coins: newCoins,
        breakdown: result.breakdown,
        rank: rankForScore(await getTermScore(user.id, term)),
        term,
      });
    } catch (e: any) {
      console.error('[questComplete]', e);
      res.status(500).json({ error: 'Could not record quest completion' });
    }
  });

  // --- Leaderboard --------------------------------------------------------------------

  router.get('/leaderboard', requireAuth, async (req, res) => {
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
      entries,
    });
  });

  // --- Coins ----------------------------------------------------------------------------

  router.get('/coins', requireAuth, async (req, res) => {
    const user = await getUserById(req.user!.id);
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json({ coins: user.coins });
  });

  return router;
}
