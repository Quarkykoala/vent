import { describe, it, expect } from 'vitest';
import { DeclineMatchSchema, AcceptMatchSchema } from '@vent/validation';

describe('Phase 4 — Matching API Endpoints Validation', () => {
  it('validates match accept input', () => {
    const valid = { reservationId: '550e8400-e29b-41d4-a716-446655440000' };
    expect(AcceptMatchSchema.safeParse(valid).success).toBe(true);
  });

  it('validates match decline with allowed reason code', () => {
    const valid = {
      reservationId: '550e8400-e29b-41d4-a716-446655440000',
      reason: 'topic_mismatch',
    };
    expect(DeclineMatchSchema.safeParse(valid).success).toBe(true);
  });
});
