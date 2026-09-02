import { describe, it, expect } from 'vitest';
import { TrackAnalyticsEventSchema, UserErasureRequestSchema } from '@vent/validation';

describe('Phase 10 — Web Analytics & Erasure Schema Tests', () => {
  it('validates allowlisted analytics event input', () => {
    const valid = {
      event: 'session_started',
      distinctId: 'user-anon-101',
      properties: { language: 'Hindi', duration_mins: 20 },
    };
    expect(TrackAnalyticsEventSchema.safeParse(valid).success).toBe(true);
  });

  it('rejects unknown event names', () => {
    const invalid = {
      event: 'user_clicked_random_button',
      distinctId: 'user-anon-101',
      properties: {},
    };
    expect(TrackAnalyticsEventSchema.safeParse(invalid).success).toBe(false);
  });

  it('requires explicit consent acknowledgement for DPDP 2025 erasure', () => {
    const valid = {
      userId: '550e8400-e29b-41d4-a716-446655440000',
      consentAcknowledged: true,
    };
    expect(UserErasureRequestSchema.safeParse(valid).success).toBe(true);

    const invalid = {
      userId: '550e8400-e29b-41d4-a716-446655440000',
      consentAcknowledged: false,
    };
    expect(UserErasureRequestSchema.safeParse(invalid).success).toBe(false);
  });
});
