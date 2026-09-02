import { describe, it, expect } from 'vitest';
import {
  IndianPhoneNumberSchema,
  SendOtpSchema,
  VerifyOtpSchema,
  CreateUserProfileSchema,
} from '../src/index';

describe('Phase 1 — Auth Validation Schemas', () => {
  describe('IndianPhoneNumberSchema', () => {
    it('accepts valid 10-digit Indian mobile numbers with +91 prefix', () => {
      expect(IndianPhoneNumberSchema.safeParse('+919876543210').success).toBe(true);
      expect(IndianPhoneNumberSchema.safeParse('+916234567890').success).toBe(true);
    });

    it('rejects numbers starting with 0-5, landlines, or non-E.164 formats', () => {
      expect(IndianPhoneNumberSchema.safeParse('9876543210').success).toBe(false); // Missing +91
      expect(IndianPhoneNumberSchema.safeParse('+911234567890').success).toBe(false); // Starts with 1
      expect(IndianPhoneNumberSchema.safeParse('+14155552671').success).toBe(false); // US number
    });
  });

  describe('VerifyOtpSchema', () => {
    it('accepts valid 6-digit numeric OTP', () => {
      const valid = { phone: '+919876543210', code: '123456' };
      expect(VerifyOtpSchema.safeParse(valid).success).toBe(true);
    });

    it('rejects alphanumeric or non-6 digit codes', () => {
      expect(VerifyOtpSchema.safeParse({ phone: '+919876543210', code: '12345' }).success).toBe(false);
      expect(VerifyOtpSchema.safeParse({ phone: '+919876543210', code: '12345a' }).success).toBe(false);
    });
  });

  describe('CreateUserProfileSchema', () => {
    it('strictly enforces age gate of 18 or older', () => {
      expect(
        CreateUserProfileSchema.safeParse({ handle: 'CalmSoul99', ageConfirmed: true }).success
      ).toBe(true);

      expect(
        CreateUserProfileSchema.safeParse({ handle: 'CalmSoul99', ageConfirmed: false }).success
      ).toBe(false);
    });
  });
});
