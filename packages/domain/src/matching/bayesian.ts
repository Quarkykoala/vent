export interface BayesianQualityParams {
  averageRating: number; // r: listener average (1.0 to 5.0)
  totalRatedSessions: number; // n: total ratings count
  priorMean?: number; // m: marketplace mean (default 4.5)
  priorWeight?: number; // C: prior strength (default 20)
}

export const DEFAULT_PRIOR_MEAN = 4.5;
export const DEFAULT_PRIOR_WEIGHT = 20;

/**
 * Computes Bayesian-smoothed listener rating.
 * Formula: quality = (C * m + n * r) / (C + n)
 * Prevents a listener with a single 5-star review outranking an established high performer.
 */
export function calculateBayesianRating(params: BayesianQualityParams): number {
  const {
    averageRating,
    totalRatedSessions,
    priorMean = DEFAULT_PRIOR_MEAN,
    priorWeight = DEFAULT_PRIOR_WEIGHT,
  } = params;

  if (totalRatedSessions < 0) {
    throw new Error('Total rated sessions cannot be negative');
  }

  const smoothed =
    (priorWeight * priorMean + totalRatedSessions * averageRating) /
    (priorWeight + totalRatedSessions);

  return Math.min(5.0, Math.max(1.0, smoothed));
}

/**
 * Normalizes Bayesian smoothed rating (1..5) to [0, 1] range for matching score.
 */
export function calculateNormalizedBayesianQuality(
  params: BayesianQualityParams
): number {
  const rating = calculateBayesianRating(params);
  // Map 1.0..5.0 to 0.0..1.0
  const normalized = (rating - 1.0) / 4.0;
  return Math.min(1.0, Math.max(0.0, normalized));
}
