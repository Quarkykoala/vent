import { describe, it, expect } from 'vitest';
import {
  CreateSupportRequestSchema,
  SubmitRatingSchema,
  CreateSafetyCaseSchema,
  EnvSchema,
} from '../src/index';

describe('Validation Schemas', () => {
  describe('EnvSchema', () => {
    it('validates a correct environment configuration', () => {
      const valid = {
        NODE_ENV: 'test',
        NEXT_PUBLIC_APP_URL: 'http://localhost:3000',
        NEXT_PUBLIC_SUPABASE_URL: 'https://example.supabase.co',
        NEXT_PUBLIC_SUPABASE_ANON_KEY: 'test-anon-key-with-sufficient-length',
        SUPABASE_SERVICE_ROLE_KEY: 'test-service-role-key-with-sufficient-length',
        LIVEKIT_API_KEY: 'lk_key_123',
        LIVEKIT_API_SECRET: 'lk_secret_123',
        LIVEKIT_URL: 'wss://example.livekit.cloud',
        NEXT_PUBLIC_RAZORPAY_KEY_ID: 'rzp_test_123',
        RAZORPAY_KEY_SECRET: 'rzp_sec_123',
        RAZORPAY_WEBHOOK_SECRET: 'whsec_123',
      };
      const result = EnvSchema.safeParse(valid);
      expect(result.success).toBe(true);
    });

    it('fails when critical secrets are missing', () => {
      const invalid = {
        NODE_ENV: 'test',
        NEXT_PUBLIC_APP_URL: 'not-a-url',
      };
      const result = EnvSchema.safeParse(invalid);
      expect(result.success).toBe(false);
    });
  });

  describe('CreateSupportRequestSchema', () => {
    it('accepts valid topic, language, and 18+ age confirmation', () => {
      const valid = {
        topic: 'Relationship Conflict',
        language: 'Hindi',
        ageConfirmed: true,
        idempotencyKey: '550e8400-e29b-41d4-a716-446655440000',
      };
      expect(CreateSupportRequestSchema.safeParse(valid).success).toBe(true);
    });

    it('rejects if ageConfirmed is not true (18+ gate)', () => {
      const invalid = {
        topic: 'Relationship Conflict',
        language: 'English',
        ageConfirmed: false,
        idempotencyKey: '550e8400-e29b-41d4-a716-446655440000',
      };
      expect(CreateSupportRequestSchema.safeParse(invalid).success).toBe(false);
    });
  });

  describe('SubmitRatingSchema', () => {
    it('requires structured reason tags if rating is 3 stars or lower', () => {
      const withoutTag = {
        sessionId: '550e8400-e29b-41d4-a716-446655440000',
        stars: 2,
        reasonTags: [],
        blockListener: false,
      };
      expect(SubmitRatingSchema.safeParse(withoutTag).success).toBe(false);

      const withTag = {
        sessionId: '550e8400-e29b-41d4-a716-446655440000',
        stars: 2,
        reasonTags: ['listener_inattentive'],
        blockListener: false,
      };
      expect(SubmitRatingSchema.safeParse(withTag).success).toBe(true);
    });
  });

  describe('CreateSafetyCaseSchema', () => {
    it('validates structured safety case creation without allowing free-form narrative', () => {
      const valid = {
        sessionId: '550e8400-e29b-41d4-a716-446655440000',
        severity: 'urgent',
        reasonCodes: ['self_harm_risk'],
        idempotencyKey: '6ba7b810-9dad-11d1-80b4-00c04fd430c8',
      };
      expect(CreateSafetyCaseSchema.safeParse(valid).success).toBe(true);
    });
  });
});
