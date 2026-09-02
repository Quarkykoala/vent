import { z } from 'zod';
import { SUPPORTED_LANGUAGES, SUPPORTED_TOPICS } from '@vent/domain';

export const CreateSupportRequestSchema = z.object({
  topic: z.enum(SUPPORTED_TOPICS),
  language: z.enum(SUPPORTED_LANGUAGES),
  ageConfirmed: z.literal(true, {
    errorMap: () => ({ message: 'You must confirm that you are at least 18 years of age.' }),
  }),
  idempotencyKey: z.string().uuid(),
});

export type CreateSupportRequestInput = z.infer<typeof CreateSupportRequestSchema>;

export const CancelSupportRequestSchema = z.object({
  requestId: z.string().uuid(),
  reason: z.string().max(100).optional(),
});
