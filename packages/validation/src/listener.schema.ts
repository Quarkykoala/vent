import { z } from 'zod';
import { SUPPORTED_LANGUAGES, SUPPORTED_TOPICS, ListenerStatus, ServiceTier } from '@vent/domain';

export const CreateListenerProfileSchema = z.object({
  userId: z.string().uuid(),
  displayName: z.string().min(2).max(50),
  tier: z.enum([ServiceTier.LISTENER, ServiceTier.COUNSELLOR]).default(ServiceTier.LISTENER),
  languages: z.array(z.enum(SUPPORTED_LANGUAGES)).min(1),
  topics: z.array(z.enum(SUPPORTED_TOPICS)).min(1),
});

export type CreateListenerProfileInput = z.infer<typeof CreateListenerProfileSchema>;

export const UpdateListenerStatusSchema = z.object({
  listenerId: z.string().uuid(),
  status: z.enum([
    ListenerStatus.APPLICANT,
    ListenerStatus.TRAINING,
    ListenerStatus.ACTIVE,
    ListenerStatus.PAUSED,
    ListenerStatus.SUSPENDED,
    ListenerStatus.REJECTED,
  ]),
  trainingExpiresAt: z.string().datetime().nullable().optional(),
  reason: z.string().min(3).max(200).optional(),
});

export const ListenerHeartbeatSchema = z.object({
  listenerId: z.string().uuid(),
});

export const ToggleListenerPresenceSchema = z.object({
  listenerId: z.string().uuid(),
  desiredState: z.enum(['available', 'offline']),
});
