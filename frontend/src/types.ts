export type ChallengeType = 'multiple_choice' | 'predict_output' | 'spot_the_bug' | 'fill_in_blank' | 'true_false' | 'short_answer';

export interface Challenge {
  id: string;
  bookId: string;
  chapterId: string;
  type: ChallengeType;
  prompt: string;
  code: string | null;
  options: string[] | null;
  correctAnswer: string;
  explanation: string;
  difficulty: 'easy' | 'medium' | 'hard';
}

export interface BookMeta {
  id: string;
  title: string;
  filename: string;
  ownerId: string | null;
  guildId: string | null;
  /** Teacher-chosen challenge count for this PDF (null = auto). */
  questCount: number | null;
  /** How many chapters become playable quests (null = auto, max 12). */
  questChapters: number | null;
  /** Teacher lock: hidden from players until unlocked. */
  locked: boolean;
  /** Availability window (ISO strings; null = unbounded on that side). */
  availableFrom: string | null;
  availableUntil: string | null;
  /** 'general' (any subject) or 'programming' (code-flavored questions). */
  quizMode: QuizMode;
  createdAt: string;
  /** Teacher-set quest cap; null/undefined = unlimited. */
  questLimit?: number | null;
  /** Total challenges across the tome (0 = "no monsters" — needs regeneration). */
  challengeCount?: number;
}

export interface ChapterMeta {
  id: string;
  idx: number;
  title: string;
  challengeCount: number;
}

export interface BookDetail extends BookMeta {
  chapters: ChapterMeta[];
}

/** One chapter's challenges in the teacher review feed. */
export interface ChapterChallengeReview {
  chapterId: string;
  idx: number;
  title: string;
  challenges: Challenge[];
}

export interface BookChallengeReview {
  bookId: string;
  chapters: ChapterChallengeReview[];
}

export interface Progress {
  completedChapters: string[];
  score: number;
  bestStreak: number;
}

export type QuizMode = 'general' | 'programming' | 'language';

export interface UploadResult {
  bookId: string;
  title: string;
  quizMode: QuizMode;
  chapters: { idx: number; title: string }[];
}

export interface GenerateResult {
  bookId: string;
  cached: boolean;
  challengeCount: number;
  llmFailures: number;
  mode: 'llm' | 'heuristic';
}

export interface LlmStatus {
  provider: 'anthropic' | 'openai_compat' | 'none';
  mode: string;
  model: string | null;
  baseUrl: string | null;
}

export interface RegenerateAllResult {
  term: string;
  mode: 'llm' | 'heuristic';
  results: { bookId: string; title: string; challengeCount: number; llmFailures: number }[];
}

// --- auth & roles -------------------------------------------------------------

export type Role = 'teacher' | 'student' | 'admin';

// --- avatar / wardrobe ------------------------------------------------------------

export type AvatarPart = 'hair' | 'armor' | 'helmet' | 'cape';

export interface AvatarPrefs {
  sex: 'male' | 'female';
  hair: string;
  armor: string;
  helmet: string;
  cape: string;
  color: string;
}

export interface AvatarSetDef {
  id: string;
  name: string;
  sku: string;
  price: number;
  description: string;
}

export interface ShopItem {
  id: string;
  sku: string;
  name: string;
  description: string;
  category: 'hair' | 'armor' | 'helmet' | 'cape' | 'pack';
  kind: string;
  price: number;
  sort: number;
}

export interface WardrobeResponse {
  sets: Record<AvatarPart, AvatarSetDef[]>;
  unlocked: Record<AvatarPart, string[]>;
  colors: { hex: string; name: string }[];
  avatar: AvatarPrefs;
}

export interface FeatureRow {
  key: string;
  label: string;
  locked: boolean;
}

/** One row of the royal audit trail (who did what, when). */
export interface AuditEntry {
  id: number;
  actorId: string | null;
  actorName: string;
  action: string;
  target: string;
  detail: Record<string, unknown>;
  createdAt: string;
}

