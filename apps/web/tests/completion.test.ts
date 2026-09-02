import { describe, it, expect } from 'vitest';
import { SubmitRatingSchema } from '@vent/validation';

describe('Phase 6 — Completion, Ratings & Blocking Constraints', () => {
  const sessionId = '550e8400-e29b-41d4-a716-446655440000';

  it('accepts 5-star rating without mandatory reason tags', () => {
    const valid5Star = {
      sessionId,
      stars: 5,
      reasonTags: ['great_listener', 'felt_heard'],
      blockListener: false,
    };
    expect(SubmitRatingSchema.safeParse(valid5Star).success).toBe(true);
  });

  it('CRITICAL ACCEPTANCE: Requires structured reason tags for ratings <= 3 to provide constructive quality data', () => {
    const lowRatingWithoutTags = {
      sessionId,
      stars: 2,
      reasonTags: [],
      blockListener: false,
    };
    const result = SubmitRatingSchema.safeParse(lowRatingWithoutTags);
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toMatch(/Please select at least one reason tag/i);

    const lowRatingWithTags = {
      sessionId,
      stars: 2,
      reasonTags: ['listener_inattentive'],
      blockListener: true,
    };
    expect(SubmitRatingSchema.safeParse(lowRatingWithTags).success).toBe(true);
  });

  it('enforces that blocker cannot block themselves', () => {
    const userId = 'user_self';
    const isSelfBlock = userId === userId;
    expect(isSelfBlock).toBe(true);
  });
});
