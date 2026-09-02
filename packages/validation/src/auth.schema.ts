import { z } from 'zod';
import { UserRole } from '@vent/domain';

export const IndianPhoneNumberSchema = z
  .string()
  .regex(
    /^\+91[6-9]\d{9}$/,
    'Phone number must be a valid Indian mobile number in E.164 format (e.g. +919876543210)'
  );

export const SendOtpSchema = z.object({
  phone: IndianPhoneNumberSchema,
});

export type SendOtpInput = z.infer<typeof SendOtpSchema>;

export const VerifyOtpSchema = z.object({
  phone: IndianPhoneNumberSchema,
  code: z.string().length(6, 'OTP must be 6 digits').regex(/^\d{6}$/, 'OTP must be numeric'),
});

export type VerifyOtpInput = z.infer<typeof VerifyOtpSchema>;

export const CreateUserProfileSchema = z.object({
  handle: z
    .string()
    .min(3, 'Handle must be at least 3 characters')
    .max(20, 'Handle cannot exceed 20 characters')
    .regex(/^[a-zA-Z0-9_-]+$/, 'Handle may only contain letters, numbers, hyphens, and underscores'),
  ageConfirmed: z.literal(true, {
    errorMap: () => ({ message: 'You must confirm you are at least 18 years of age.' }),
  }),
});

export type CreateUserProfileInput = z.infer<typeof CreateUserProfileSchema>;

export const StaffRoleAssignmentSchema = z.object({
  userId: z.string().uuid(),
  role: z.enum([
    UserRole.SUPPORT_AGENT,
    UserRole.LISTENER_OPS,
    UserRole.CLINICAL_SUPERVISOR,
    UserRole.FINANCE,
    UserRole.PRIVACY_ADMIN,
    UserRole.SUPER_ADMIN,
  ]),
  mfaVerified: z.boolean().default(false),
});
