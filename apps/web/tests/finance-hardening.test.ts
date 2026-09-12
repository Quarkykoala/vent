import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { NextRequest } from 'next/server';
import crypto from 'node:crypto';
import { GET as reconcileHandler } from '../src/app/api/finance/reconcile/route';
import { POST as refundHandler } from '../src/app/api/finance/refunds/route';
import { POST as createProposalHandler } from '../src/app/api/finance/payouts/proposal/route';
import { POST as approvePayoutHandler } from '../src/app/api/finance/payouts/[id]/approve/route';
import { POST as executePayoutHandler } from '../src/app/api/finance/payouts/[id]/execute/route';
import { UserRole, LedgerAccountCode, DEFAULT_PRICING } from '@vent/domain';
import { getSupabaseAdmin, getSupabaseServerClient } from '../src/lib/supabase-server';

describe('Package 8 — Real Finance, Refunds & Human-Gated Payouts', () => {
  const admin = getSupabaseAdmin();

  let testUserId: string;
  let testUserJwt: string;
  let testFinanceUserId: string;
  let testFinanceJwt: string;
  let testPaymentId: string;
  const initialPaise = 50000n; // ₹500
  let listenerAuthUserId: string;
  let listenerUserId: string;
  let listenerProfileId: string;
  let payoutRequestId: string;

  beforeAll(async () => {
    // 1. Create Regular User
    const phoneU = `91${Math.floor(1000000000 + Math.random() * 9000000000)}`;
    const { data: authU } = await admin.auth.admin.createUser({
      phone: phoneU,
      phone_confirm: true,
      password: 'Password123!',
      app_metadata: { role: UserRole.USER },
    });
    const { data: u } = await admin.from('users').insert({
      auth_user_id: authU.user!.id,
      handle: `FinanceUser_${Date.now()}_${Math.floor(Math.random() * 10000)}`,
      age_verified_at: new Date().toISOString(),
      status: 'active',
    } as any).select().single();
    testUserId = (u as any).id;

    const clientU = getSupabaseServerClient();
    const { data: sU } = await clientU.auth.signInWithPassword({ phone: phoneU, password: 'Password123!' });
    testUserJwt = sU.session!.access_token;

    // 2. Create Finance Lead
    const phoneF = `91${Math.floor(1000000000 + Math.random() * 9000000000)}`;
    const { data: authF } = await admin.auth.admin.createUser({
      phone: phoneF,
      phone_confirm: true,
      password: 'Password123!',
      app_metadata: { role: UserRole.FINANCE },
    });
    const { data: uF } = await admin.from('users').insert({
      auth_user_id: authF.user!.id,
      handle: `FinanceLead_${Date.now()}_${Math.floor(Math.random() * 10000)}`,
      age_verified_at: new Date().toISOString(),
      status: 'active',
    } as any).select().single();
    testFinanceUserId = (uF as any).id;

    const clientF = getSupabaseServerClient();
    const { data: sF } = await clientF.auth.signInWithPassword({ phone: phoneF, password: 'Password123!' });
    testFinanceJwt = sF.session!.access_token;

    // 3. Create captured payment with balanced initial ledger entries
    const { data: pay } = await admin.from('payments').insert({
      user_id: testUserId,
      provider: 'razorpay',
      provider_order_id: `order_fin_${Date.now()}`,
      provider_payment_id: `pay_fin_${Date.now()}`,
      amount_paise: Number(initialPaise),
      currency: 'INR',
      state: 'captured',
      captured_at: new Date().toISOString(),
    } as any).select().single();
    testPaymentId = (pay as any).id;

    const eventId = crypto.randomUUID();
    await admin.from('ledger_entries').insert([
      {
        event_id: eventId,
        account_code: LedgerAccountCode.CASH_PG_CLEARING,
        direction: 'debit',
        amount_paise: Number(initialPaise),
        currency: 'INR',
        reference_type: 'payment',
        reference_id: testPaymentId,
      },
      {
        event_id: eventId,
        account_code: LedgerAccountCode.CUSTOMER_SERVICE_REVENUE,
        direction: 'credit',
        amount_paise: Number(initialPaise),
        currency: 'INR',
        reference_type: 'payment',
        reference_id: testPaymentId,
      },
    ] as any);

    // 4. Listener fixture with one completed session, so payout totals are
    //    computed from real rows instead of a caller-supplied number.
    const phoneL = `91${Math.floor(1000000000 + Math.random() * 9000000000)}`;
    const { data: authL } = await admin.auth.admin.createUser({
      phone: phoneL,
      phone_confirm: true,
      password: 'Password123!',
      app_metadata: { role: UserRole.LISTENER },
    });
    listenerAuthUserId = authL.user!.id;
    const { data: uL } = await admin.from('users').insert({
      auth_user_id: listenerAuthUserId,
      handle: `FinanceListener_${Date.now()}_${Math.floor(Math.random() * 10000)}`,
      age_verified_at: new Date().toISOString(),
      status: 'active',
    } as any).select().single();
    listenerUserId = (uL as any).id;

    const { data: profile } = await admin.from('listener_profiles').insert({
      user_id: listenerUserId,
      display_name: `Finance Listener ${Date.now()}`,
      status: 'active',
      tier: 'listener',
      languages: ['English'],
      topics: ['Work & Career Stress'],
      verified_at: new Date().toISOString(),
      training_expires_at: new Date(Date.now() + 7 * 86400000).toISOString(),
    } as any).select().single();
    listenerProfileId = (profile as any).id;

    const { data: completedReq } = await admin.from('support_requests').insert({
      user_id: testUserId,
      topic: 'Work & Career Stress',
      language: 'English',
      service_tier: 'listener',
      state: 'completed',
      idempotency_key: `fin_payout_req_${Date.now()}`,
    } as any).select().single();
    payoutRequestId = (completedReq as any).id;

    await admin.from('sessions').insert({
      request_id: payoutRequestId,
      user_id: testUserId,
      listener_id: listenerProfileId,
      room_name: `room_fin_${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`,
      state: 'ended',
      started_at: new Date(Date.now() - 3600_000).toISOString(),
      ended_at: new Date().toISOString(),
      duration_seconds: 900,
      end_reason: 'normal_completion',
    } as any);
  });

  afterAll(async () => {
    // Remove the payout fixture first: sessions/listener rows cascade from the
    // listener profile and the user.
    if (listenerProfileId) {
      await admin.from('sessions').delete().eq('listener_id', listenerProfileId);
      await admin.from('listener_presence').delete().eq('listener_id', listenerProfileId);
      await admin.from('listener_profiles').delete().eq('id', listenerProfileId);
    }
    if (payoutRequestId) {
      await admin.from('support_requests').delete().eq('id', payoutRequestId);
    }
    if (listenerUserId) {
      await admin.from('audit_events').delete().eq('actor_id', listenerUserId);
      await admin.from('users').delete().eq('id', listenerUserId);
    }
    if (listenerAuthUserId) {
      await admin.auth.admin.deleteUser(listenerAuthUserId);
    }
    await admin.from('users').delete().in('id', [testUserId, testFinanceUserId]);
  });

  it('finance summary reflects real ledger entries in PostgreSQL and enforces trial balance invariant', async () => {
    const req = new NextRequest('http://localhost:3000/api/finance/reconcile', {
      method: 'GET',
      headers: {
        authorization: `Bearer ${testFinanceJwt}`,
      },
    });

    const res = await reconcileHandler(req);
    expect(res.status).toBe(200);
    const data = await res.json();

    expect(data.isBalanced).toBe(true);
    expect(data.totalDebitsPaise).toBe(data.totalCreditsPaise);
    expect(data.entriesCount).toBeGreaterThanOrEqual(2);
    expect(data.accountBalances.cash_pg_clearing).toBeDefined();
    expect(data.accountBalances.customer_service_revenue).toBeDefined();
  });

  it('rejects unprivileged user from accessing finance reconciliation with 403 Forbidden', async () => {
    const req = new NextRequest('http://localhost:3000/api/finance/reconcile', {
      method: 'GET',
      headers: {
        authorization: `Bearer ${testUserJwt}`, // regular user
      },
    });

    const res = await reconcileHandler(req);
    expect(res.status).toBe(403);
  });

  it('refund is recorded as pending provider with no ledger effect until it settles', async () => {
    const req = new NextRequest('http://localhost:3000/api/finance/refunds', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${testUserJwt}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        paymentId: testPaymentId,
        failureReason: 'no_connection',
        durationSeconds: 0,
      }),
    });

    const res = await refundHandler(req);
    expect(res.status).toBe(200);
    const data = await res.json();

    // No provider credentials exist in this environment, so the honest outcome
    // is "pending", not "refunded".
    expect(data.providerOutcome).toBe('not_configured');
    expect(data.state).toBe('pending_provider');
    expect(data.ledgerPosted).toBe(false);
    expect(data.refundAmountPaise).toBe(Number(initialPaise));

    // 1. The payment is pending, not refunded: no money has moved yet.
    const { data: dbPay } = await admin.from('payments').select('state').eq('id', testPaymentId).single();
    expect((dbPay as any).state).toBe('refund_pending');

    // 2. No compensating ledger entries may exist before settlement.
    const { data: earlyEntries } = await admin
      .from('ledger_entries')
      .select('*')
      .eq('reference_id', testPaymentId)
      .eq('reference_type', 'refund');
    expect(earlyEntries).toHaveLength(0);

    // 3. The request is audited.
    const { data: requestedAudit } = await admin
      .from('audit_events')
      .select('*')
      .eq('entity_id', testPaymentId)
      .eq('action', 'payment_refund_requested');
    expect(requestedAudit).toHaveLength(1);
  });

  it('settling the refund posts the compensating journal and marks the payment refunded', async () => {
    const { data: refundRow } = await admin
      .from('refunds')
      .select('*')
      .eq('payment_id', testPaymentId)
      .eq('state', 'pending_provider')
      .single();

    const { data: markResult, error: markErr } = await (admin as any).rpc('atomic_mark_refund_state', {
      p_refund_id: (refundRow as any).id,
      p_state: 'settled',
      p_provider_refund_id: 'rfnd_test_local',
      p_detail: 'settled by finance against the provider dashboard',
      p_actor_role: 'finance',
    });
    expect(markErr).toBeNull();
    expect(markResult.state).toBe('settled');
    expect(markResult.payment_state).toBe('refunded');

    const { data: dbPay } = await admin.from('payments').select('state').eq('id', testPaymentId).single();
    expect((dbPay as any).state).toBe('refunded');

    const { data: refundEntries } = await admin
      .from('ledger_entries')
      .select('*')
      .eq('reference_id', testPaymentId)
      .eq('reference_type', 'refund');
    expect(refundEntries).toHaveLength(2);
    const dr = (refundEntries as any).find((e: any) => e.direction === 'debit');
    const cr = (refundEntries as any).find((e: any) => e.direction === 'credit');
    expect(dr.account_code).toBe(LedgerAccountCode.CUSTOMER_SERVICE_REVENUE);
    expect(cr.account_code).toBe(LedgerAccountCode.CASH_PG_CLEARING);
    expect(BigInt(dr.amount_paise)).toBe(initialPaise);
    expect(BigInt(cr.amount_paise)).toBe(initialPaise);

    const { data: settledAudit } = await admin
      .from('audit_events')
      .select('*')
      .eq('entity_id', testPaymentId)
      .eq('action', 'payment_refunded');
    expect(settledAudit).toHaveLength(1);

    // Idempotent: a replayed settlement must not double-journal.
    const { data: replay } = await (admin as any).rpc('atomic_mark_refund_state', {
      p_refund_id: (refundRow as any).id,
      p_state: 'settled',
      p_provider_refund_id: 'rfnd_test_local',
      p_actor_role: 'finance',
    });
    expect(replay.idempotent_replay).toBe(true);
    const { data: afterReplay } = await admin
      .from('ledger_entries')
      .select('*')
      .eq('reference_id', testPaymentId)
      .eq('reference_type', 'refund');
    expect(afterReplay).toHaveLength(2);
  });

  it('duplicate refund on an already refunded payment is rejected with 409 Conflict', async () => {
    const req = new NextRequest('http://localhost:3000/api/finance/refunds', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${testUserJwt}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        paymentId: testPaymentId,
        failureReason: 'no_connection',
        durationSeconds: 0,
      }),
    });

    const res = await refundHandler(req);
    expect(res.status).toBe(409);
    const data = await res.json();
    expect(data.error).toMatch(/already been refunded|already in flight/i);
  });

  it('STRICT INVARIANT: Payout execution strictly requires human finance approval', async () => {
    // 1. Create payout proposal batch. The total is COMPUTED server-side from
    //    completed sessions — the caller may not supply an amount.
    const propReq = new NextRequest('http://localhost:3000/api/finance/payouts/proposal', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${testFinanceJwt}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({}),
    });

    const propRes = await createProposalHandler(propReq);
    expect(propRes.status).toBe(201);
    const propData = await propRes.json();
    // The total is derived from the completed sessions in the period at the
    // published per-session listener earnings — never from the request body.
    expect(propData.totalPaise).toBe(
      Number(DEFAULT_PRICING.listenerEarningsPaise) * propData.eligibleSessionsCount
    );
    expect(propData.eligibleSessionsCount).toBeGreaterThanOrEqual(1);
    expect(propData.listenerCount).toBeGreaterThanOrEqual(1);
    const batchId = propData.batchId;
    expect(propData.status).toBe('pending_approval');

    // 2. ATTEMPT EXECUTION BEFORE APPROVAL -> MUST BE REJECTED!
    const execBeforeReq = new NextRequest(`http://localhost:3000/api/finance/payouts/${batchId}/execute`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${testFinanceJwt}`,
      },
    });

    const execBeforeRes = await executePayoutHandler(execBeforeReq, { params: Promise.resolve({ id: batchId }) });
    expect(execBeforeRes.status).toBe(400);
    const execBeforeData = await execBeforeRes.json();
    expect(execBeforeData.code).toBe('HUMAN_APPROVAL_REQUIRED');

    // 3. Human finance lead explicitly reviews and approves the batch
    const approveReq = new NextRequest(`http://localhost:3000/api/finance/payouts/${batchId}/approve`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${testFinanceJwt}`,
      },
    });

    const approveRes = await approvePayoutHandler(approveReq, { params: Promise.resolve({ id: batchId }) });
    expect(approveRes.status).toBe(200);
    const approveData = await approveRes.json();
    expect(approveData.status).toBe('approved');
    expect(approveData.approvedBy).toBe(testFinanceUserId);

    // 4. NOW execution must succeed!
    const execAfterReq = new NextRequest(`http://localhost:3000/api/finance/payouts/${batchId}/execute`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${testFinanceJwt}`,
      },
    });

    const execAfterRes = await executePayoutHandler(execAfterReq, { params: Promise.resolve({ id: batchId }) });
    expect(execAfterRes.status).toBe(200);
    const execAfterData = await execAfterRes.json();
    expect(execAfterData.status).toBe('executed');

    // 5. Verify batch in DB is executed
    const { data: dbBatch } = await admin.from('payout_batches' as any).select('*').eq('id', batchId).single();
    expect((dbBatch as any).status).toBe('executed');
    expect((dbBatch as any).executed_at).toBeDefined();

    // 6. Verify balanced payout settlement entries in ledger (Debit liability, Credit cash)
    const { data: payoutLedger } = await admin
      .from('ledger_entries')
      .select('*')
      .eq('reference_id', batchId)
      .eq('reference_type', 'payout');

    expect(payoutLedger).toHaveLength(2);
    const dr = (payoutLedger as any).find((e: any) => e.direction === 'debit');
    const cr = (payoutLedger as any).find((e: any) => e.direction === 'credit');

    expect(dr.account_code).toBe(LedgerAccountCode.LISTENER_PAYABLE);
    expect(cr.account_code).toBe(LedgerAccountCode.CASH_PG_CLEARING);
    // The journal matches the computed batch total exactly.
    expect(Number(dr.amount_paise)).toBe(propData.totalPaise);
    expect(Number(cr.amount_paise)).toBe(propData.totalPaise);
  });
});
