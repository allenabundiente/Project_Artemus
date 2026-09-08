// Postgres data layer (Supabase-compatible) replacing the old SQLite store.
// Node-postgres with a connection pool. All schema lives in backend/migrations/*.sql
// which are applied to Supabase via the SQL editor / CLI.
import pg from 'pg';
import type { CodeBlock, ChallengeRow, ChapterRow, ProgressRow } from './types.js';

export { type CodeBlock, type ChallengeRow, type ChapterRow, type ProgressRow } from './types.js';

const connectionString = process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/codebook_arcade';

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

export async function queryOne<T extends pg.QueryResultRow>(sql: string, params: unknown[] = []): Promise<T | null> {
  const rows = await query<T>(sql, params);
  return rows[0] ?? null;
}

// --- row mappers (snake_case DB → camelCase TS) -----------------------------

export interface BookRow {
  id: string;
  title: string;
  filename: string;
  ownerId: string | null;
  guildId: string | null;
  createdAt: Date;
}

function mapBook(r: any): BookRow {
  return { id: r.id, title: r.title, filename: r.filename, ownerId: r.owner_id ?? null, guildId: r.guild_id ?? null, createdAt: r.created_at };
}

export interface UserRow {
  id: string;
  name: string;
  email: string;
  passwordHash: string;
  role: 'teacher' | 'student';
  guildId: string | null;
  coins: number;
  createdAt: Date;
}

function mapUser(r: any): UserRow {
  return { id: r.id, name: r.name, email: r.email, passwordHash: r.password_hash, role: r.role, guildId: r.guild_id ?? null, coins: r.coins, createdAt: r.created_at };
}

export interface GuildRow {
  id: string;
  name: string;
  passcode: string;
  teacherId: string;
  termSettings: Record<string, unknown>;
  createdAt: Date;
}

function mapGuild(r: any): GuildRow {
  return { id: r.id, name: r.name, passcode: r.passcode, teacherId: r.teacher_id, termSettings: r.term_settings ?? {}, createdAt: r.created_at };
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
  createdAt: Date;
}

function mapScore(r: any): ScoreRow {
  return {
    id: r.id, userId: r.user_id, chapterId: r.chapter_id ?? null, guildId: r.guild_id ?? null,
    rawScore: r.raw_score, mistakes: r.mistakes, timeSeconds: r.time_seconds,
    finished: r.finished, livesRemaining: r.lives_remaining, term: r.term,
    coinsAwarded: r.coins_awarded, createdAt: r.created_at,
  };
}

// --- books / chapters / challenges -------------------------------------------

export async function insertBook(title: string, filename: string, ownerId: string | null, guildId: string | null): Promise<string> {
  const row = await queryOne<{ id: string }>(
    `INSERT INTO books (title, filename, owner_id, guild_id) VALUES ($1, $2, $3, $4) RETURNING id`,
    [title, filename, ownerId, guildId]
  );
  return row!.id;
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

// --- guilds ---------------------------------------------------------------------

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

// --- scores ---------------------------------------------------------------------

export async function insertScore(s: {
  userId: string; chapterId: string | null; rawScore: number; mistakes: number;
  timeSeconds: number; finished: boolean; livesRemaining: number; term: string; coinsAwarded: number;
}): Promise<ScoreRow> {
  // guild_id is filled in by the trg_set_score_guild trigger.
  const row = await queryOne(
    `INSERT INTO scores (user_id, chapter_id, raw_score, mistakes, time_seconds, finished, lives_remaining, term, coins_awarded)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
    [s.userId, s.chapterId, s.rawScore, s.mistakes, s.timeSeconds, s.finished, s.livesRemaining, s.term, s.coinsAwarded]
  );
  return mapScore(row);
}

export interface LeaderboardEntry {
  userId: string;
  name: string;
  termScore: number;
  questCount: number;
  rank: string;
}

export async function getLeaderboard(guildId: string | null, term: string | null): Promise<LeaderboardEntry[]> {
  // Cumulative score per student, optionally scoped to one term.
  const rows = await query(
    `SELECT u.id AS user_id, u.name,
            COALESCE(SUM(s.raw_score), 0)::int AS term_score,
            COUNT(s.id)::int AS quest_count
     FROM users u
     LEFT JOIN scores s ON s.user_id = u.id AND ($2::text IS NULL OR s.term::text = $2::text)
     WHERE u.role = 'student' AND (($1::uuid IS NOT NULL AND u.guild_id = $1::uuid) OR ($1::uuid IS NULL AND u.guild_id IS NULL))
     GROUP BY u.id, u.name
     ORDER BY term_score DESC, u.name ASC`,
    [guildId, term]
  );
  return rows.map((r: any) => ({ userId: r.user_id, name: r.name, termScore: Number(r.term_score), questCount: Number(r.quest_count), rank: rankForScore(Number(r.term_score)) }));
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
