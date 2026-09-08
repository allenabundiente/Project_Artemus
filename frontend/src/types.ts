export type ChallengeType = 'multiple_choice' | 'predict_output' | 'spot_the_bug' | 'fill_in_blank';

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
  createdAt: string;
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

export interface Progress {
  completedChapters: string[];
  score: number;
  bestStreak: number;
}

export interface UploadResult {
  bookId: string;
  title: string;
  chapters: { idx: number; title: string }[];
}

export interface GenerateResult {
  bookId: string;
  cached: boolean;
  challengeCount: number;
  llmFailures: number;
  mode: 'llm' | 'heuristic';
}

// --- auth & roles -------------------------------------------------------------

export type Role = 'teacher' | 'student';

export interface AuthUser {
  id: string;
  name: string;
  email: string;
  role: Role;
  guildId: string | null;
  coins: number;
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

export interface RosterEntry {
  id: string;
  name: string;
  rank: string;
  score: number;
  lastActive: string;
}

// --- ranks & leaderboard ----------------------------------------------------------

export type RankName = 'copper' | 'iron' | 'gold' | 'diamond' | 'mythril';

export interface LeaderboardEntry {
  userId: string;
  name: string;
  termScore: number;
  questCount: number;
  rank: string;
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
  coinsAwarded: number;
  coins: number;
  breakdown: { label: string; value: number }[];
  rank: RankName | string;
  term: string;
}
