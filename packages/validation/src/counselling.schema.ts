import { z } from 'zod';
import { NON_DIAGNOSTIC_REFERRAL_CATEGORIES } from '@vent/domain';

export const CreateCounsellorSlotSchema = z.object({
  counsellorId: z.string().uuid(),
  startTimeIso: z.string().datetime(),
  endTimeIso: z.string().datetime(),
});

export const BookCounsellorSlotSchema = z.object({
  slotId: z.string().uuid(),
  referralSessionId: z.string().uuid().optional(),
  referredFromListenerId: z.string().uuid().optional(),
});

export const CounsellingReferralOfferSchema = z.object({
  sessionId: z.string().uuid(),
  category: z.enum(NON_DIAGNOSTIC_REFERRAL_CATEGORIES),
});
