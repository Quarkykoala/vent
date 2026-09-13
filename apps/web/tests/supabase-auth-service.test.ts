import { describe, it, expect, vi, beforeEach } from 'vitest';
import { UserRole } from '@vent/domain';
import { SupabaseAuthService } from '../src/features/auth/supabase-auth-service';
import * as supabaseServer from '../src/lib/supabase-server';

describe('Package 1 — SupabaseAuthService Implementation', () => {
  let authService: SupabaseAuthService;
  let mockSupabaseClient: any;
  let mockAdminClient: any;

  beforeEach(() => {
    vi.restoreAllMocks();
    authService = new SupabaseAuthService();

    mockSupabaseClient = {
      auth: {
        signInWithOtp: vi.fn(),
        verifyOtp: vi.fn(),
        getUser: vi.fn(),
      },
    };

    mockAdminClient = {
      auth: {
        getUser: vi.fn(),
      },
      from: vi.fn(),
    };

    vi.spyOn(supabaseServer, 'getSupabaseServerClient').mockReturnValue(mockSupabaseClient as any);
    vi.spyOn(supabaseServer, 'getSupabaseAdmin').mockReturnValue(mockAdminClient as any);
  });

  describe('sendOtp', () => {
    it('dispatches SMS OTP via Supabase Auth without deterministic fallbacks', async () => {
      mockSupabaseClient.auth.signInWithOtp.mockResolvedValue({ error: null });

      const res = await authService.sendOtp('+919876543210');
      expect(res.success).toBe(true);
      expect(mockSupabaseClient.auth.signInWithOtp).toHaveBeenCalledWith({
        phone: '+919876543210',
        options: { channel: 'sms' },
      });
    });

    it('throws when Supabase Auth returns an error', async () => {
      mockSupabaseClient.auth.signInWithOtp.mockResolvedValue({
        error: { message: 'SMS provider quota exceeded' },
      });

      await expect(authService.sendOtp('+919876543210')).rejects.toThrow(
        /Supabase Auth OTP dispatch failed: SMS provider quota exceeded/
      );
    });
  });

  describe('verifyOtp', () => {
    it('requires age confirmation (18+ only)', async () => {
      await expect(
        authService.verifyOtp({
          phone: '+919876543210',
          code: '123456',
          ageConfirmed: false,
        })
      ).rejects.toThrow(/Age confirmation required/);
    });

    it('creates a new public.users record with pseudonym if user does not exist', async () => {
      mockSupabaseClient.auth.verifyOtp.mockResolvedValue({
        data: {
          user: { id: '00000000-0000-0000-0000-000000000001', app_metadata: {} },
          session: { access_token: 'jwt_token_123', aal: 'aal1' },
        },
        error: null,
      });

      // Mock userRepo findByAuthUserId (returns null) then createUser
      const mockQueryBuilder = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
        insert: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({
          data: {
            id: '11111111-1111-1111-1111-111111111111',
            auth_user_id: '00000000-0000-0000-0000-000000000001',
            handle: 'KindBreeze456',
            age_verified_at: new Date().toISOString(),
            status: 'active',
          },
          error: null,
        }),
      };

      mockAdminClient.from.mockImplementation((table: string) => {
        if (table === 'users') return mockQueryBuilder;
        if (table === 'listener_profiles') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
          };
        }
        return mockQueryBuilder;
      });

      const res = await authService.verifyOtp({
        phone: '+919876543210',
        code: '654321',
        ageConfirmed: true,
      });

      expect(res.session).toBeDefined();
      expect(res.session.userId).toBe('11111111-1111-1111-1111-111111111111');
      expect(res.session.authUserId).toBe('00000000-0000-0000-0000-000000000001');
      expect(res.session.handle).toBe('KindBreeze456');
      expect(res.session.role).toBe(UserRole.USER);
      expect(res.session.mfaVerified).toBe(false);
    });

    it('rejects suspended accounts', async () => {
      mockSupabaseClient.auth.verifyOtp.mockResolvedValue({
        data: {
          user: { id: '00000000-0000-0000-0000-000000000002', app_metadata: {} },
          session: { access_token: 'jwt_token_456', aal: 'aal1' },
        },
        error: null,
      });

      mockAdminClient.from.mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({
          data: {
            id: '22222222-2222-2222-2222-222222222222',
            auth_user_id: '00000000-0000-0000-0000-000000000002',
            handle: 'SuspendedUser001',
            status: 'suspended',
          },
          error: null,
        }),
      });

      await expect(
        authService.verifyOtp({
          phone: '+919876543210',
          code: '654321',
          ageConfirmed: true,
        })
      ).rejects.toThrow(/Account access restricted/);
    });

    it('repairs null age evidence for an existing profile on genuine verification', async () => {
      mockSupabaseClient.auth.verifyOtp.mockResolvedValue({
        data: {
          user: { id: '00000000-0000-0000-0000-000000000003', app_metadata: {} },
          session: { access_token: 'jwt_token_789', aal: 'aal1' },
        },
        error: null,
      });

      const existingRow = {
        id: '33333333-3333-3333-3333-333333333333',
        auth_user_id: '00000000-0000-0000-0000-000000000003',
        handle: 'PatientMeadow789',
        age_verified_at: null,
        status: 'active',
      };
      const repairedRow = {
        ...existingRow,
        age_verified_at: new Date().toISOString(),
      };

      let updateCalled = false;
      mockAdminClient.from.mockImplementation((table: string) => {
        if (table === 'users') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({ data: existingRow, error: null }),
            update: vi.fn().mockImplementation(() => {
              updateCalled = true;
              return {
                eq: vi.fn().mockReturnThis(),
                select: vi.fn().mockReturnThis(),
                single: vi.fn().mockResolvedValue({ data: repairedRow, error: null }),
              };
            }),
          };
        }
        if (table === 'listener_profiles') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
          };
        }
        return {};
      });

      const res = await authService.verifyOtp({
        phone: '+919876543210',
        code: '654321',
        ageConfirmed: true,
      });

      expect(updateCalled).toBe(true);
      expect(res.session.userId).toBe(existingRow.id);
    });

    it('does not rewrite existing age evidence on repeat verification', async () => {
      mockSupabaseClient.auth.verifyOtp.mockResolvedValue({
        data: {
          user: { id: '00000000-0000-0000-0000-000000000004', app_metadata: {} },
          session: { access_token: 'jwt_token_abc', aal: 'aal1' },
        },
        error: null,
      });

      const existingRow = {
        id: '44444444-4444-4444-4444-444444444444',
        auth_user_id: '00000000-0000-0000-0000-000000000004',
        handle: 'CalmHarbor321',
        age_verified_at: '2026-01-01T00:00:00.000Z',
        status: 'active',
      };

      const updateSpy = vi.fn();
      mockAdminClient.from.mockImplementation((table: string) => {
        if (table === 'users') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({ data: existingRow, error: null }),
            update: updateSpy,
          };
        }
        if (table === 'listener_profiles') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
          };
        }
        return {};
      });

      const res = await authService.verifyOtp({
        phone: '+919876543210',
        code: '654321',
        ageConfirmed: true,
      });

      expect(updateSpy).not.toHaveBeenCalled();
      expect(res.session.userId).toBe(existingRow.id);
    });

    it('maps provider expiry to an expired-code message', async () => {
      mockSupabaseClient.auth.verifyOtp.mockResolvedValue({
        data: { user: null, session: null },
        error: { message: 'Token has expired or is invalid' },
      });

      await expect(
        authService.verifyOtp({
          phone: '+919876543210',
          code: '654321',
          ageConfirmed: true,
        })
      ).rejects.toThrow(/expired.*new one/i);
    });

    it('maps a wrong code to an invalid-code message', async () => {
      mockSupabaseClient.auth.verifyOtp.mockResolvedValue({
        data: { user: null, session: null },
        error: { message: 'invalid otp' },
      });

      await expect(
        authService.verifyOtp({
          phone: '+919876543210',
          code: '000000',
          ageConfirmed: true,
        })
      ).rejects.toThrow(/invalid code/i);
    });
  });

  describe('getUserFromToken', () => {
    it('returns null for empty or invalid token', async () => {
      mockAdminClient.auth.getUser.mockResolvedValue({ data: { user: null }, error: { message: 'Invalid token' } });
      const session = await authService.getUserFromToken('bad_token');
      expect(session).toBeNull();
    });

    it('auto-provisions public.users record if authenticated user lacks public record', async () => {
      mockAdminClient.auth.getUser.mockResolvedValue({
        data: { user: { id: 'auth_id_999', app_metadata: {} } },
        error: null,
      });
      mockAdminClient.from.mockImplementation((table: string) => {
        if (table === 'users') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
            insert: vi.fn().mockReturnThis(),
            single: vi.fn().mockResolvedValue({
              data: {
                id: 'new_user_uuid',
                auth_user_id: 'auth_id_999',
                handle: 'GentleCloud123',
                status: 'active',
              },
              error: null,
            }),
          };
        }
        if (table === 'listener_profiles') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
          };
        }
        return {};
      });

      const session = await authService.getUserFromToken('token_without_public_user');
      expect(session).toBeDefined();
      expect(session?.userId).toBe('new_user_uuid');
      expect(session?.handle).toBe('GentleCloud123');
    });
  });
});
