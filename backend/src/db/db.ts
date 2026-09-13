// Postgres data layer (Supabase-compatible) replacing the old SQLite store.
// Node-postgres with a connection pool. All schema lives in backend/migrations/*.sql
// which are applied to Supabase via the SQL editor / CLI.
import pg from 'pg';
import type { CodeBlock, ChallengeRow, ChapterRow, ProgressRow } from './types.js';

export { type CodeBlock, type ChallengeRow, type ChapterRow, type ProgressRow } from './types.js';

const connectionString = process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/questbook';

export const pool = new pg.Pool({
  connectionString,
  max: 10,
  idleTimeoutMillis: 30_000,
});

export async function initDb(): Promise<void> {
  // Verify connectivity at startup; the actual schema is applied via migrations.
  // Non-fatal: if the DB is briefly unavailable (e.g. Supabase cold start), we
  // log and retry in the background instead of taking the server down.
  const client = await pool.connect();
  try {
    await client.query('SELECT 1');
    console.log(`[db] connected to Postgres (${connectionString.replace(/:[^:@/]+@/, ':****@')})`);
  } finally {
    client.release();
  }
}

export function initDbResilient(): void {
  const attempt = (n: number) => {
    initDb()
      .catch((e) => {
        console.error(`[db] not reachable yet (attempt ${n}): ${e.message}`);
        if (n < 10) setTimeout(() => attempt(n + 1), 3000);
      });
  };
  attempt(1);
}

export async function query<T extends pg.QueryResultRow>(sql: string, params: unknown[] = []): Promise<T[]> {
  const res = await pool.query<T>(sql, params);
  return res.rows;
}

/** Run a write statement (INSERT/UPDATE/DELETE) and return the affected row count. */
export async function execute(sql: string, params: unknown[] = []): Promise<number> {
  const res = await pool.query(sql, params);
  return res.rowCount ?? 0;
}

/**
 * Anything that can run parameterized queries: the shared pool, or a client
 * enrolled in an open transaction (see withTransaction).
 */
export interface DbExecutor {
  query<T extends pg.QueryResultRow>(sql: string, params?: unknown[]): Promise<pg.QueryResult<T>>;
}

/**
 * Run `fn` inside a single Postgres transaction. Every write it makes commits
 * together or not at all — used so a quest's score write and its coin award
 * can never desync (a crash mid-sequence rolls BOTH back).
 */
export async function withTransaction<T>(fn: (tx: DbExecutor) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const out = await fn(client as DbExecutor);
    await client.query('COMMIT');
    return out;
  } catch (e) {
    try {
      await client.query('ROLLBACK');
    } catch {
      // Connection already dead — the (implicit) transaction is rolled back anyway.
    }
    throw e;
  } finally {
    client.release();
  }
}

export async function queryOne<T extends pg.QueryResultRow>(sql: string, params: unknown[] = []): Promise<T | null> {
  const rows = await query<T>(sql, params);
  return rows[0] ?? null;
}

// --- row mappers (snake_case DB → camelCase TS) -----------------------------

export type QuizMode = 'general' | 'programming' | 'language';

export interface BookRow {
  id: string;
  title: string;
  filename: string;
  ownerId: string | null;
  guildId: string | null;
  /** Teacher-chosen challenges per chapter for THIS book (null = auto). */
  questCount: number | null;
  /** 'general' (any subject) or 'programming' (code-flavored questions). */
  quizMode: QuizMode;
  createdAt: Date;
}

function mapBook(r: any): BookRow {
  return { id: r.id, title: r.title, filename: r.filename, ownerId: r.owner_id ?? null, guildId: r.guild_id ?? null, questCount: r.quest_count ?? null,  quizMode: ['programming', 'language'].includes(r.quiz_mode) ? r.quiz_mode : 'general', createdAt: r.created_at };
}

export interface UserRow {
  id: string;
  name: string;
  email: string;
  passwordHash: string;
  role: 'teacher' | 'student' | 'admin';
  guildId: string | null;
  coins: number;
  /** Wardrobe/avatar + misc prefs (jsonb). */
  preferences: Record<string, unknown>;
  createdAt: Date;
}

