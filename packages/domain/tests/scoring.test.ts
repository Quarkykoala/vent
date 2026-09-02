import { describe, it, expect } from 'vitest';
import {
  calculateBayesianRating,
  calculateNormalizedBayesianQuality,
  calculateMatchingScore,
  MATCH_WEIGHTS,
} from '../src/index';

describe('Matching and Quality Scoring', () => {
  describe('Bayesian Quality Score', () => {
    it('shrinks a listener with only 1 five-star rating towards marketplace prior (4.5)', () => {
      // n=1, r=5.0, C=20, m=4.5 -> (20*4.5 + 1*5.0) / 21 = (90 + 5) / 21 = 95/21 = 4.5238
      const smoothed = calculateBayesianRating({
        averageRating: 5.0,
        totalRatedSessions: 1,
        priorMean: 4.5,
        priorWeight: 20,
      });
      expect(smoothed).toBeCloseTo(4.5238, 3);
      expect(smoothed).toBeLessThan(4.6);
    });

    it('rewards an experienced listener with 200 ratings of 4.9', () => {
      // n=200, r=4.9, C=20, m=4.5 -> (90 + 980) / 220 = 1070 / 220 = 4.8636
      const smoothed = calculateBayesianRating({
        averageRating: 4.9,
        totalRatedSessions: 200,
        priorMean: 4.5,
        priorWeight: 20,
      });
      expect(smoothed).toBeCloseTo(4.8636, 3);
      expect(smoothed).toBeGreaterThan(4.8);
    });

    it('normalizes rating into [0, 1] interval properly', () => {
      const minNorm = calculateNormalizedBayesianQuality({
        averageRating: 1.0,
        totalRatedSessions: 1000,
      });
      expect(minNorm).toBeGreaterThanOrEqual(0.0);
      expect(minNorm).toBeLessThan(0.1);

      const maxNorm = calculateNormalizedBayesianQuality({
        averageRating: 5.0,
        totalRatedSessions: 1000,
      });
      expect(maxNorm).toBeGreaterThan(0.9);
      expect(maxNorm).toBeLessThanOrEqual(1.0);
    });
  });

  describe('Deterministic Matching Score Calculation', () => {
    it('computes weighted score accurately according to specification weights', () => {
      const result = calculateMatchingScore({
        languageMatch: true, // 1.0 * 0.30 = 0.30
        topicMatch: true, // 1.0 * 0.25 = 0.25
        availableWaitMinutes: 30, // 30/60 = 0.5 * 0.15 = 0.075
        maxWaitTargetMinutes: 60,
        normalizedQuality: 0.8, // 0.8 * 0.15 = 0.12
        hasRepeatAffinity: true, // 1.0 * 0.10 = 0.10
        sessionsCompletedToday: 0, // (1 - 0) * 0.05 = 0.05
        maxDailySessions: 10,
      });

      // Total expected: 0.30 + 0.25 + 0.075 + 0.12 + 0.10 + 0.05 = 0.895
      expect(result.totalScore).toBeCloseTo(0.895, 3);
      expect(result.components.languageScore).toBe(1.0);
      expect(result.components.topicScore).toBe(1.0);
      expect(result.components.waitFairness).toBe(0.5);
      expect(result.components.repeatAffinity).toBe(1.0);
      expect(result.components.loadBalance).toBe(1.0);
    });

    it('zeros out language or topic when there is no match', () => {
      const result = calculateMatchingScore({
        languageMatch: false,
        topicMatch: false,
        availableWaitMinutes: 0,
        normalizedQuality: 0.5,
        hasRepeatAffinity: false,
        sessionsCompletedToday: 10,
      });

      expect(result.components.languageScore).toBe(0);
      expect(result.components.topicScore).toBe(0);
      expect(result.components.loadBalance).toBe(0);
      expect(result.totalScore).toBeCloseTo(0.5 * MATCH_WEIGHTS.QUALITY, 4);
    });

    it('always bounds score within [0, 1]', () => {
      const maxScore = calculateMatchingScore({
        languageMatch: true,
        topicMatch: true,
        availableWaitMinutes: 120, // clamps to 1.0
        normalizedQuality: 1.0,
        hasRepeatAffinity: true,
        sessionsCompletedToday: 0,
      });
      expect(maxScore.totalScore).toBeLessThanOrEqual(1.0);
      expect(maxScore.totalScore).toBeGreaterThanOrEqual(0.0);
    });
  });
});
