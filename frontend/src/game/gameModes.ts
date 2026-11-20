// Client-side game-mode rules — the mirror of backend/src/services/gameModes.ts.
//
// 'classic' is exactly today's gameplay; the other modes add ONE rule each, so
// the screens stay free of scattered conditionals. The server owns the
// allowlist and the scoring; this module owns what the player experiences
// (clock, lives, the boss's question pool).
import type { Challenge, GameMode } from '../types';

export const GAME_MODE_OPTIONS: { id: GameMode; label: string; blurb: string }[] = [
  { id: 'classic', label: 'Classic', blurb: 'Today’s quest: 3 lives, the term’s countdown, the usual boss gate.' },
  { id: 'survival', label: 'Survival', blurb: '3 lives and no clock — every wrong answer costs a heart, and the run ends at zero.' },
  { id: 'speedrun', label: 'Speedrun', blurb: 'A tight per-level countdown; finishing with time to spare pays a score bonus.' },
  { id: 'boss', label: 'Boss Rush', blurb: 'Each chapter ends with a boss built from its hardest questions.' },
];

/** Anything unknown falls back to the historic default. */
export function resolveGameMode(value: unknown): GameMode {
  return GAME_MODE_OPTIONS.some((o) => o.id === value) ? (value as GameMode) : 'classic';
}

export function gameModeLabel(mode: GameMode): string {
  return GAME_MODE_OPTIONS.find((o) => o.id === mode)?.label ?? 'Classic';
}

export interface GameModeRules {
  /** Player hearts for the run (the engine's own 3). */
  lives: number;
  /** Run countdown in seconds; null = no clock. */
  timeLimitSeconds: number | null;
  /** The gate is a boss built from the chapter's hardest questions. */
  bossFromHardest: boolean;
}

/** Shortest speedrun clock, however tight the guild's term is. */
export const SPEEDRUN_MIN_SECONDS = 60;

/** Speedrun's clock: half the term's limit, floored and capped. */
export function speedrunTimeLimit(termTimeLimitSeconds: number): number {
  const limit = Number(termTimeLimitSeconds);
  if (!Number.isFinite(limit) || limit <= 0) return 300;
  return Math.max(SPEEDRUN_MIN_SECONDS, Math.min(Math.round(limit), Math.round(limit / 2)));
}

export function gameModeRules(mode: GameMode, termTimeLimitSeconds: number): GameModeRules {
  switch (mode) {
    case 'survival':
      // The threat is your hearts, not the clock.
      return { lives: 3, timeLimitSeconds: null, bossFromHardest: false };
    case 'speedrun':
      return { lives: 3, timeLimitSeconds: speedrunTimeLimit(termTimeLimitSeconds), bossFromHardest: false };
    case 'boss':
      return { lives: 3, timeLimitSeconds: termTimeLimitSeconds, bossFromHardest: true };
    case 'classic':
    default:
      return { lives: 3, timeLimitSeconds: termTimeLimitSeconds, bossFromHardest: false };
  }
}

const DIFF_RANK: Record<Challenge['difficulty'], number> = { easy: 0, medium: 1, hard: 2 };

/**
 * Boss Rush's queue: the chapter's HARDEST questions, hardest last. Unlike the
 * classic gate (which re-asks what the run already faced), the boss here is a
 * real exam of the chapter's toughest material.
 */
export function pickBossQueue(challenges: Challenge[], limit = 5): Challenge[] {
  const ranked = [...challenges].sort(
    (a, b) => (DIFF_RANK[b.difficulty] ?? 0) - (DIFF_RANK[a.difficulty] ?? 0),
  );
  return ranked.slice(0, Math.max(1, Math.min(limit, ranked.length))).reverse();
}
