import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { NextRequest } from 'next/server';
import crypto from 'node:crypto';
import { GET as reconcileHandler } from '../src/app/api/finance/reconcile/route';
import { POST as refundHandler } from '../src/app/api/finance/refunds/route';
import { POST as createProposalHandler } from '../src/app/api/finance/payouts/proposal/route';
import { POST as approvePayoutHandler } from '../src/app/api/finance/payouts/[id]/approve/route';
import { POST as executePayoutHandler } from '../src/app/api/finance/payouts/[id]/execute/route';
import { UserRole, LedgerAccountCode } from '@vent/domain';
import { getSupabaseAdmin, getSupabaseServerClient } from '../src/lib/supabase-server';

describe('Package 8 — Real Finance, Refunds & Human-Gated Payouts', () => {
  const admin = getSupabaseAdmin();

  let testUserId: string;
  let testUserJwt: string;
  let testFinanceUserId: string;
  let testFinanceJwt: string;
  let testPaymentId: string;
  let testSessionId: string;
  const initialPaise = 50000n; // ₹500

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
  });

  afterAll(async () => {
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

  it('refund executes, updates payment to refunded, and writes balanced compensating ledger entries', async () => {
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

    expect(data.state).toBe('refunded');
    expect(data.refundAmountPaise).toBe(Number(initialPaise));

    // 1. Verify payment record updated in PostgreSQL
    const { data: dbPay } = await admin.from('payments').select('state').eq('id', testPaymentId).single();
    expect((dbPay as any).state).toBe('refunded');

    // 2. Verify compensating ledger entries exist (Debit revenue, Credit cash)
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

    // 3. Verify audit log entry
    const { data: auditLog } = await admin
      .from('audit_events')
      .select('*')
      .eq('entity_id', testPaymentId)
      .eq('action', 'payment_refunded');

    expect(auditLog).toHaveLength(1);
  });

  it('duplicate refund on already refunded payment is rejected with 409 Conflict', async () => {
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
    expect(data.error).toMatch(/already been refunded/i);
  });

  it('STRICT INVARIANT: Payout execution strictly requires human finance approval', async () => {
    // 1. Create payout proposal batch
    const propReq = new NextRequest('http://localhost:3000/api/finance/payouts/proposal', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${testFinanceJwt}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        totalPaise: 25000, // ₹250
      }),
    });

    const propRes = await createProposalHandler(propReq);
    expect(propRes.status).toBe(201);
    const propData = await propRes.json();
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
    expect(Number(dr.amount_paise)).toBe(25000);
    expect(Number(cr.amount_paise)).toBe(25000);
  });
});
