import { z } from 'zod';
import { SafetyCaseSeverity } from '@vent/domain';

export const CreateSafetyCaseSchema = z.object({
  sessionId: z.string().uuid(),
  severity: z.enum([
    SafetyCaseSeverity.REVIEW,
    SafetyCaseSeverity.URGENT,
    SafetyCaseSeverity.EMERGENCY,
  ]),
  reasonCodes: z.array(
    z.enum([
      'self_harm_risk',
      'harm_to_others',
      'severe_disorientation',
      'domestic_violence',
      'boundary_violation',
      'unsure_need_supervisor',
    ])
  ).min(1, 'At least one safety reason code must be specified'),
  idempotencyKey: z.string().uuid(),
});

export type CreateSafetyCaseInput = z.infer<typeof CreateSafetyCaseSchema>;

export const AcknowledgeSafetyCaseSchema = z.object({
  caseId: z.string().uuid(),
});

export const ResolveSafetyCaseSchema = z.object({
  caseId: z.string().uuid(),
  resolutionCode: z.enum([
    'resources_shared',
    'crisis_referred',
    'false_alarm',
    'escalated_to_emergency',
    'session_terminated',
  ]),
});
