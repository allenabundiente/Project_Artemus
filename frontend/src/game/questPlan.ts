// Quest-run challenge distribution.
//
// A quest run deals the chapter's FULL generated challenge set across its
// monsters, one DISTINCT challenge per monster heart:
//
//   - Regular monsters never see the same challenge twice within a run
//     (no-repeat rule), and multi-heart monsters draw a different challenge
//     per heart from the same pool.
//   - The monster COUNT is derived from the pool: floor(pool / hearts) — so
//     on medium/hard there are fewer but tougher monsters, and every
//     generated challenge is dealt exactly once across the run (no repeats
//     anywhere, not just within one monster). On easy the classic one
//     challenge per monster is preserved.
//   - The pool is shuffled per run (seeded at quest start so retries reshuffle).
//   - The BOSS does the opposite on purpose: it re-presents the challenges
//     the student already faced during this run (hardest last), instead of
//     pulling fresh ones.
//
// Hearts per monster follow the quest difficulty:
//   easy → 1 heart, medium → 2 hearts, hard → 3 hearts.

import type { Challenge } from '../types';
import { mulberry32 } from './engine';

export type QuestDifficulty = 'easy' | 'medium' | 'hard';

/** Hearts (correct answers needed) per difficulty — the one mapping to keep in sync with UI copy. */
export function heartsForDifficulty(difficulty: QuestDifficulty): number {
  switch (difficulty) {
    case 'easy': return 1;
    case 'medium': return 2;
    case 'hard': return 3;
  }
}

export interface QuestPlan {
  /** One challenge queue per regular monster, one entry per heart (distinct within the monster). */
  monsterQueues: Challenge[][];
  /** The boss's queue: the run's already-seen challenges, mixed up, hardest last. */
  bossQueue: Challenge[];
  /** Total hearts demanded by the regular monsters (diagnostics / balance checks). */
  totalHearts: number;
}

function shuffleSeeded<T>(arr: T[], rnd: () => number): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

const DIFF_RANK: Record<Challenge['difficulty'], number> = { easy: 0, medium: 1, hard: 2 };

/**
 * Deal distinct, non-repeating challenges to each monster.
 *
 * Monster count derives from the pool and the difficulty's hearts-per-monster
 * (floor(pool / hearts), min 1), so the deal never needs to recycle: every
 * challenge in the pool lands in exactly one monster's queue. This is the
 * single source of truth for run-wide "used challenge" tracking.
 */
export function dealQuestPlan(
  challenges: Challenge[],
  difficulty: QuestDifficulty,
  seed: number,
): QuestPlan {
  const hearts = heartsForDifficulty(difficulty);
  const monsterCount = Math.max(1, Math.floor(challenges.length / hearts));
  const totalHearts = monsterCount * hearts;
  const rnd = mulberry32(seed);

  // One shuffle per run, then slice: monster m takes the next `hearts` cards
  // off the shuffled deck. Because monsterCount = floor(pool / hearts), the
  // deck exactly covers the run — no card can be dealt twice (the no-repeat
  // rule holds run-wide, not just per monster).
  const pool = shuffleSeeded(challenges, rnd);
  const monsterQueues: Challenge[][] = [];
  for (let m = 0; m < monsterCount; m++) {
    monsterQueues.push(pool.slice(m * hearts, (m + 1) * hearts));
  }

  // Boss: intentionally REPEAT what the student already faced this run —
  // drawn from the dealt regular queues, mixed up relative to their first
  // appearance, then ordered hardest-last so the fight builds to a peak.
  const seen: Challenge[] = monsterQueues.flat();
  const mixed = shuffleSeeded(seen, rnd).sort(
    (a, b) => DIFF_RANK[a.difficulty] - DIFF_RANK[b.difficulty],
  );

  return { monsterQueues, bossQueue: mixed, totalHearts };
}
