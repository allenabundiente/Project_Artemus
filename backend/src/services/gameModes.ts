// Per-book game modes — the single place that decides how a mode changes play.
//
// The mode is stored on `books.game_mode` (migration 0017). 'classic' is
// EXACTLY today's gameplay: three lives, the term's countdown, the boss gate
// re-asking questions already faced, and no scoring change. Every other mode
// layers one extra rule on top, and the rules live here rather than in
// scattered conditionals.
//
// Scoring contract: only 'speedrun' can change a score (its time bonus). Every
// other mode — classic included — leaves `computeScore`'s result untouched.

export type GameMode = 'classic' | 'survival' | 'speedrun' | 'boss';

export const GAME_MODES: readonly GameMode[] = ['classic', 'survival', 'speedrun', 'boss'];

/** Falls back to the historic default for anything unrecognised. */
export const DEFAULT_GAME_MODE: GameMode = 'classic';

export function isGameMode(value: unknown): value is GameMode {
  return typeof value === 'string' && (GAME_MODES as readonly string[]).includes(value);
}

/** Coerce stored/requested values to a valid mode ('classic' when invalid). */
export function resolveGameMode(value: unknown): GameMode {
  return isGameMode(value) ? value : DEFAULT_GAME_MODE;
}

export interface GameModeRules {
  /** Player hearts for the run. */
  lives: number;
  /** Run countdown in seconds; null = no clock at all. */
  timeLimitSeconds: number | null;
  /** Points per second left on the clock when the quest is finished (0 = none). */
  timeBonusPerSecond: number;
  /** Build the boss fight from the chapter's hardest questions. */
  bossFromHardest: boolean;
}

/** Shortest speedrun clock we will ever hand out, however tight the term is. */
export const SPEEDRUN_MIN_SECONDS = 60;

/**
 * Speedrun's clock: half the term's own limit, never longer than the term's
 * limit and never shorter than SPEEDRUN_MIN_SECONDS.
 */
export function speedrunTimeLimit(termTimeLimitSeconds: number): number {
  const limit = Number(termTimeLimitSeconds);
  if (!Number.isFinite(limit) || limit <= 0) return 300;
  return Math.max(SPEEDRUN_MIN_SECONDS, Math.min(Math.round(limit), Math.round(limit / 2)));
}

/**
 * The rules a mode runs under, given the guild's term countdown.
 *
 * survival: three lives and no clock — the threat is your hearts, not time.
 *           A wrong answer costs a life and the run ends at zero (the same
 *           life system the engine already runs, made explicit here).
 * speedrun: a tighter per-level clock plus a time bonus on the score.
 * boss:     the gate becomes a real boss built from the chapter's hardest
 *           questions instead of a repeat of questions already faced.
 */
export function gameModeRules(mode: GameMode, termTimeLimitSeconds: number): GameModeRules {
  switch (mode) {
    case 'survival':
      return { lives: 3, timeLimitSeconds: null, timeBonusPerSecond: 0, bossFromHardest: false };
    case 'speedrun':
      return { lives: 3, timeLimitSeconds: speedrunTimeLimit(termTimeLimitSeconds), timeBonusPerSecond: 0.5, bossFromHardest: false };
    case 'boss':
      return { lives: 3, timeLimitSeconds: termTimeLimitSeconds, timeBonusPerSecond: 0, bossFromHardest: true };
    case 'classic':
    default:
      return { lives: 3, timeLimitSeconds: termTimeLimitSeconds, timeBonusPerSecond: 0, bossFromHardest: false };
  }
}

/**
 * Points added to a finished quest for beating the mode's clock. Zero for every
 * mode except speedrun, so classic (and every existing) score is unchanged.
 */
export function gameModeTimeBonus(
  mode: GameMode,
  timeSeconds: number,
  termTimeLimitSeconds: number,
  finished = true,
): number {
  const rules = gameModeRules(mode, termTimeLimitSeconds);
  if (!finished || rules.timeBonusPerSecond <= 0 || rules.timeLimitSeconds == null) return 0;
  const remaining = Math.max(0, rules.timeLimitSeconds - Math.max(0, Math.floor(timeSeconds)));
  return Math.max(0, Math.round(remaining * rules.timeBonusPerSecond));
}

/** Human label, used by the settings response and the docs. */
export function gameModeLabel(mode: GameMode): string {
  switch (mode) {
    case 'survival': return 'Survival';
    case 'speedrun': return 'Speedrun';
    case 'boss': return 'Boss Rush';
    case 'classic':
    default: return 'Classic';
  }
}

/** One-line rule summary (teacher picker copy). */
export const GAME_MODE_SUMMARIES: Record<GameMode, string> = {
  classic: 'Today’s quest: 3 lives, the term’s countdown, the usual boss gate.',
  survival: '3 lives and no clock — every wrong answer costs a heart, and the run ends at zero.',
  speedrun: 'A tight per-level countdown; finishing with time to spare pays a score bonus.',
  boss: 'Each chapter ends with a boss built from its hardest questions.',
};
