import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { NextRequest } from 'next/server';
import crypto from 'node:crypto';
import { POST as endSessionHandler } from '../src/app/api/sessions/[id]/end/route';
import { POST as ratingHandler } from '../src/app/api/sessions/[id]/rating/route';
import { POST as audioTokenHandler } from '../src/app/api/sessions/[id]/token/route';
import { POST as refundHandler } from '../src/app/api/finance/refunds/route';
import { POST as approvePayoutHandler } from '../src/app/api/finance/payouts/[id]/approve/route';
import { POST as executePayoutHandler } from '../src/app/api/finance/payouts/[id]/execute/route';
import { GET as reconcileHandler } from '../src/app/api/finance/reconcile/route';
import { POST as acknowledgeSafetyHandler } from '../src/app/api/safety-cases/[id]/acknowledge/route';
import { GET as metricsHandler } from '../src/app/api/analytics/metrics/route';
import { POST as webhookHandler } from '../src/app/api/payments/webhook/route';
import { UserRole } from '@vent/domain';
import { getSupabaseAdmin, getSupabaseServerClient } from '../src/lib/supabase-server';

describe('Package 12 — Adversarial Security, IDOR & Privilege Escalation Tests', () => {
  const admin = getSupabaseAdmin();

  let victimUserId: string;
  let victimJwt: string;
  let attackerUserId: string;
  let attackerJwt: string;
  let listenerUserId: string;
  let listenerProfileId: string;
  let victimSessionId: string;
  let victimActiveSessionId: string;
  let victimPaymentId: string;

  beforeAll(async () => {
    process.env.LIVEKIT_TEST_SIMULATOR = 'true';
    process.env.RAZORPAY_WEBHOOK_SECRET = 'test_webhook_secret_key_12345';

    // 1. Create Victim User
    const phoneV = `91${Math.floor(1000000000 + Math.random() * 9000000000)}`;
    const { data: authV } = await admin.auth.admin.createUser({
      phone: phoneV,
      phone_confirm: true,
      password: 'Password123!',
      app_metadata: { role: UserRole.USER },
    });
    const { data: uV } = await admin.from('users').insert({
      auth_user_id: authV.user!.id,
      handle: `VictimUser_${Date.now()}_${Math.floor(Math.random() * 10000)}`,
      age_verified_at: new Date().toISOString(),
      status: 'active',
    } as any).select().single();
    victimUserId = (uV as any).id;

    const clientV = getSupabaseServerClient();
    const { data: sV } = await clientV.auth.signInWithPassword({ phone: phoneV, password: 'Password123!' });
    victimJwt = sV.session!.access_token;

    // 2. Create Attacker User (Regular authenticated user)
    const phoneA = `91${Math.floor(1000000000 + Math.random() * 9000000000)}`;
    const { data: authA } = await admin.auth.admin.createUser({
      phone: phoneA,
      phone_confirm: true,
      password: 'Password123!',
      app_metadata: { role: UserRole.USER },
    });
    const { data: uA } = await admin.from('users').insert({
      auth_user_id: authA.user!.id,
      handle: `AttackerUser_${Date.now()}_${Math.floor(Math.random() * 10000)}`,
      age_verified_at: new Date().toISOString(),
      status: 'active',
    } as any).select().single();
    attackerUserId = (uA as any).id;

    const clientA = getSupabaseServerClient();
    const { data: sA } = await clientA.auth.signInWithPassword({ phone: phoneA, password: 'Password123!' });
    attackerJwt = sA.session!.access_token;

    // 3. Create Listener
    const phoneL = `91${Math.floor(1000000000 + Math.random() * 9000000000)}`;
    const { data: authL } = await admin.auth.admin.createUser({
      phone: phoneL,
      phone_confirm: true,
      password: 'Password123!',
      app_metadata: { role: UserRole.LISTENER },
    });
    const { data: uL } = await admin.from('users').insert({
      auth_user_id: authL.user!.id,
      handle: `AdvListener_${Date.now()}_${Math.floor(Math.random() * 10000)}`,
      age_verified_at: new Date().toISOString(),
      status: 'active',
    } as any).select().single();
    listenerUserId = (uL as any).id;

    const { data: lp } = await admin.from('listener_profiles').insert({
      user_id: listenerUserId,
      display_name: 'Adv Listener',
      status: 'active',
      tier: 'listener',
      languages: ['English'],
      topics: ['work_stress'],
      quality_prior: 4.5,
    } as any).select().single();
    listenerProfileId = (lp as any).id;

    // 4. Create Victim's Payment & Ended Session
    const { data: pay } = await admin.from('payments').insert({
      user_id: victimUserId,
      provider: 'razorpay',
      provider_order_id: `ord_vic_${Date.now()}`,
      provider_payment_id: `pay_vic_${Date.now()}`,
      amount_paise: 19900,
      currency: 'INR',
      state: 'captured',
    } as any).select().single();
    victimPaymentId = (pay as any).id;

    const { data: req } = await admin.from('support_requests').insert({
      user_id: victimUserId,
      topic: 'work_stress',
      language: 'English',
      service_tier: 'listener',
      state: 'completed',
      idempotency_key: `adv_req_${Date.now()}`,
    } as any).select().single();

    const { data: sess } = await admin.from('sessions').insert({
      request_id: (req as any).id,
      user_id: victimUserId,
      listener_id: listenerProfileId,
      room_name: `room_adv_${Date.now()}`,
      state: 'ended',
      started_at: new Date(Date.now() - 300000).toISOString(),
      ended_at: new Date().toISOString(),
      duration_seconds: 300,
    } as any).select().single();
    victimSessionId = (sess as any).id;

    // 5. Create Victim's Active Session for token eavesdropping test
    const { data: reqAct } = await admin.from('support_requests').insert({
      user_id: victimUserId,
      topic: 'work_stress',
      language: 'English',
      service_tier: 'listener',
      state: 'reserved',
      idempotency_key: `adv_req_act_${Date.now()}`,
    } as any).select().single();

    const { data: sessAct } = await admin.from('sessions').insert({
      request_id: (reqAct as any).id,
      user_id: victimUserId,
      listener_id: listenerProfileId,
      room_name: `room_adv_act_${Date.now()}`,
      state: 'active',
      started_at: new Date().toISOString(),
    } as any).select().single();
    victimActiveSessionId = (sessAct as any).id;
  });

  afterAll(async () => {
    await admin.from('users').delete().in('id', [victimUserId, attackerUserId, listenerUserId]);
  });

  it('ADVERSARIAL IDOR: Attacker cannot eavesdrop on victim by obtaining victim session audio token', async () => {
    const req = new NextRequest(`http://localhost:3000/api/sessions/${victimActiveSessionId}/token`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${attackerJwt}`,
      },
    });

    const res = await audioTokenHandler(req, { params: Promise.resolve({ id: victimActiveSessionId }) });
    expect(res.status).toBe(403);
    const data = await res.json();
    expect(data.error).toMatch(/Caller is not a participant/i);
  });

  it('ADVERSARIAL IDOR: Attacker cannot submit ratings on victim’s completed session', async () => {
    const req = new NextRequest(`http://localhost:3000/api/sessions/${victimSessionId}/rating`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${attackerJwt}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        stars: 5,
      }),
    });

    const res = await ratingHandler(req, { params: Promise.resolve({ id: victimSessionId }) });
    expect(res.status).toBe(403);
    const data = await res.json();
    expect(data.error).toMatch(/Only the user who participated in this session can submit a rating/i);
  });

  it('ADVERSARIAL IDOR: Attacker cannot trigger refund on victim’s payment', async () => {
    const req = new NextRequest('http://localhost:3000/api/finance/refunds', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${attackerJwt}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        paymentId: victimPaymentId,
        failureReason: 'no_connection',
        durationSeconds: 0,
      }),
    });

    const res = await refundHandler(req);
    expect(res.status).toBe(403);
    const data = await res.json();
    expect(data.error).toMatch(/Unauthorized to refund this payment/i);
  });

  it('ADVERSARIAL PRIVILEGE ESCALATION: Regular user cannot approve or execute payout batches', async () => {
    const fakeBatchId = crypto.randomUUID();

    // 1. Attempt Approve
    const appReq = new NextRequest(`http://localhost:3000/api/finance/payouts/${fakeBatchId}/approve`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${attackerJwt}`,
      },
    });

    const appRes = await approvePayoutHandler(appReq, { params: Promise.resolve({ id: fakeBatchId }) });
    expect(appRes.status).toBe(403);

    // 2. Attempt Execute
    const execReq = new NextRequest(`http://localhost:3000/api/finance/payouts/${fakeBatchId}/execute`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${attackerJwt}`,
      },
    });

    const execRes = await executePayoutHandler(execReq, { params: Promise.resolve({ id: fakeBatchId }) });
    expect(execRes.status).toBe(403);
  });

  it('ADVERSARIAL PRIVILEGE ESCALATION: Regular user cannot acknowledge safety cases or view analytics metrics', async () => {
    const fakeCaseId = crypto.randomUUID();

    // 1. Attempt Safety Ack
    const ackReq = new NextRequest(`http://localhost:3000/api/safety-cases/${fakeCaseId}/acknowledge`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${attackerJwt}`,
      },
    });

    const ackRes = await acknowledgeSafetyHandler(ackReq, { params: Promise.resolve({ id: fakeCaseId }) });
    expect(ackRes.status).toBe(403);

    // 2. Attempt Analytics Query
    const metReq = new NextRequest('http://localhost:3000/api/analytics/metrics', {
      method: 'GET',
      headers: {
        authorization: `Bearer ${attackerJwt}`,
      },
    });

    const metRes = await metricsHandler(metReq);
    expect(metRes.status).toBe(403);
  });

  it('ADVERSARIAL WEBHOOK: Tampered webhook signature is rejected with 400', async () => {
    const rawBody = JSON.stringify({
      event: 'payment.captured',
      payload: { payment: { entity: { id: 'pay_attacker', amount: 19900 } } },
    });

    const req = new NextRequest('http://localhost:3000/api/payments/webhook', {
      method: 'POST',
      headers: {
        'x-razorpay-signature': 'forged_invalid_hex_signature_deadbeef',
        'content-type': 'application/json',
      },
      body: rawBody,
    });

    const res = await webhookHandler(req);
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.message).toMatch(/Invalid webhook signature/i);
  });
});
