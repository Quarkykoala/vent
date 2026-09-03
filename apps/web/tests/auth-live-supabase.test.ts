import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { UserRole, hasPermission } from '@vent/domain';
import { SupabaseAuthService } from '../src/features/auth/supabase-auth-service';
import { getSupabaseAdmin, getSupabaseServerClient } from '../src/lib/supabase-server';
import { requirePermission, requireRole, AuthError } from '../src/features/auth/auth-guard';

describe('Package 1 — Comprehensive Live Supabase Auth Integration', () => {
  const authService = new SupabaseAuthService();
  let userAAuthId: string;
  let userBAuthId: string;
  let userAJwt: string;
  let userBJwt: string;
  let supervisorAuthId: string;
  let supervisorJwt: string;

  const phoneA = '+919999911111';
  const phoneB = '+919999922222';
  const phoneSupervisor = '+919999933333';

  beforeAll(async () => {
    const admin = getSupabaseAdmin();

    // Cleanup prior runs
    const { data: existingUsers } = await admin.auth.admin.listUsers();
    for (const u of existingUsers?.users || []) {
      if ([phoneA, phoneB, phoneSupervisor].includes(u.phone || '')) {
        await admin.from('users').delete().eq('auth_user_id', u.id);
        await admin.auth.admin.deleteUser(u.id);
      }
    }

    // 1. Create User A
    const { data: userAData } = await admin.auth.admin.createUser({
      phone: phoneA,
      phone_confirm: true,
      password: 'StrongTestPassword123!',
      user_metadata: { role: 'admin' }, // malicious client attempt to claim admin
      app_metadata: { role: UserRole.USER }, // authoritative
    });
    userAAuthId = userAData.user!.id;
    const clientA = getSupabaseServerClient();
    const { data: signInA } = await clientA.auth.signInWithPassword({
      phone: phoneA,
      password: 'StrongTestPassword123!',
    });
    userAJwt = signInA.session!.access_token;

    // 2. Create User B
    const { data: userBData } = await admin.auth.admin.createUser({
      phone: phoneB,
      phone_confirm: true,
      password: 'StrongTestPassword123!',
      app_metadata: { role: UserRole.USER },
    });
    userBAuthId = userBData.user!.id;
    const clientB = getSupabaseServerClient();
    const { data: signInB } = await clientB.auth.signInWithPassword({
      phone: phoneB,
      password: 'StrongTestPassword123!',
    });
    userBJwt = signInB.session!.access_token;

    // 3. Create Clinical Supervisor (Staff role requiring MFA)
    const { data: supervisorData } = await admin.auth.admin.createUser({
      phone: phoneSupervisor,
      phone_confirm: true,
      password: 'StrongTestPassword123!',
      app_metadata: { role: UserRole.CLINICAL_SUPERVISOR },
    });
    supervisorAuthId = supervisorData.user!.id;
    const clientSup = getSupabaseServerClient();
    const { data: signInSup } = await clientSup.auth.signInWithPassword({
      phone: phoneSupervisor,
      password: 'StrongTestPassword123!',
    });
    supervisorJwt = signInSup.session!.access_token;
  });

  afterAll(async () => {
    const admin = getSupabaseAdmin();
    for (const id of [userAAuthId, userBAuthId, supervisorAuthId]) {
      if (id) {
        await admin.from('users').delete().eq('auth_user_id', id);
        await admin.auth.admin.deleteUser(id);
      }
    }
  });

  it('unauthenticated rejection: rejects missing and invalid tokens', async () => {
    const emptySession = await authService.getUserFromToken('');
    expect(emptySession).toBeNull();

    const forgedSession = await authService.getUserFromToken('eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.e30.bogus');
    expect(forgedSession).toBeNull();
  });

  it('valid user: establishes internal UUID and privacy pseudonym in Postgres', async () => {
    const sessionA = await authService.getUserFromToken(userAJwt);
    expect(sessionA).toBeDefined();
    expect(sessionA!.authUserId).toBe(userAAuthId);
    expect(sessionA!.userId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
    expect(sessionA!.handle).toMatch(/^[A-Z][a-z]+[A-Z][a-z]+\d{3}$/);
    expect(sessionA!.handle).not.toContain('9999911111');
    expect(sessionA!.handle).not.toContain('@');

    // Confirm existence in public.users via uncorrupted admin client
    const admin = getSupabaseAdmin();
    const { data: row, error: rowErr } = await admin
      .from('users')
      .select('*')
      .eq('id', sessionA!.userId)
      .single();

    expect(rowErr).toBeNull();
    expect(row).toBeDefined();
    expect((row as any).status).toBe('active');
    expect((row as any).handle).toBe(sessionA!.handle);
  });

  it('cross-user isolation: User A and User B receive distinct UUIDs and handles', async () => {
    const sessionA = await authService.getUserFromToken(userAJwt);
    const sessionB = await authService.getUserFromToken(userBJwt);

    expect(sessionA).toBeDefined();
    expect(sessionB).toBeDefined();
    expect(sessionA!.userId).not.toBe(sessionB!.userId);
    expect(sessionA!.authUserId).not.toBe(sessionB!.authUserId);
    expect(sessionA!.handle).not.toBe(sessionB!.handle);
  });

  it('user cannot become listener/admin by modifying client metadata', async () => {
    const sessionA = await authService.getUserFromToken(userAJwt);
    expect(sessionA!.role).toBe(UserRole.USER);
    expect(sessionA!.role).not.toBe(UserRole.SUPER_ADMIN);
    expect(sessionA!.role).not.toBe(UserRole.LISTENER);

    // Verify requireRole rejects user from staff operations
    expect(() => requireRole(sessionA!, [UserRole.SUPPORT_AGENT, UserRole.CLINICAL_SUPERVISOR])).toThrow(AuthError);
  });

  it('staff operation without MFA denied: Clinical supervisor without MFA is denied privileged action', async () => {
    const sessionSup = await authService.getUserFromToken(supervisorJwt);
    expect(sessionSup).toBeDefined();
    expect(sessionSup!.role).toBe(UserRole.CLINICAL_SUPERVISOR);
    expect(sessionSup!.mfaVerified).toBe(false); // standard sign in without AAL2

    // Clinical supervisor has permission canResolveSafetyCases, but requires MFA!
    expect(hasPermission(sessionSup!.role, 'canResolveSafetyCases')).toBe(true);
    expect(() => requirePermission(sessionSup!, 'canResolveSafetyCases')).toThrow(AuthError);
  });

  it('staff operation with MFA allowed: Clinical supervisor with verified MFA succeeds', async () => {
    const sessionSup = await authService.getUserFromToken(supervisorJwt);
    const verifiedSession = { ...sessionSup!, mfaVerified: true };

    expect(() => requirePermission(verifiedSession, 'canResolveSafetyCases')).not.toThrow();
  });
});
