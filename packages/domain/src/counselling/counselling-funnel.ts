import { InvariantViolationError } from '../errors';

export type CounsellorCredentialStatus =
  | 'pending_verification'
  | 'verified'
  | 'suspended';

export const NON_DIAGNOSTIC_REFERRAL_CATEGORIES = [
  'stress_management',
  'grief_support',
  'relationship_counselling',
  'career_guidance',
  'emotional_regulation',
] as const;

export type ReferralCategory = (typeof NON_DIAGNOSTIC_REFERRAL_CATEGORIES)[number];

export interface CounsellorSlot {
  slotId: string;
  counsellorId: string;
  startTimeIso: string;
  endTimeIso: string;
  isBooked: boolean;
  bookedByUserId?: string;
  referralSessionId?: string;
}

export interface CounsellingBookingResult {
  bookingId: string;
  slotId: string;
  userId: string;
  counsellorId: string;
  amountPaise: bigint;
  attribution: {
    referralSessionId?: string;
    referredFromListenerId?: string;
  };
}

export const COUNSELLOR_SESSION_PRICE_PAISE = 99900n; // ₹999.00 fixed 45-min session

/**
 * Validates slot booking invariants:
 * - Counsellor must have verified credentials
 * - Slot must not already be booked (no double booking)
 * - Start time must be in the future
 */
export function validateSlotBooking(params: {
  slot: CounsellorSlot;
  counsellorStatus: CounsellorCredentialStatus;
  nowIso?: string;
}): void {
  const now = params.nowIso ? new Date(params.nowIso).getTime() : Date.now();

  if (params.counsellorStatus !== 'verified') {
    throw new InvariantViolationError(
      `Cannot book slot: Counsellor credentials are not verified (status: ${params.counsellorStatus}).`
    );
  }

  if (params.slot.isBooked) {
    throw new InvariantViolationError(
      `Cannot book slot: Slot [${params.slot.slotId}] is already booked.`
    );
  }

  if (new Date(params.slot.startTimeIso).getTime() <= now) {
    throw new InvariantViolationError('Cannot book slot: Selected time slot is in the past.');
  }
}
