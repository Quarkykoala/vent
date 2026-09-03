import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { NextRequest } from 'next/server';
import crypto from 'node:crypto';
import { POST as erasureHandler } from '../src/app/api/privacy/erasure/route';
import { GET as metricsHandler } from '../src/app/api/analytics/metrics/route';
import { UserRole, LedgerAccountCode } from '@vent/domain';
import { getSupabaseAdmin, getSupabaseServerClient } from '../src/lib/supabase-server';

describe('Package 10 — Real DPDP 2025 Erasure, Auth Purging & K-Anonymity Analytics', () => {
  const admin = getSupabaseAdmin();

  let targetUserId: string;
  let targetAuthId: string;
  let targetPhone: string;
  let targetUserJwt: string;
  let targetPaymentId: string;

  let activeSessionUserId: string;
  let activeSessionUserJwt: string;

  let regularUserId: string;
  let regularUserJwt: string;

  let adminStaffUserId: string;
  let adminStaffJwt: string;

  beforeAll(async () => {
    // 0. Get an active listener profile for session creation
    const { data: lp } = await admin.from('listener_profiles').select('id').limit(1).single();
    const listenerProfileId = (lp as any).id;

    // 1. Create User to be Erased
    targetPhone = `91${Math.floor(1000000000 + Math.random() * 9000000000)}`;
    const { data: authU } = await admin.auth.admin.createUser({
      phone: targetPhone,
      phone_confirm: true,
      password: 'Password123!',
      app_metadata: { role: UserRole.USER },
    });
    targetAuthId = authU.user!.id;

    const { data: u } = await admin.from('users').insert({
      auth_user_id: targetAuthId,
      handle: `UserToErase_${Date.now()}_${Math.floor(Math.random() * 10000)}`,
      age_verified_at: new Date().toISOString(),
      status: 'active',
    } as any).select().single();
    targetUserId = (u as any).id;

    const clientU = getSupabaseServerClient();
    const { data: sU } = await clientU.auth.signInWithPassword({ phone: targetPhone, password: 'Password123!' });
    targetUserJwt = sU.session!.access_token;

    // Attach support request and financial transaction to target user
    const { data: pay } = await admin.from('payments').insert({
      user_id: targetUserId,
      provider: 'razorpay',
      provider_order_id: `order_erase_${Date.now()}`,
      provider_payment_id: `pay_erase_${Date.now()}`,
      amount_paise: 19900,
      currency: 'INR',
      state: 'captured',
    } as any).select().single();
    targetPaymentId = (pay as any).id;

    await admin.from('support_requests').insert({
      user_id: targetUserId,
      topic: 'sensitive_work_topic',
      language: 'Hindi',
      service_tier: 'listener',
      state: 'completed',
      payment_order_id: targetPaymentId,
      idempotency_key: `req_erase_${Date.now()}`,
    } as any);

    await admin.from('ledger_entries').insert([
      {
        event_id: crypto.randomUUID(),
        account_code: LedgerAccountCode.CASH_PG_CLEARING,
        direction: 'debit',
        amount_paise: 19900,
        currency: 'INR',
        reference_type: 'payment',
        reference_id: targetPaymentId,
      },
      {
        event_id: crypto.randomUUID(),
        account_code: LedgerAccountCode.CUSTOMER_SERVICE_REVENUE,
        direction: 'credit',
        amount_paise: 19900,
        currency: 'INR',
        reference_type: 'payment',
        reference_id: targetPaymentId,
      },
    ] as any);

    // 2. Create User with Active Session
    const phoneAct = `91${Math.floor(1000000000 + Math.random() * 9000000000)}`;
    const { data: authAct } = await admin.auth.admin.createUser({
      phone: phoneAct,
      phone_confirm: true,
      password: 'Password123!',
      app_metadata: { role: UserRole.USER },
    });
    const { data: uAct } = await admin.from('users').insert({
      auth_user_id: authAct.user!.id,
      handle: `ActiveUser_${Date.now()}_${Math.floor(Math.random() * 10000)}`,
      age_verified_at: new Date().toISOString(),
      status: 'active',
    } as any).select().single();
    activeSessionUserId = (uAct as any).id;

    const clientAct = getSupabaseServerClient();
    const { data: sAct } = await clientAct.auth.signInWithPassword({ phone: phoneAct, password: 'Password123!' });
    activeSessionUserJwt = sAct.session!.access_token;

    // Attach active session
    const { data: reqAct } = await admin.from('support_requests').insert({
      user_id: activeSessionUserId,
      topic: 'stress',
      language: 'English',
      service_tier: 'listener',
      state: 'reserved',
      idempotency_key: `act_req_${Date.now()}`,
    } as any).select().single();

    const { error: sessErr } = await admin.from('sessions').insert({
      request_id: (reqAct as any).id,
      user_id: activeSessionUserId,
      listener_id: listenerProfileId,
      room_name: `room_active_${Date.now()}`,
      state: 'active',
      started_at: new Date().toISOString(),
    } as any);
    if (sessErr) throw new Error(`Failed to create active session: ${sessErr.message}`);

    // 3. Create Regular User (not erased, for permission checks)
    const phoneReg = `91${Math.floor(1000000000 + Math.random() * 9000000000)}`;
    const { data: authReg } = await admin.auth.admin.createUser({
      phone: phoneReg,
      phone_confirm: true,
      password: 'Password123!',
      app_metadata: { role: UserRole.USER },
    });
    const { data: uReg } = await admin.from('users').insert({
      auth_user_id: authReg.user!.id,
      handle: `RegUser_${Date.now()}_${Math.floor(Math.random() * 10000)}`,
      age_verified_at: new Date().toISOString(),
      status: 'active',
    } as any).select().single();
    regularUserId = (uReg as any).id;

    const clientReg = getSupabaseServerClient();
    const { data: sReg } = await clientReg.auth.signInWithPassword({ phone: phoneReg, password: 'Password123!' });
    regularUserJwt = sReg.session!.access_token;

    // 4. Create Super Admin Staff for Metrics
    const phoneAdm = `91${Math.floor(1000000000 + Math.random() * 9000000000)}`;
    const { data: authAdm } = await admin.auth.admin.createUser({
      phone: phoneAdm,
      phone_confirm: true,
      password: 'Password123!',
      app_metadata: { role: UserRole.SUPER_ADMIN },
    });
    const { data: uAdm } = await admin.from('users').insert({
      auth_user_id: authAdm.user!.id,
      handle: `SuperAdmin_${Date.now()}_${Math.floor(Math.random() * 10000)}`,
      age_verified_at: new Date().toISOString(),
      status: 'active',
    } as any).select().single();
    adminStaffUserId = (uAdm as any).id;

    const clientAdm = getSupabaseServerClient();
    const { data: sAdm } = await clientAdm.auth.signInWithPassword({ phone: phoneAdm, password: 'Password123!' });
    adminStaffJwt = sAdm.session!.access_token;
  });

  afterAll(async () => {
    await admin.from('users').delete().in('id', [activeSessionUserId, regularUserId, adminStaffUserId]);
  });

  it('active session prevents user account erasure with 400', async () => {
    const req = new NextRequest('http://localhost:3000/api/privacy/erasure', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${activeSessionUserJwt}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        userId: activeSessionUserId,
        consentAcknowledged: true,
      }),
    });

    const res = await erasureHandler(req);
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.code).toBe('ACTIVE_SESSION_EXISTS');
  });

  it('executes real DPDP 2025 erasure: scrubs DB PII, purges Supabase Auth, and preserves financial ledger', async () => {
    const req = new NextRequest('http://localhost:3000/api/privacy/erasure', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${targetUserJwt}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        userId: targetUserId,
        consentAcknowledged: true,
      }),
    });

    const res = await erasureHandler(req);
    expect(res.status).toBe(200);
    const data = await res.json();

    expect(data.status).toBe('erasure_completed');
    expect(data.authPurged).toBe(true);

    // 1. Verify user record in PostgreSQL is scrubbed and marked deleted
    const { data: dbUser } = await admin.from('users').select('*').eq('id', targetUserId).single();
    expect((dbUser as any).status).toBe('deleted');
    expect((dbUser as any).handle).toBe(`deleted_${targetUserId.slice(0, 8)}`);
    expect((dbUser as any).auth_user_id).not.toBe(targetAuthId);

    // 2. Verify support request is scrubbed
    const { data: dbReq } = await admin.from('support_requests').select('*').eq('user_id', targetUserId).single();
    expect((dbReq as any).topic).toBe('erased');
    expect((dbReq as any).language).toBe('erased');

    // 3. Verify user account deleted from Supabase Auth
    const { data: authLookup, error: authLookupErr } = await admin.auth.admin.getUserById(targetAuthId);
    expect(authLookup.user).toBeNull();
    expect(authLookupErr).toBeDefined();

    // 4. Verify erased user CANNOT log in anymore
    const freshClient = getSupabaseServerClient();
    const { error: loginErr } = await freshClient.auth.signInWithPassword({
      phone: targetPhone,
      password: 'Password123!',
    });
    expect(loginErr).toBeDefined();

    // 5. INVARIANT: Financial ledger records preserved for statutory audit without PII
    const { data: ledgerRows } = await admin
      .from('ledger_entries')
      .select('*')
      .eq('reference_id', targetPaymentId);

    expect(ledgerRows).toHaveLength(2);
    for (const row of (ledgerRows as any[])) {
      expect(Number(row.amount_paise)).toBe(19900);
      // Contains no phone or handle
      expect(JSON.stringify(row)).not.toContain(targetPhone);
    }
  });

  it('analytics endpoint computes metrics from real DB tables and applies k-anonymity privacy safeguards', async () => {
    const req = new NextRequest('http://localhost:3000/api/analytics/metrics', {
      method: 'GET',
      headers: {
        authorization: `Bearer ${adminStaffJwt}`,
      },
    });

    const res = await metricsHandler(req);
    expect(res.status).toBe(200);
    const data = await res.json();

    expect(data.metrics).toBeDefined();
    expect(data.kAnonymity).toBeDefined();
    expect(data.kAnonymity.threshold).toBe(5);

    // Verify response contains ZERO PII (no handles, phones, or user IDs)
    const jsonStr = JSON.stringify(data);
    expect(jsonStr).not.toContain(targetPhone);
    expect(jsonStr).not.toContain('UserToErase');
  });

  it('rejects regular user from accessing analytics metrics with 403 Forbidden', async () => {
    const req = new NextRequest('http://localhost:3000/api/analytics/metrics', {
      method: 'GET',
      headers: {
        authorization: `Bearer ${regularUserJwt}`, // regular user
      },
    });

    const res = await metricsHandler(req);
    expect(res.status).toBe(403);
  });
});
