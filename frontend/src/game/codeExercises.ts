import type { Challenge } from '../types';

/**
 * Code exercises are only playable when the server has a code runner. Legacy
 * tomes may still contain them after the runner is switched off, so the quest
 * pool drops those instead of letting one block a lesson. Every other
 * challenge type is passed through untouched.
 */
export function playableChallenges(challenges: Challenge[]): Challenge[] {
  if (!challenges.some((c) => c.type === 'code_exercise' && c.codeRunnerAvailable === false)) return challenges;
  return challenges.filter((c) => c.type !== 'code_exercise' || c.codeRunnerAvailable !== false);
}