/** An admin account, for the panel's admin-management tab. */
export interface AdminAccount {
  id: string;
  name: string;
  email: string;
  createdAt: string;
}

export interface MapConfig {
  mode: 'fixed' | 'random_by_difficulty';
  fixedTheme: string;
}

export interface ThemeMeta {
  id: string;
  name: string;
  builtin?: boolean;
  /** Full palette for custom themes — present when not builtin. */
  sky?: string;
  stars?: string;
  farHills?: string;
  nearHills?: string;
  pit?: string;
  floorTop?: string;
  floorBody?: string;
  floorSpeckle?: string;
  /** Patrol roster, if the theme defines one. */
  monsters?: string[];
  /** End-of-level boss slot, if the theme defines one. */
  boss?: string;
  /** Per-slot art replacements (slot → sprite file), if the theme defines them. */
  spriteOverrides?: Record<string, string>;
}

export interface MapResolve {
  theme: string;
  source: 'guild' | 'admin' | 'random';
}

export interface LessonOverview {
  title: string;
  objectives: string[];
  intro: string;
  sections: { heading: string; summary: string }[];
  keyTerms: { term: string; definition: string }[];
  example?: { language: string; code: string; caption: string };
  tip?: string;
  source: 'heuristic' | 'llm';
}

export interface AuthUser {
  id: string;
  name: string;
  email: string;
  role: Role;
  guildId: string | null;
  coins: number;
  avatar?: AvatarPrefs;
}

export interface AuthResponse {
  token: string;
  user: AuthUser;
}

// --- guilds ---------------------------------------------------------------------

export interface GuildInfo {
  id: string;
  name: string;
  passcode?: string;
  termSettings?: Record<string, unknown>;
}

/** Admin directory row: every guild with its leader, code, and size. */
export interface GuildAdminInfo {
  id: string;
  name: string;
  passcode: string;
  teacherId: string;
  teacherName: string;
  memberCount: number;
}

export interface RosterEntry {
  id: string;
  name: string;
  rank: string;
  score: number;
  lastActive: string;
  /** Equipped avatar (sanitized server-side). */
  avatar?: AvatarPrefs;
}

// --- ranks & leaderboard ----------------------------------------------------------

export type RankName = 'copper' | 'iron' | 'gold' | 'diamond' | 'mythril';

export interface LeaderboardEntry {
  userId: string;
  name: string;
  termScore: number;
  questCount: number;
  rank: string;
  /** Equipped avatar (sanitized server-side). */
  avatar?: AvatarPrefs;
}

export interface LeaderboardResponse {
  scope: 'guild' | 'global';
  term: string | null;
  entries: LeaderboardEntry[];
}

// --- terms & settings ---------------------------------------------------------------

export type Term = 'prelims' | 'midterms' | 'semis' | 'finals';

export interface ScoreWeights {
  basePoints: number;
  mistakePenalty: number;
  timePenalty: number;
  timeParSeconds: number;
  incompletePenalty: number;
  outOfLifePenalty: number;
  lifeBonus: number;
  coinBase: number;
  coinFlawlessBonus: number;
  coinFullLifeBonus: number;
}

export interface TermSettings {
  timeLimitSeconds: number;
  pointsMultiplier: number;
  difficultyMix: { easy: number; medium: number; hard: number };
  monsterDifficulty: 'easy' | 'medium' | 'hard';
  scoreWeights: ScoreWeights;
}

export interface ScoreResultResponse {
  scoreId: string;
  rawScore: number;
  /** What the run banked: the full award on success, net-of-penalty on fail. */
  coinsAwarded: number;
  /** Fail runs only: random penalty taken from this run's gathered coins. */
  coinsPenalty?: number;
  /** Server-confirmed total balance AFTER this quest settled. */
  coins: number;
  breakdown: { label: string; value: number }[];
  rank: RankName | string;
  term: string;
  /** Daily quest streak after this completion (0 on fails). */
  streak?: number;
  /** Coins granted for hitting a 7-day streak milestone (0 otherwise). */
  streakBonus?: number;
}
