import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import crypto from 'node:crypto';
import { createSupabaseClient, type TypedSupabaseClient } from '@vent/db';
import { UserRole } from '@vent/domain';
import {
  getSupabaseAdmin,
  getSupabaseServerUrl,
  getSupabaseAnonKey,
} from '../src/lib/supabase-server';

/**
 * F01 database authority regression suite.
 *
 * These tests execute against the real local Postgres (no SQL-text assertions):
 * 1. Privileged SECURITY DEFINER RPCs must be non-executable by anon and
 *    authenticated callers (permission denied), while remaining executable by
 *    the service role used by the Next.js server.
 * 2. payout_batches must deny direct anonymous/authenticated access.
 * 3. Authenticated users must not insert forged lifecycle state on their own
 *    support_requests rows; a legitimate 'created' row must still be allowed.
 */

function expectExecutionDenied(
  error: { code?: string | null; message?: string } | null,
  label: string
) {
  // A locked-down function is denied in two shapes depending on PostgREST's
  // role-aware schema cache: PGRST202 (function hidden from the role) or 42501
  // (visible but execution refused). Both prove the caller cannot execute it.
  const code = error?.code ?? '';
  const message = error?.message ?? '';
  const denied =
    code === '42501' ||
    code === 'PGRST202' ||
    /permission denied/i.test(message) ||
    /could not find the function/i.test(message);
  if (!denied) {
    throw new Error(
      `${label}: expected execution denial (42501/PGRST202) but received ` +
        `code=${code || 'null'} message=${message || 'null (call may have succeeded)'}`
    );
  }
}

