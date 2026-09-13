import { describe, it, expect } from 'vitest';
import {
  validateSlotBooking,
  NON_DIAGNOSTIC_REFERRAL_CATEGORIES,
  type CounsellorSlot,
} from '../src/index';

describe('Phase 9 — Professional Counselling Referral Funnel Invariants', () => {
  const futureStart = new Date(Date.now() + 86400000).toISOString();
  const futureEnd = new Date(Date.now() + 86400000 + 2700000).toISOString();

  const mockSlot: CounsellorSlot = {
    slotId: 'slot-123',
    counsellorId: 'counsellor-456',
    startTimeIso: futureStart,
    endTimeIso: futureEnd,
    isBooked: false,
  };

  it('allows booking when counsellor is verified and slot is unbooked', () => {
    expect(() =>
      validateSlotBooking({
        slot: mockSlot,
        counsellorStatus: 'verified',
      })
    ).not.toThrow();
  });

  it('CRITICAL ACCEPTANCE: Rejects booking if counsellor credentials are not verified', () => {
    expect(() =>
      validateSlotBooking({
        slot: mockSlot,
        counsellorStatus: 'pending_verification',
      })
    ).toThrow(/credentials are not verified/);

    expect(() =>
      validateSlotBooking({
        slot: mockSlot,
        counsellorStatus: 'suspended',
      })
    ).toThrow(/credentials are not verified/);
  });

  it('CRITICAL ACCEPTANCE: Prevents double booking of same time slot', () => {
    const alreadyBookedSlot: CounsellorSlot = {
      ...mockSlot,
      isBooked: true,
      bookedByUserId: 'user-prior',
    };

    expect(() =>
      validateSlotBooking({
        slot: alreadyBookedSlot,
        counsellorStatus: 'verified',
      })
    ).toThrow(/already booked/);
  });

  it('rejects booking time slots in the past', () => {
    const pastSlot: CounsellorSlot = {
      ...mockSlot,
      startTimeIso: new Date('2025-01-01T10:00:00Z').toISOString(),
    };

    expect(() =>
      validateSlotBooking({
        slot: pastSlot,
        counsellorStatus: 'verified',
      })
    ).toThrow(/in the past/);
  });

  it('enforces that all referral categories are strictly non-diagnostic', () => {
    // Prohibited clinical diagnoses must NOT appear in referral categories
    const prohibitedTerms = ['bipolar', 'schizophrenia', 'clinical_depression', 'ptsd', 'adhd'];

    for (const term of prohibitedTerms) {
      expect(NON_DIAGNOSTIC_REFERRAL_CATEGORIES).not.toContain(term);
    }

    // Supported categories are functional / supportive
    expect(NON_DIAGNOSTIC_REFERRAL_CATEGORIES).toContain('stress_management');
    expect(NON_DIAGNOSTIC_REFERRAL_CATEGORIES).toContain('grief_support');
    expect(NON_DIAGNOSTIC_REFERRAL_CATEGORIES).toContain('emotional_regulation');
  });
});
