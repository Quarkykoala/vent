import { describe, it, expect } from 'vitest';
import { CreateSafetyCaseSchema, ResolveSafetyCaseSchema } from '@vent/validation';

describe('Phase 7 — Web Safety API Validation', () => {
  it('validates safety case creation input', () => {
    const valid = {
      sessionId: '550e8400-e29b-41d4-a716-446655440000',
      severity: 'emergency',
      reasonCodes: ['self_harm_risk'],
      idempotencyKey: '6ba7b810-9dad-11d1-80b4-00c04fd430c8',
    };
    expect(CreateSafetyCaseSchema.safeParse(valid).success).toBe(true);
  });

  it('validates supervisor resolution payload', () => {
    const valid = {
      caseId: '550e8400-e29b-41d4-a716-446655440000',
      resolutionCode: 'crisis_referred',
    };
    expect(ResolveSafetyCaseSchema.safeParse(valid).success).toBe(true);
  });
});
