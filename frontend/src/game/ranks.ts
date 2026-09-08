// Rank thresholds (mirrors backend defaults) for badge display.
export const RANK_TIERS: { name: string; minScore: number }[] = [
  { name: 'copper', minScore: 0 },
  { name: 'iron', minScore: 500 },
  { name: 'gold', minScore: 1000 },
  { name: 'diamond', minScore: 2000 },
  { name: 'mythril', minScore: 3500 },
];

export function rankForScore(score: number): string {
  let rank = 'copper';
  for (const t of RANK_TIERS) {
    if (score >= t.minScore) rank = t.name;
  }
  return rank;
}
