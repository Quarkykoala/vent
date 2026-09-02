import type { ScoreComponents } from '../types';

export const MATCH_WEIGHTS = {
  LANGUAGE: 0.3,
  TOPIC: 0.25,
  WAIT_FAIRNESS: 0.15,
  QUALITY: 0.15,
  REPEAT_AFFINITY: 0.1,
  LOAD_BALANCE: 0.05,
} as const;

export interface CalculateScoreInput {
  languageMatch: boolean;
  topicMatch: boolean;
  /** Minutes listener has been waiting available, normalized up to maxWaitMinutes (e.g. 60m) */
  availableWaitMinutes: number;
  maxWaitTargetMinutes?: number;
  /** Normalized Bayesian quality [0, 1] */
  normalizedQuality: number;
  /** Whether user previously rated this listener >= 4 with no blocks */
  hasRepeatAffinity: boolean;
  /** Completed sessions today, normalized against cap (e.g. 10) */
  sessionsCompletedToday: number;
  maxDailySessions?: number;
}

export function calculateMatchingScore(input: CalculateScoreInput): {
  totalScore: number;
  components: ScoreComponents;
} {
  const languageScore = input.languageMatch ? 1.0 : 0.0;
  const topicScore = input.topicMatch ? 1.0 : 0.0;

  const maxWait = input.maxWaitTargetMinutes ?? 60;
  const waitFairness = Math.min(
    1.0,
    Math.max(0.0, input.availableWaitMinutes / maxWait)
  );

  const bayesianQuality = Math.min(
    1.0,
    Math.max(0.0, input.normalizedQuality)
  );

  const repeatAffinity = input.hasRepeatAffinity ? 1.0 : 0.0;

  const maxDaily = input.maxDailySessions ?? 10;
  const loadBalance = Math.max(
    0.0,
    1.0 - Math.min(input.sessionsCompletedToday, maxDaily) / maxDaily
  );

  const components: ScoreComponents = {
    languageScore,
    topicScore,
    waitFairness,
    bayesianQuality,
    repeatAffinity,
    loadBalance,
  };

  const totalScore =
    MATCH_WEIGHTS.LANGUAGE * languageScore +
    MATCH_WEIGHTS.TOPIC * topicScore +
    MATCH_WEIGHTS.WAIT_FAIRNESS * waitFairness +
    MATCH_WEIGHTS.QUALITY * bayesianQuality +
    MATCH_WEIGHTS.REPEAT_AFFINITY * repeatAffinity +
    MATCH_WEIGHTS.LOAD_BALANCE * loadBalance;

  // Round to 4 decimal places for deterministic persistence
  const roundedTotal = Math.round(totalScore * 10000) / 10000;

  return {
    totalScore: roundedTotal,
    components,
  };
}
