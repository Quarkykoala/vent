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

  // Per-run phone numbers: the previous fixed numbers collided with fixtures
  // left behind by other suites (and by interrupted runs), which made
  // createUser return { user: null } and threw inside beforeAll. Isolation
  // fixes the suite without weakening any assertion.
  const runSuffix = () => `${Math.floor(100000000 + Math.random() * 899999999)}`;
  const phoneA = `+919${runSuffix()}`;
  const phoneB = `+919${runSuffix()}`;
  const phoneSupervisor = `+919${runSuffix()}`;
  const testPhones = [phoneA, phoneB, phoneSupervisor];

  /**
   * Removes every auth user holding one of this run's phone numbers, paging
   * through the admin list so a large shared local database cannot hide a
   * stale fixture on page 2+.
   */
  async function purgeUsersByPhone(admin: ReturnType<typeof getSupabaseAdmin>) {
    const ids: string[] = [];
    for (let page = 1; page <= 20; page += 1) {
      const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
      if (error) throw new Error(`listUsers failed: ${error.message}`);
      const users = data?.users ?? [];
      for (const u of users) {
        if (u.phone && testPhones.includes(u.phone)) ids.push(u.id);
      }
      if (users.length < 200) break;
    }
    for (const id of ids) {
      const { error: profileErr } = await admin.from('users').delete().eq('auth_user_id', id);
      if (profileErr) {
        throw new Error(`Failed to delete public.users row for stale auth user ${id}: ${profileErr.message}`);
      }
      const { error: authErr } = await admin.auth.admin.deleteUser(id);
      if (authErr) {
        throw new Error(`Failed to delete stale auth user ${id}: ${authErr.message}`);
      }
    }
  }

  beforeAll(async () => {
    const admin = getSupabaseAdmin();

    await purgeUsersByPhone(admin);

    // 1. Create User A
    const { data: userAData, error: userAErr } = await admin.auth.admin.createUser({
      phone: phoneA,
      phone_confirm: true,
      password: 'StrongTestPassword123!',
      user_metadata: { role: 'admin' }, // malicious client attempt to claim admin
      app_metadata: { role: UserRole.USER }, // authoritative
    });
    if (userAErr || !userAData.user) {
      throw new Error(`createUser(userA) failed: ${userAErr?.message ?? 'no user returned'}`);
    }
    userAAuthId = userAData.user.id;
    const clientA = getSupabaseServerClient();
    const { data: signInA, error: signInAErr } = await clientA.auth.signInWithPassword({
      phone: phoneA,
      password: 'StrongTestPassword123!',
    });
    if (signInAErr || !signInA.session) {
      throw new Error(`signIn(userA) failed: ${signInAErr?.message ?? 'no session returned'}`);
    }
    userAJwt = signInA.session.access_token;

    // 2. Create User B
    const { data: userBData, error: userBErr } = await admin.auth.admin.createUser({
      phone: phoneB,
      phone_confirm: true,
      password: 'StrongTestPassword123!',
      app_metadata: { role: UserRole.USER },
    });
    if (userBErr || !userBData.user) {
      throw new Error(`createUser(userB) failed: ${userBErr?.message ?? 'no user returned'}`);
    }
    userBAuthId = userBData.user.id;
    const clientB = getSupabaseServerClient();
    const { data: signInB, error: signInBErr } = await clientB.auth.signInWithPassword({
      phone: phoneB,
      password: 'StrongTestPassword123!',
    });
    if (signInBErr || !signInB.session) {
      throw new Error(`signIn(userB) failed: ${signInBErr?.message ?? 'no session returned'}`);
    }
    userBJwt = signInB.session.access_token;

    // 3. Create Clinical Supervisor (Staff role requiring MFA)
    const { data: supervisorData, error: supervisorErr } = await admin.auth.admin.createUser({
      phone: phoneSupervisor,
      phone_confirm: true,
      password: 'StrongTestPassword123!',
      app_metadata: { role: UserRole.CLINICAL_SUPERVISOR },
    });
    if (supervisorErr || !supervisorData.user) {
      throw new Error(`createUser(supervisor) failed: ${supervisorErr?.message ?? 'no user returned'}`);
    }
    supervisorAuthId = supervisorData.user.id;
    const clientSup = getSupabaseServerClient();
    const { data: signInSup, error: signInSupErr } = await clientSup.auth.signInWithPassword({
      phone: phoneSupervisor,
      password: 'StrongTestPassword123!',
    });
    if (signInSupErr || !signInSup.session) {
      throw new Error(`signIn(supervisor) failed: ${signInSupErr?.message ?? 'no session returned'}`);
    }
    supervisorJwt = signInSup.session.access_token;
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
