// Per-term guild settings: merge a guild's overrides over the global defaults.
// Shape of the stored JSON (guilds.term_settings), keyed by term:
// {
//   "prelims": { "timeLimitSeconds"?, "pointsMultiplier"?, "difficultyMix"?:
//                { "easy"?, "medium"?, "hard"? }, "monsterDifficulty"?,
//                "scoreWeights"? : Partial<ScoreWeights> },
//   ...
// }

import { DEFAULT_SCORE_WEIGHTS, type ScoreWeights } from './scoring.js';

export const TERMS = ['prelims', 'midterms', 'semis', 'finals'] as const;
export type Term = (typeof TERMS)[number];

export function isTerm(t: string): t is Term {
  return (TERMS as readonly string[]).includes(t);
}

export function isDifficultyMix(v: unknown): v is { easy: number; medium: number; hard: number } {
  if (typeof v !== 'object' || v === null) return false;
  const m = v as Record<string, unknown>;
  const e = Number(m.easy), md = Number(m.medium), h = Number(m.hard);
  return Number.isFinite(e) && Number.isFinite(md) && Number.isFinite(h) && e >= 0 && md >= 0 && h >= 0 && e + md + h > 0;
}

export interface TermSettings {
  timeLimitSeconds: number;
  pointsMultiplier: number;
  difficultyMix: { easy: number; medium: number; hard: number };
  monsterDifficulty: 'easy' | 'medium' | 'hard';
  scoreWeights: ScoreWeights;
}

export const DEFAULT_TERM_SETTINGS: Record<Term, TermSettings> = {
  prelims: {
    timeLimitSeconds: 900,
    pointsMultiplier: 1.0,
    difficultyMix: { easy: 70, medium: 30, hard: 0 },
    monsterDifficulty: 'easy',
    scoreWeights: DEFAULT_SCORE_WEIGHTS,
  },
  midterms: {
    timeLimitSeconds: 720,
    pointsMultiplier: 1.25,
    difficultyMix: { easy: 50, medium: 40, hard: 10 },
    monsterDifficulty: 'medium',
    scoreWeights: DEFAULT_SCORE_WEIGHTS,
  },
  semis: {
    timeLimitSeconds: 600,
    pointsMultiplier: 1.5,
    difficultyMix: { easy: 30, medium: 50, hard: 20 },
    monsterDifficulty: 'medium',
    scoreWeights: DEFAULT_SCORE_WEIGHTS,
  },
  finals: {
    timeLimitSeconds: 480,
    pointsMultiplier: 2.0,
    difficultyMix: { easy: 20, medium: 50, hard: 30 },
    monsterDifficulty: 'hard',
    scoreWeights: DEFAULT_SCORE_WEIGHTS,
  },
};

/** Merge a guild's stored overrides over the global defaults for a term. */
export function resolveTermSettings(
  term: string,
  guildSettings: Record<string, unknown> | null | undefined
): TermSettings {
  const t = (isTerm(term) ? term : 'prelims') as Term;
  const base = DEFAULT_TERM_SETTINGS[t];
  const overrides = guildSettings?.[t] as Partial<TermSettings> | undefined;
  if (!overrides || typeof overrides !== 'object') return { ...base, scoreWeights: { ...base.scoreWeights } };
  return {
    timeLimitSeconds: Number(overrides.timeLimitSeconds) > 0 ? Number(overrides.timeLimitSeconds) : base.timeLimitSeconds,
    pointsMultiplier: Number(overrides.pointsMultiplier) > 0 ? Number(overrides.pointsMultiplier) : base.pointsMultiplier,
    difficultyMix: isDifficultyMix(overrides.difficultyMix) ? { ...overrides.difficultyMix } : { ...base.difficultyMix },
    monsterDifficulty: ['easy', 'medium', 'hard'].includes(String(overrides.monsterDifficulty))
      ? (overrides.monsterDifficulty as TermSettings['monsterDifficulty'])
      : base.monsterDifficulty,
    scoreWeights: { ...base.scoreWeights, ...(typeof overrides.scoreWeights === 'object' && overrides.scoreWeights ? overrides.scoreWeights : {}) },
  };
}

/** Validate a full term-settings blob coming from the teacher panel. */
export function sanitizeTermSettings(input: unknown): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (typeof input !== 'object' || input === null) return out;
  for (const term of TERMS) {
    const raw = (input as Record<string, unknown>)[term];
    if (typeof raw !== 'object' || raw === null) continue;
    const r = raw as Record<string, unknown>;
    const merged = { ...resolveTermSettings(term, input as Record<string, unknown>) };
    // Validate each field independently; invalid values fall back to defaults.
    if (Number(r.timeLimitSeconds) > 0) merged.timeLimitSeconds = Math.min(7200, Math.max(60, Math.round(Number(r.timeLimitSeconds))));
    if (Number(r.pointsMultiplier) > 0) merged.pointsMultiplier = Math.min(10, Number(r.pointsMultiplier));
    if (isDifficultyMix(r.difficultyMix)) merged.difficultyMix = { ...r.difficultyMix };
    if (['easy', 'medium', 'hard'].includes(String(r.monsterDifficulty))) merged.monsterDifficulty = r.monsterDifficulty as TermSettings['monsterDifficulty'];
    if (typeof r.scoreWeights === 'object' && r.scoreWeights !== null) {
      const w: Record<string, number> = {};
      for (const [k, v] of Object.entries(r.scoreWeights as Record<string, unknown>)) {
        if (k in DEFAULT_SCORE_WEIGHTS && Number.isFinite(Number(v))) w[k] = Math.max(0, Number(v));
      }
      if (Object.keys(w).length > 0) merged.scoreWeights = { ...merged.scoreWeights, ...w };
    }
    out[term] = merged;
  }
  return out;
}
