import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { UserRole } from '@vent/domain';
import {
  authenticateRequest,
  requireRole,
  requirePermission,
  AuthError,
  handleAuthError,
} from '../src/features/auth/auth-guard';
import { authService, type AuthSession } from '../src/features/auth/auth-service';

describe('Package 1 — Auth Guard & Authorization Security', () => {
  const mockValidUserSession: AuthSession = {
    userId: '11111111-1111-1111-1111-111111111111',
    authUserId: '00000000-0000-0000-0000-000000000001',
    handle: 'CalmRiver123',
    role: UserRole.USER,
    token: 'valid_user_jwt',
    mfaVerified: false,
  };

  const mockFinanceSessionNoMfa: AuthSession = {
    userId: '22222222-2222-2222-2222-222222222222',
    authUserId: '00000000-0000-0000-0000-000000000002',
    handle: 'FinanceStaff999',
    role: UserRole.FINANCE,
    token: 'finance_jwt_no_mfa',
    mfaVerified: false,
  };

  const mockFinanceSessionWithMfa: AuthSession = {
    ...mockFinanceSessionNoMfa,
    mfaVerified: true,
  };

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe('Unauthenticated and Invalid Token Rejection', () => {
    it('rejects request with missing Authorization header with 401', async () => {
      const req = new NextRequest('http://localhost:3000/api/auth/me');
      await expect(authenticateRequest(req)).rejects.toThrow(AuthError);
      await expect(authenticateRequest(req)).rejects.toMatchObject({
        statusCode: 401,
        message: expect.stringContaining('Authorization Bearer token required'),
      });
    });

    it('rejects request with non-Bearer Authorization scheme with 401', async () => {
      const req = new NextRequest('http://localhost:3000/api/auth/me', {
        headers: { authorization: 'Basic dXNlcjpwYXNz' },
      });
      await expect(authenticateRequest(req)).rejects.toMatchObject({
        statusCode: 401,
      });
    });

    it('rejects request with empty Bearer token with 401', async () => {
      const req = new NextRequest('http://localhost:3000/api/auth/me', {
        headers: { authorization: 'Bearer    ' },
      });
      await expect(authenticateRequest(req)).rejects.toMatchObject({
        statusCode: 401,
      });
    });

    it('rejects invalid or expired JWT token with 401', async () => {
      vi.spyOn(authService, 'getUserFromToken').mockResolvedValue(null);

      const req = new NextRequest('http://localhost:3000/api/auth/me', {
        headers: { authorization: 'Bearer invalid_or_expired_token' },
      });

      await expect(authenticateRequest(req)).rejects.toMatchObject({
        statusCode: 401,
        message: expect.stringContaining('Invalid or expired authentication session'),
      });
    });
  });

  describe('Valid User Resolution', () => {
    it('resolves valid authenticated user session with internal UUID and pseudonym', async () => {
      vi.spyOn(authService, 'getUserFromToken').mockResolvedValue(mockValidUserSession);

      const req = new NextRequest('http://localhost:3000/api/auth/me', {
        headers: { authorization: 'Bearer valid_user_jwt' },
      });

      const session = await authenticateRequest(req);
      expect(session).toBeDefined();
      expect(session.userId).toBe(mockValidUserSession.userId);
      expect(session.authUserId).toBe(mockValidUserSession.authUserId);
      expect(session.handle).toBe('CalmRiver123');
      expect(session.role).toBe(UserRole.USER);
      expect(session.handle).not.toContain('+91');
      expect(session.handle).not.toContain('@');
    });
  });

  describe('Role Escalation & Permission Enforcement', () => {
    it('prevents regular user from performing staff operations (requireRole check)', () => {
      expect(() => {
        requireRole(mockValidUserSession, [UserRole.SUPPORT_AGENT, UserRole.CLINICAL_SUPERVISOR]);
      }).toThrow(AuthError);

      try {
        requireRole(mockValidUserSession, [UserRole.SUPPORT_AGENT]);
      } catch (err: any) {
        expect(err.statusCode).toBe(403);
        expect(err.message).toContain('Forbidden');
      }
    });

    it('denies staff operation when MFA is required but unverified', () => {
      // UserRole.FINANCE has permission canApprovePayouts, but requires MFA
      expect(() => {
        requirePermission(mockFinanceSessionNoMfa, 'canApprovePayouts');
      }).toThrow(AuthError);

      try {
        requirePermission(mockFinanceSessionNoMfa, 'canApprovePayouts');
      } catch (err: any) {
        expect(err.statusCode).toBe(403);
        expect(err.message).toContain('requires verified multi-factor authentication');
      }
    });

    it('allows staff operation when role and MFA requirements are both satisfied', () => {
      expect(() => {
        requirePermission(mockFinanceSessionWithMfa, 'canApprovePayouts');
      }).not.toThrow();
    });

    it('denies clinical safety case access to finance role even with MFA', () => {
      // INVARIANT: Finance cannot see clinical/safety records!
      expect(() => {
        requirePermission(mockFinanceSessionWithMfa, 'canViewSafetyCases');
      }).toThrow(AuthError);
    });
  });

  describe('handleAuthError response formatting', () => {
    it('returns typed JSON response matching error status code', () => {
      const authErr = new AuthError('Access denied', 403);
      const res = handleAuthError(authErr);
      expect(res.status).toBe(403);
    });
  });
});
