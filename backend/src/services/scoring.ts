// Scoring formula + rank tiers. Weights are configurable per guild (teacher
// tweaks them via guild settings); solo adventurers use these defaults.

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

export const DEFAULT_SCORE_WEIGHTS: ScoreWeights = {
  basePoints: 100,
  mistakePenalty: 10,
  timePenalty: 20,
  timeParSeconds: 300, // 5 minutes par per quest
  incompletePenalty: 50,
  outOfLifePenalty: 30,
  lifeBonus: 15,
  coinBase: 10,
  coinFlawlessBonus: 5, // no mistakes
  coinFullLifeBonus: 5, // finished with all 3 lives
};

export interface ScoreInput {
  mistakes: number;
  timeSeconds: number;
  finished: boolean;
  livesRemaining: number;
  outOfLife: boolean;
}

export interface ScoreResult {
  rawScore: number;
  coins: number;
  breakdown: { label: string; value: number }[];
}

export function computeScore(input: ScoreInput, weights: ScoreWeights = DEFAULT_SCORE_WEIGHTS): ScoreResult {
  const breakdown: { label: string; value: number }[] = [];
  let score = weights.basePoints;
  breakdown.push({ label: 'Base', value: weights.basePoints });

  if (input.mistakes > 0) {
    const pen = input.mistakes * weights.mistakePenalty;
    score -= pen;
    breakdown.push({ label: `Mistakes ×${input.mistakes}`, value: -pen });
  }

  if (input.timeSeconds > weights.timeParSeconds) {
    score -= weights.timePenalty;
    breakdown.push({ label: 'Over par time', value: -weights.timePenalty });
  }

  if (!input.finished) {
    score -= weights.incompletePenalty;
    breakdown.push({ label: 'Did not finish', value: -weights.incompletePenalty });
  }

  if (input.outOfLife) {
    score -= weights.outOfLifePenalty;
    breakdown.push({ label: 'Ran out of lives', value: -weights.outOfLifePenalty });
  }

  if (input.livesRemaining > 0) {
    const bonus = input.livesRemaining * weights.lifeBonus;
    score += bonus;
    breakdown.push({ label: `Lives kept ×${input.livesRemaining}`, value: bonus });
  }

  const rawScore = Math.max(0, Math.round(score));

  // Coins: flat reward, plus bonuses. Coins are never negative and are not
  // term-reset — they accumulate across terms.
  let coins = weights.coinBase;
  if (input.mistakes === 0 && input.finished) coins += weights.coinFlawlessBonus;
  if (input.livesRemaining >= 3) coins += weights.coinFullLifeBonus;
  coins = Math.max(0, coins);

  return { rawScore, coins, breakdown };
}
