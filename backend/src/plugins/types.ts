// ============================================================================
// QuestBook plugin system — quiz generators as plugins
// ============================================================================
// A QuizGeneratorPlugin decides WHEN it applies to a book (detect) and HOW to
// steer generation (prompt directives + heuristic generation). The programming
// mode from milestone 4 is now just a plugin; new subjects/styles (language
// learning, law, medicine) drop in without touching the core generator.
//
// See docs/PLUGIN_API.md for a walkthrough.

import type { ChapterRow } from '../db/types.js';

/** Re-exported for plugin authors' convenience. */
export type { ChapterRow } from '../db/types.js';
export interface GeneratedChallenge {
  type: 'multiple_choice' | 'predict_output' | 'spot_the_bug' | 'fill_in_blank' | 'true_false' | 'short_answer';
  prompt: string;
  code: string | null;
  options: string[] | null;
  correctAnswer: string;
  explanation: string;
  difficulty: 'easy' | 'medium' | 'hard';
}

/** How a book's quiz mode was chosen (for the UI + logs). */
export type QuizMode = 'general' | 'programming' | 'language';

/** Everything a generator may need to know about the run. */
export interface GenerationContext {
  chapter: ChapterRow;
  /** Teacher-chosen challenge count for the BOOK (null = auto). */
  targetCount: number | null;
  /** Per-chapter target derived from targetCount (already clamped). */
  perChapterTarget: number;
  /** Guild term settings steering (difficulty names/mix). */
  difficulty?: { monsterDifficulty?: 'easy' | 'medium' | 'hard'; difficultyMix?: { easy: number; medium: number; hard: number } };
  term?: string;
}

/** A question-generator plugin. Implement detect + at least one generator. */
export interface QuizGeneratorPlugin {
  /** Stable id — stored on books.quiz_mode and used in logs. */
  readonly id: string;
  /** Human name for admin UIs and logs. */
  readonly name: string;
  /** Semver-ish string; bump when prompt/behavior changes materially. */
  readonly version: string;
  /** One-liner shown in admin UIs. */
  readonly description?: string;

  /**
   * Does this plugin apply to the given upload? Checked in registry order;
   * the FIRST match wins (register more specific plugins earlier).
   */
  detect(input: { filename: string; title: string; env: NodeJS.ProcessEnv }): boolean;

  /**
   * Extra system-prompt text appended when the LLM generates for a book this
   * plugin matched. Return '' to add nothing.
   */
  promptDirective?(ctx: GenerationContext): string;

  /**
   * Offline/deterministic generation (no LLM). Used directly in heuristic
   * mode and as the per-chapter fallback when the LLM fails.
   */
  generateHeuristically?(ctx: GenerationContext): { concept: string; challenges: GeneratedChallenge[] };

  /**
   * Optional veto/validation of LLM output for this plugin (e.g. programming
   * challenges must carry a code block). Return the repaired challenge or
   * null to reject it.
   */
  validateChallenge?(c: GeneratedChallenge, ctx: GenerationContext): GeneratedChallenge | null;
}
