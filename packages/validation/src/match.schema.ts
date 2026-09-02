import { z } from 'zod';

export const AcceptMatchSchema = z.object({
  reservationId: z.string().uuid(),
});

export const DeclineMatchSchema = z.object({
  reservationId: z.string().uuid(),
  reason: z.enum([
    'break',
    'topic_mismatch',
    'language_mismatch',
    'technical_issue',
    'other',
  ]),
});
