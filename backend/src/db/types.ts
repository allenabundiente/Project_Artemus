// Shared row-level types for the Postgres data layer.

export interface CodeBlock {
  code: string;
  context: string;
}

export interface ChapterRow {
  id: string;
  bookId: string;
  idx: number;
  title: string;
  text: string;
  codeBlocks: CodeBlock[];
}

export interface ChallengeRow {
  id: string;
  bookId: string;
  chapterId: string;
  type: string;
  prompt: string;
  code: string | null;
  options: string[] | null;
  correctAnswer: string;
  explanation: string;
  difficulty: string;
  ord: number;
}

export interface ProgressRow {
  completedChapters: string[];
  score: number;
  bestStreak: number;
}