describe('F01 — Database authority lockdown (real DB execution)', () => {
  const admin = getSupabaseAdmin();
  const url = getSupabaseServerUrl();
  const anonKey = getSupabaseAnonKey();

  const anonClient: TypedSupabaseClient = createSupabaseClient({
    supabaseUrl: url,
    supabaseAnonKey: anonKey,
  });

  let userId: string;
  let authUserId: string;
  let userToken: string;
  let userClient: TypedSupabaseClient;
  const phone = `+919${Date.now().toString().slice(-6)}${Math.floor(100 + Math.random() * 900)}`;

  beforeAll(async () => {
    // Provision a regular authenticated user.
    const { data: existing } = await admin.auth.admin.listUsers();
    for (const u of existing?.users || []) {
      if (u.phone === phone) {
        await admin.from('users').delete().eq('auth_user_id', u.id);
        await admin.auth.admin.deleteUser(u.id);
      }
    }

    const { data: created, error: createErr } = await admin.auth.admin.createUser({
      phone,
      phone_confirm: true,
      password: 'Password123!',
      app_metadata: { role: UserRole.USER },
    });
    if (createErr || !created.user) {
      throw new Error(`Failed provisioning authority test user: ${createErr?.message}`);
    }
    authUserId = created.user.id;

    const { data: userRow, error: userErr } = await admin
      .from('users')
      .insert({
        auth_user_id: authUserId,
        handle: `AuthorityUser_${Date.now()}_${Math.floor(Math.random() * 10000)}`,
        age_verified_at: new Date().toISOString(),
        status: 'active',
      } as any)
      .select()
      .single();
    if (userErr || !userRow) {
      throw new Error(`Failed creating users row: ${userErr?.message}`);
    }
    userId = (userRow as any).id;

    const loginClient = createSupabaseClient({ supabaseUrl: url, supabaseAnonKey: anonKey });
    const { data: signIn, error: signInErr } = await loginClient.auth.signInWithPassword({
      phone,
      password: 'Password123!',
    });
    if (signInErr || !signIn.session) {
      throw new Error(`Failed login: ${signInErr?.message}`);
    }
    userToken = signIn.session.access_token;
    userClient = createSupabaseClient({
      supabaseUrl: url,
      supabaseAnonKey: anonKey,
      authToken: userToken,
    });
  });

  afterAll(async () => {
    await admin.from('users').delete().eq('id', userId);
    if (authUserId) {
      await admin.auth.admin.deleteUser(authUserId);
    }
  });

  describe('privileged RPCs are not executable by direct Data API callers', () => {
    const rpcCases: Array<{ name: string; fn: string; args: Record<string, unknown> }> = [
      {
        name: 'atomic_capture_payment_webhook',
        fn: 'atomic_capture_payment_webhook',
        args: {
          p_provider_order_id: 'order_synthetic_f01',
          p_provider_payment_id: 'pay_synthetic_f01',
          p_amount_paise: 50000,
          p_currency: 'INR',
          p_idempotency_key: `f01_probe_${Date.now()}`,
          p_idempotency_response: {},
        },
      },
      {
        name: 'atomic_request_refund',
        fn: 'atomic_request_refund',
        args: {
          p_payment_id: crypto.randomUUID(),
          p_refund_amount_paise: 100,
          p_reason: 'f01_probe',
          p_actor_id: userId,
          p_actor_role: 'user',
        },
      },
      {
        name: 'atomic_mark_refund_state',
        fn: 'atomic_mark_refund_state',
        args: {
          p_refund_id: crypto.randomUUID(),
          p_state: 'settled',
          p_actor_role: 'user',
        },
      },
      {
        name: 'atomic_execute_payout_batch',
        fn: 'atomic_execute_payout_batch',
        args: {
          p_batch_id: crypto.randomUUID(),
          p_executor_id: userId,
          p_executor_role: 'user',
        },
      },
      {
        name: 'atomic_reserve_match',
        fn: 'atomic_reserve_match',
        args: {
          p_request_id: crypto.randomUUID(),
          p_listener_id: crypto.randomUUID(),
          p_score: 0.5,
        },
      },
      {
        name: 'atomic_end_session',
        fn: 'atomic_end_session',
        args: {
          p_session_id: crypto.randomUUID(),
          p_caller_user_id: userId,
          p_end_reason: 'normal_completion',
        },
      },
      {
        name: 'atomic_create_safety_case',
        fn: 'atomic_create_safety_case',
        args: {
          p_session_id: crypto.randomUUID(),
          p_reporter_user_id: userId,
          p_severity: 'review',
          p_reason_codes: ['f01_probe'],
        },
      },
      {
        name: 'atomic_accept_session_recovery',
        fn: 'atomic_accept_session_recovery',
        args: {
          p_reservation_id: crypto.randomUUID(),
          p_listener_id: crypto.randomUUID(),
        },
      },
      {
        name: 'atomic_dpdp_user_erasure',
        fn: 'atomic_dpdp_user_erasure',
        args: {
          p_user_id: crypto.randomUUID(),
          p_actor_id: userId,
          p_actor_role: 'user',
        },
      },
    ];

    for (const tc of rpcCases) {
      it(`DENY rpc ${tc.name} for anon and authenticated callers`, async () => {
        // Cast matches the repository convention: generated RPC types do not
        // include these privileged functions for non-service-role callers.
        const anonResult = await (anonClient as any).rpc(tc.fn, tc.args);
        expectExecutionDenied(
          anonResult.error as { code?: string | null; message?: string } | null,
          `${tc.name} as anon`
        );

        const authResult = await (userClient as any).rpc(tc.fn, tc.args);
        expectExecutionDenied(
          authResult.error as { code?: string | null; message?: string } | null,
          `${tc.name} as authenticated`
        );
      });
    }

    it('ALLOW: service role retains EXECUTE on privileged RPCs (returns domain result, not permission error)', async () => {
      const result = await (admin as any).rpc('atomic_reserve_match', {
        p_request_id: crypto.randomUUID(),
        p_listener_id: crypto.randomUUID(),
        p_score: 0.5,
      });
      // A permission error would mean the lockdown broke the server path.
      // Domain-level failures (request/listener not found) are expected here and
      // prove execution reached the function body.
      const err = result.error as { code?: string | null; message?: string } | null;
      expect(err === null || !/permission denied/i.test(err.message ?? '')).toBe(true);
    });

    it('ALLOW: RLS helper functions remain executable by authenticated callers', async () => {
      const result = await userClient.rpc('current_user_id');
      expect(result.error).toBeNull();
      expect(result.data).toBe(userId);
    });
  });

  describe('payout_batches direct access is denied', () => {
    it('DENY: anon cannot select payout_batches', async () => {
      const { data, error } = await anonClient.from('payout_batches').select('*');
      expect(data === null || data.length === 0).toBe(true);
      expect(error).not.toBeNull();
    });

    it('DENY: authenticated user cannot select or insert payout_batches', async () => {
      const { data, error } = await userClient.from('payout_batches').select('*');
      expect(data === null || data.length === 0).toBe(true);
      expect(error).not.toBeNull();

      const { error: insertError } = await userClient.from('payout_batches').insert({
        period_start: new Date().toISOString(),
        period_end: new Date().toISOString(),
        total_paise: 100,
        status: 'pending_approval',
      } as any);
      expect(insertError).not.toBeNull();
    });
  });

  describe('support_requests forged lifecycle state is rejected', () => {
    it('DENY: user cannot insert own request already marked queued', async () => {
      const { error } = await userClient.from('support_requests').insert({
        user_id: userId,
        topic: 'work_stress',
        language: 'English',
        service_tier: 'listener',
        state: 'queued',
        idempotency_key: `f01_forged_queued_${Date.now()}`,
      } as any);
      expect(error).not.toBeNull();
      expect(error?.message).toMatch(/row-level security|violates/i);
    });

    it('DENY: user cannot insert own created request with a payment link attached', async () => {
      const { error } = await userClient.from('support_requests').insert({
        user_id: userId,
        topic: 'work_stress',
        language: 'English',
        service_tier: 'listener',
        state: 'created',
        payment_order_id: crypto.randomUUID(),
        idempotency_key: `f01_forged_pay_${Date.now()}`,
      } as any);
      expect(error).not.toBeNull();
      expect(error?.message).toMatch(/row-level security|violates/i);
    });

    it('ALLOW: user can still insert a legitimate fresh created request without payment link', async () => {
      const key = `f01_legit_${Date.now()}`;
      const { data, error } = await userClient.from('support_requests').insert({
        user_id: userId,
        topic: 'work_stress',
        language: 'English',
        service_tier: 'listener',
        state: 'created',
        idempotency_key: key,
      } as any)
        .select()
        .single();

      expect(error).toBeNull();
      expect((data as any)?.state).toBe('created');
      expect((data as any)?.id).toBeDefined();

      await admin.from('support_requests').delete().eq('id', (data as any).id);
    });
  });
});
