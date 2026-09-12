import { describe, it, expect } from 'vitest';
import { BookCounsellorSlotSchema, CounsellingReferralOfferSchema } from '@vent/validation';

describe('Phase 9 — Web Counselling API Validation', () => {
  it('validates booking with referral attribution and ignores client userId', () => {
    const valid = {
      slotId: '550e8400-e29b-41d4-a716-446655440000',
      referralSessionId: '7ca7b810-9dad-11d1-80b4-00c04fd430c9',
      referredFromListenerId: '8ca7b810-9dad-11d1-80b4-00c04fd430ca',
    };
    const parsed = BookCounsellorSlotSchema.safeParse(valid);
    expect(parsed.success).toBe(true);
    expect(parsed.data).not.toHaveProperty('userId');
  });

  it('validates referral category matches allowed list', () => {
    const valid = {
      sessionId: '550e8400-e29b-41d4-a716-446655440000',
      category: 'grief_support',
    };
    expect(CounsellingReferralOfferSchema.safeParse(valid).success).toBe(true);

    const invalid = {
      sessionId: '550e8400-e29b-41d4-a716-446655440000',
      category: 'medical_treatment', // Not in allowed non-diagnostic list
    };
    expect(CounsellingReferralOfferSchema.safeParse(invalid).success).toBe(false);
  });
});