function mapUser(r: any): UserRow {
  return { id: r.id, name: r.name, email: r.email, passwordHash: r.password_hash, role: r.role, guildId: r.guild_id ?? null, coins: r.coins, preferences: r.preferences ?? {}, createdAt: r.created_at };
}

export interface GuildRow {
  id: string;
  name: string;
  passcode: string;
  teacherId: string;
  termSettings: Record<string, unknown>;
  /** Optional per-guild map skin ({ theme }) — set by the teacher. */
  mapSettings: Record<string, unknown>;
  createdAt: Date;
}

function mapGuild(r: any): GuildRow {
  return { id: r.id, name: r.name, passcode: r.passcode, teacherId: r.teacher_id, termSettings: r.term_settings ?? {}, mapSettings: r.map_settings ?? {}, createdAt: r.created_at };
}

export interface ScoreRow {
  id: string;
  userId: string;
  chapterId: string | null;
  guildId: string | null;
  rawScore: number;
  mistakes: number;
  timeSeconds: number;
  finished: boolean;
  livesRemaining: number;
  term: string;
  coinsAwarded: number;
  /** Coins picked up during the run (fail accounting). */
  coinsGathered: number;
  /** Random penalty applied on fail (never dips into banked coins). */
  coinsPenalty: number;
  /** What actually hit the balance: netCoins = max(0, gathered − penalty). */
  netCoins: number;
  /** How the run ended, when it ended badly. */
  failReason: 'out_of_lives' | 'out_of_time' | null;
  createdAt: Date;
}

function mapScore(r: any): ScoreRow {
  return {
    id: r.id, userId: r.user_id, chapterId: r.chapter_id ?? null, guildId: r.guild_id ?? null,
    rawScore: r.raw_score, mistakes: r.mistakes, timeSeconds: r.time_seconds,
    finished: r.finished, livesRemaining: r.lives_remaining, term: r.term,
    coinsAwarded: r.coins_awarded, coinsGathered: r.coins_gathered ?? 0,
    coinsPenalty: r.coins_penalty ?? 0, netCoins: r.net_coins ?? r.coins_awarded ?? 0,
    failReason: r.fail_reason ?? null, createdAt: r.created_at,
  };
}

// --- books / chapters / challenges -------------------------------------------

