// Shared row-level types for the Postgres data layer.

export interface CodeBlock {
  code: string;
  context: string;
}

/**
 * Pass-1 "compiled lesson" summary (stored on chapters.compiled): what the
 * lesson actually teaches, ranked by teaching value — every generated
 * challenge must trace back to something flagged here, not to nearby text.
 */
export interface CompiledLesson {
  topicType: 'foundational_concept' | 'applied_pattern';
  keyConcepts: string[];
  importantCodePatterns: { description: string; code: string; isCoreToLesson: boolean }[];
  minorDetails: string[];
}

export interface ChapterRow {
  id: string;
  bookId: string;
  idx: number;
  title: string;
  text: string;
  codeBlocks: CodeBlock[];
  /** Pass-1 compiled summary when the chapter was generated with an LLM. */
  compiled: CompiledLesson | null;
}

/**
 * One test of a code_exercise: `stdin` is fed to the program and its stdout
 * must match `expectedStdout`. Hidden tests never reach the browser's payload.
 */
export interface CodeTest {
  name: string;
  stdin: string;
  expectedStdout: string;
  hidden: boolean;
}

/** One removable blank of a code_completion_quest program. */
export interface QuestBlank {
  id: string;
  /** Student-visible code with THIS blank replaced by the ____ marker. */
  codeWithBlanksUpToHere: string;
  correctAnswer: string;
  explanation: string;
  difficulty: 'easy' | 'medium' | 'hard';
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
  /** code_completion_quest only: the quest title + full program + blanks. */
  quest: { title: string; fullSourceCode: string; blanks: QuestBlank[] } | null;
  /** code_exercise only: Judge0 language key (null on every other type). */
  language?: string | null;
  /** code_exercise only: preloaded editor contents with a TODO. */
  starterCode?: string | null;
  /** code_exercise only: the exercise's tests (hidden ones included). */
  tests?: CodeTest[] | null;
  /** code_exercise only: the reference program — never sent to students. */
  referenceSolution?: string | null;
}

export interface ProgressRow {
  completedChapters: string[];
  score: number;
  bestStreak: number;
}
