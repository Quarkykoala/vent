import { z } from 'zod';
import { ALLOWLISTED_ANALYTICS_EVENTS } from '@vent/domain';

export const TrackAnalyticsEventSchema = z.object({
  event: z.enum(ALLOWLISTED_ANALYTICS_EVENTS),
  distinctId: z.string().min(3).max(64),
  properties: z.record(z.unknown()).default({}),
});

export const UserErasureRequestSchema = z.object({
  userId: z.string().uuid(),
  consentAcknowledged: z.literal(true, {
    errorMap: () => ({ message: 'User must explicitly acknowledge irreversible erasure under DPDP 2025.' }),
  }),
});