export async function insertBook(title: string, filename: string, ownerId: string | null, guildId: string | null, questCount: number | null = null, quizMode: QuizMode = 'general'): Promise<string> {
  const row = await queryOne<{ id: string }>(
    `INSERT INTO books (title, filename, owner_id, guild_id, quest_count, quiz_mode) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
    [title, filename, ownerId, guildId, questCount, quizMode]
  );
  return row!.id;
}

/** Set (or clear) the per-book quiz mode ('general' | 'programming'). */
export async function updateBookQuizMode(bookId: string, quizMode: QuizMode): Promise<BookRow | null> {
  const row = await queryOne(`UPDATE books SET quiz_mode = $2 WHERE id = $1 RETURNING *`, [bookId, quizMode]);
  return row ? mapBook(row) : null;
}

/** Set (or clear) the per-book challenge count a teacher asked for. */
export async function updateBookQuestCount(bookId: string, questCount: number | null): Promise<BookRow | null> {
  const row = await queryOne(`UPDATE books SET quest_count = $2 WHERE id = $1 RETURNING *`, [bookId, questCount]);
  return row ? mapBook(row) : null;
}

export async function insertChapter(bookId: string, idx: number, title: string, text: string, codeBlocks: CodeBlock[]): Promise<string> {
  const row = await queryOne<{ id: string }>(
    `INSERT INTO chapters (book_id, idx, title, text, code_blocks) VALUES ($1, $2, $3, $4, $5::jsonb) RETURNING id`,
    [bookId, idx, title, text, JSON.stringify(codeBlocks)]
  );
  return row!.id;
}

export async function insertChallenge(c: Omit<ChallengeRow, 'id'>): Promise<string> {
  const row = await queryOne<{ id: string }>(
    `INSERT INTO challenges (book_id, chapter_id, type, prompt, code, options, correct_answer, explanation, difficulty, ord)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, $9, $10) RETURNING id`,
    [c.bookId, c.chapterId, c.type, c.prompt, c.code, c.options ? JSON.stringify(c.options) : null, c.correctAnswer, c.explanation, c.difficulty, c.ord]
  );
  return row!.id;
}

export async function listBooks(ownerId: string | null, guildId: string | null): Promise<BookRow[]> {
  // A book is visible to its uploading owner and to members of its guild.
  const rows = await query(
    `SELECT * FROM books
     WHERE ($1::uuid IS NOT NULL AND owner_id = $1::uuid)
        OR ($2::uuid IS NOT NULL AND guild_id = $2::uuid)
     ORDER BY created_at DESC`,
    [ownerId, guildId]
  );
  return rows.map(mapBook);
}

export async function getBook(id: string): Promise<BookRow | null> {
  const row = await queryOne(`SELECT * FROM books WHERE id = $1`, [id]);
  return row ? mapBook(row) : null;
}

export async function getChapters(bookId: string): Promise<ChapterRow[]> {
  const rows = await query(`SELECT * FROM chapters WHERE book_id = $1 ORDER BY idx`, [bookId]);
  return rows.map((r: any) => ({ id: r.id, bookId: r.book_id, idx: r.idx, title: r.title, text: r.text, codeBlocks: r.code_blocks ?? [] }));
}

export async function getChapter(id: string): Promise<ChapterRow | null> {
  const row = await queryOne(`SELECT * FROM chapters WHERE id = $1`, [id]);
  if (!row) return null;
  return { id: row.id, bookId: row.book_id, idx: row.idx, title: row.title, text: row.text, codeBlocks: (row as any).code_blocks ?? [] };
}

function mapChallenge(r: any): ChallengeRow {
  return {
    id: r.id, bookId: r.book_id, chapterId: r.chapter_id, type: r.type, prompt: r.prompt,
    code: r.code ?? null, options: r.options ?? null, correctAnswer: r.correct_answer,
    explanation: r.explanation, difficulty: r.difficulty, ord: r.ord,
  };
}

export async function getChallengesForBook(bookId: string): Promise<ChallengeRow[]> {
  const rows = await query(`SELECT * FROM challenges WHERE book_id = $1 ORDER BY chapter_id, ord`, [bookId]);
  return rows.map(mapChallenge);
}

export async function getChallengesForChapter(chapterId: string): Promise<ChallengeRow[]> {
  const rows = await query(`SELECT * FROM challenges WHERE chapter_id = $1 ORDER BY ord`, [chapterId]);
  return rows.map(mapChallenge);
}

export async function getChallenge(id: string): Promise<ChallengeRow | null> {
  const row = await queryOne(`SELECT * FROM challenges WHERE id = $1`, [id]);
  return row ? mapChallenge(row) : null;
}

/** Replace one challenge in place (same id, chapter, and ord) — review/regenerate. */
export async function replaceChallenge(id: string, c: Omit<ChallengeRow, 'id'>): Promise<void> {
  await query(
    `UPDATE challenges SET type = $2, prompt = $3, code = $4, options = $5::jsonb, correct_answer = $6, explanation = $7, difficulty = $8, ord = $9
     WHERE id = $1`,
    [id, c.type, c.prompt, c.code, c.options ? JSON.stringify(c.options) : null, c.correctAnswer, c.explanation, c.difficulty, c.ord]
  );
}

/** Max ord currently used in a chapter (for appending regenerated challenges). */
export async function nextChallengeOrd(chapterId: string): Promise<number> {
  const row = await queryOne<{ n: number | null }>(`SELECT MAX(ord) AS n FROM challenges WHERE chapter_id = $1`, [chapterId]);
  return (row?.n ?? -1) + 1;
}

export async function getChapterWithText(chapterId: string): Promise<ChapterRow | null> {
  const row = await queryOne<ChapterRow>(
    `SELECT id, book_id AS "bookId", idx, title, text, code_blocks AS "codeBlocks" FROM chapters WHERE id = $1`,
    [chapterId],
  );
  return row ?? null;
}

export async function countChallenges(bookId: string): Promise<number> {
  const row = await queryOne<{ c: string }>(`SELECT COUNT(*)::int AS c FROM challenges WHERE book_id = $1`, [bookId]);
  return row ? Number(row.c) : 0;
}

export async function deleteChallengesForBook(bookId: string): Promise<void> {
  await query(`DELETE FROM challenges WHERE book_id = $1`, [bookId]);
}

// --- progress -----------------------------------------------------------------

export async function getProgress(userId: string, bookId: string): Promise<ProgressRow> {
  const row = await queryOne(`SELECT completed_chapters, score, best_streak FROM progress WHERE user_id = $1 AND book_id = $2`, [userId, bookId]);
  if (!row) return { completedChapters: [], score: 0, bestStreak: 0 };
  return {
    completedChapters: ((row.completed_chapters as unknown[]) ?? []).map(String),
    score: row.score,
    bestStreak: row.best_streak,
  };
}

export async function upsertProgress(userId: string, bookId: string, p: ProgressRow): Promise<void> {
  await query(
    `INSERT INTO progress (user_id, book_id, completed_chapters, score, best_streak)
     VALUES ($1, $2, $3::jsonb, $4, $5)
     ON CONFLICT (user_id, book_id) DO UPDATE SET
       completed_chapters = excluded.completed_chapters,
       score = excluded.score,
       best_streak = excluded.best_streak,
       updated_at = now()`,
    [userId, bookId, JSON.stringify(p.completedChapters), p.score, p.bestStreak]
  );
}

  /** Executor-aware per-book progress upsert for transactional quest flows. */
export async function upsertProgressTx(ex: DbExecutor, userId: string, bookId: string, p: ProgressRow): Promise<void> {
  await ex.query(
    `INSERT INTO progress (user_id, book_id, completed_chapters, score, best_streak)
     VALUES ($1, $2, $3::jsonb, $4, $5)
     ON CONFLICT (user_id, book_id) DO UPDATE SET
       completed_chapters = excluded.completed_chapters,
       score = excluded.score,
       best_streak = excluded.best_streak,
       updated_at = now()`,
    [userId, bookId, JSON.stringify(p.completedChapters), p.score, p.bestStreak]
  );
}

// --- users ---------------------------------------------------------------------

export async function getUserByEmail(email: string): Promise<UserRow | null> {
  const row = await queryOne(`SELECT * FROM users WHERE lower(email) = lower($1)`, [email]);
  return row ? mapUser(row) : null;
}

export async function getUserById(id: string): Promise<UserRow | null> {
  const row = await queryOne(`SELECT * FROM users WHERE id = $1`, [id]);
  return row ? mapUser(row) : null;
}

export async function insertUser(name: string, email: string, passwordHash: string, role: 'teacher' | 'student'): Promise<UserRow> {
  const row = await queryOne(`INSERT INTO users (name, email, password_hash, role) VALUES ($1, $2, $3, $4) RETURNING *`, [name, email, passwordHash, role]);
  return mapUser(row);
}

export async function addCoins(userId: string, amount: number): Promise<number> {
  const row = await queryOne(`UPDATE users SET coins = coins + $1 WHERE id = $2 RETURNING coins`, [amount, userId]);
  return row ? Number(row.coins) : 0;
}

/**
 * Apply a coin delta on an open transaction (positive or negative) and return
 * the new balance. Used by the transactional quest flows so the score row and
 * the balance change commit together.
 */
export async function applyCoinsTx(ex: DbExecutor, userId: string, amount: number): Promise<number> {
  const res = await ex.query<{ coins: number }>(
    `UPDATE users SET coins = coins + $1 WHERE id = $2 RETURNING coins`,
    [amount, userId],
  );
  return res.rows[0] ? Number(res.rows[0].coins) : 0;
}

const PASSCODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // no ambiguous 0/O/1/L/I

export function generatePasscode(): string {
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += PASSCODE_ALPHABET[Math.floor(Math.random() * PASSCODE_ALPHABET.length)];
  }
  return code;
}

export async function insertGuild(name: string, teacherId: string): Promise<GuildRow> {
  // Retry a few times in the (unlikely) event of a passcode collision.
  for (let attempt = 0; attempt < 5; attempt++) {
    const passcode = generatePasscode();
    try {
      const row = await queryOne(
        `INSERT INTO guilds (name, passcode, teacher_id) VALUES ($1, $2, $3) RETURNING *`,
        [name, passcode, teacherId]
      );
      return mapGuild(row);
    } catch (e: any) {
      if (e?.code === '23505') continue; // unique violation on passcode — retry
      throw e;
    }
  }
  throw new Error('Could not generate a unique passcode');
}

export async function regeneratePasscode(guildId: string): Promise<GuildRow> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const passcode = generatePasscode();
    try {
      const row = await queryOne(`UPDATE guilds SET passcode = $1 WHERE id = $2 RETURNING *`, [passcode, guildId]);
      return mapGuild(row);
    } catch (e: any) {
      if (e?.code === '23505') continue;
      throw e;
    }
  }
  throw new Error('Could not generate a unique passcode');
}

export async function getGuild(id: string): Promise<GuildRow | null> {
  const row = await queryOne(`SELECT * FROM guilds WHERE id = $1`, [id]);
  return row ? mapGuild(row) : null;
}

export async function getGuildByTeacher(teacherId: string): Promise<GuildRow | null> {
  const row = await queryOne(`SELECT * FROM guilds WHERE teacher_id = $1`, [teacherId]);
  return row ? mapGuild(row) : null;
}

export async function getGuildByPasscode(passcode: string): Promise<GuildRow | null> {
  const row = await queryOne(`SELECT * FROM guilds WHERE upper(passcode) = upper($1)`, [passcode.trim()]);
  return row ? mapGuild(row) : null;
}

export async function updateGuildTermSettings(guildId: string, termSettings: Record<string, unknown>): Promise<GuildRow> {
  const row = await queryOne(`UPDATE guilds SET term_settings = $2::jsonb WHERE id = $1 RETURNING *`, [guildId, JSON.stringify(termSettings)]);
  return mapGuild(row);
}

export async function joinGuild(userId: string, guildId: string): Promise<UserRow> {
  const row = await queryOne(`UPDATE users SET guild_id = $1 WHERE id = $2 RETURNING *`, [guildId, userId]);
  return mapUser(row);
}

export async function leaveGuild(userId: string): Promise<UserRow> {
  const row = await queryOne(`UPDATE users SET guild_id = NULL WHERE id = $1 RETURNING *`, [userId]);
  return mapUser(row);
}

export async function listGuildMembers(guildId: string): Promise<UserRow[]> {
  const rows = await query(`SELECT * FROM users WHERE guild_id = $1 AND role = 'student' ORDER BY created_at`, [guildId]);
  return rows.map(mapUser);
}

/** Every guild with its member count — the admin panel's guild directory. */
export async function listGuildsWithCounts(): Promise<(GuildRow & { memberCount: number })[]> {
  const rows = await query(
    `SELECT g.*, COUNT(u.id)::int AS member_count
     FROM guilds g LEFT JOIN users u ON u.guild_id = g.id AND u.role = 'student'
     GROUP BY g.id ORDER BY g.created_at`,
  );
  return rows.map((r) => ({ ...mapGuild(r), memberCount: Number(r.member_count) }));
}

/**
 * Remove a member from their guild (teacher kicking a student, or an admin
 * managing any guild). Idempotent: clearing a non-member's guild_id is a no-op.
 */
export async function removeGuildMember(userId: string): Promise<UserRow> {
  const row = await queryOne(`UPDATE users SET guild_id = NULL WHERE id = $1 RETURNING *`, [userId]);
  return mapUser(row);
}

// --- scores ---------------------------------------------------------------------

export async function insertScore(s: {
  userId: string; chapterId: string | null; rawScore: number; mistakes: number;
  timeSeconds: number; finished: boolean; livesRemaining: number; term: string; coinsAwarded: number;
  coinsGathered?: number; coinsPenalty?: number; netCoins?: number;
  failReason?: 'out_of_lives' | 'out_of_time' | null;
}): Promise<ScoreRow> {
  // guild_id is filled in by the trg_set_score_guild trigger.
  const row = await queryOne(
    `INSERT INTO scores (user_id, chapter_id, raw_score, mistakes, time_seconds, finished, lives_remaining, term, coins_awarded, coins_gathered, coins_penalty, net_coins, fail_reason)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13) RETURNING *`,
    [s.userId, s.chapterId, s.rawScore, s.mistakes, s.timeSeconds,
     s.finished, s.livesRemaining, s.term, s.coinsAwarded,
     s.coinsGathered ?? 0, s.coinsPenalty ?? 0, s.netCoins ?? s.coinsAwarded, s.failReason ?? null]
  );
  return mapScore(row);
}

/** Executor-aware variant used by the transactional quest-completion flow. */
export async function insertScoreTx(ex: DbExecutor, s: {
  userId: string; chapterId: string | null; rawScore: number; mistakes: number;
  timeSeconds: number; finished: boolean; livesRemaining: number; term: string; coinsAwarded: number;
  coinsGathered?: number; coinsPenalty?: number; netCoins?: number;
  failReason?: 'out_of_lives' | 'out_of_time' | null;
}): Promise<ScoreRow> {
  const row = await ex.query<Record<string, unknown>>(
    `INSERT INTO scores (user_id, chapter_id, raw_score, mistakes, time_seconds, finished, lives_remaining, term, coins_awarded, coins_gathered, coins_penalty, net_coins, fail_reason)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13) RETURNING *`,
    [s.userId, s.chapterId, s.rawScore, s.mistakes, s.timeSeconds,
     s.finished, s.livesRemaining, s.term, s.coinsAwarded,
     s.coinsGathered ?? 0, s.coinsPenalty ?? 0, s.netCoins ?? s.coinsAwarded, s.failReason ?? null]
  );
  return mapScore(row.rows[0]);
}

export interface LeaderboardEntry {
  userId: string;
  name: string;
  termScore: number;
  questCount: number;
  rank: string;
  /** Equipped avatar so the hall shows each hero's look. */
  avatar?: Record<string, unknown>;
}

export async function getLeaderboard(guildId: string | null, term: string | null): Promise<LeaderboardEntry[]> {
  // Cumulative score per student, optionally scoped to one term.
  const rows = await query(
    `SELECT u.id AS user_id, u.name, u.preferences AS avatar,
            COALESCE(SUM(s.raw_score), 0)::int AS term_score,
            COUNT(s.id)::int AS quest_count
     FROM users u
     LEFT JOIN scores s ON s.user_id = u.id AND ($2::text IS NULL OR s.term::text = $2::text)
     WHERE u.role = 'student' AND (($1::uuid IS NOT NULL AND u.guild_id = $1::uuid) OR ($1::uuid IS NULL AND u.guild_id IS NULL))
     GROUP BY u.id, u.name, u.preferences
     ORDER BY term_score DESC, u.name ASC`,
    [guildId, term]
  );
  return rows.map((r: any) => ({
    userId: r.user_id, name: r.name, termScore: Number(r.term_score), questCount: Number(r.quest_count),
    rank: rankForScore(Number(r.term_score)),
    // preferences stores { avatar: {...} } — unwrap so callers get the look itself.
    avatar: ((r.avatar as Record<string, unknown>)?.avatar ?? r.avatar ?? {}) as Record<string, unknown>,
  }));
}

export async function getTermScore(userId: string, term: string | null): Promise<number> {
  const row = await queryOne<{ total: string }>(
    `SELECT COALESCE(SUM(raw_score), 0)::text AS total FROM scores
     WHERE user_id = $1 AND ($2::text IS NULL OR term::text = $2::text)`,
    [userId, term]
  );
  return row ? Number(row.total) : 0;
}

// --- rank tiers ------------------------------------------------------------------

export const DEFAULT_RANK_TIERS: { name: string; minScore: number; color: string }[] = [
  { name: 'copper', minScore: 0, color: '#c86a3c' },
  { name: 'iron', minScore: 500, color: '#9aa0a8' },
  { name: 'gold', minScore: 1000, color: '#ffec27' },
  { name: 'diamond', minScore: 2000, color: '#8fd7ff' },
  { name: 'mythril', minScore: 3500, color: '#b7c9ff' },
];

export function rankForScore(score: number): string {
  let rank = 'copper';
  for (const t of DEFAULT_RANK_TIERS) {
    if (score >= t.minScore) rank = t.name;
  }
  return rank;
}

// Re-export the admin/shop/cosmetics/map data layer so route modules can pull
// everything from './db.js' (admin.ts itself imports query/queryOne from here —
// it must be imported last to avoid a circular-init hazard at module load).
export * from './admin.js';
