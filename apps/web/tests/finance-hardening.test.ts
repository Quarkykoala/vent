import { describe, it, expect, beforeAll } from 'vitest';
import { NextRequest } from 'next/server';
import crypto from 'node:crypto';
import { GET as reconcileHandler } from '../src/app/api/finance/reconcile/route';
import { POST as refundHandler } from '../src/app/api/finance/refunds/route';
import { POST as createProposalHandler } from '../src/app/api/finance/payouts/proposal/route';
import { POST as approvePayoutHandler } from '../src/app/api/finance/payouts/[id]/approve/route';
import { POST as executePayoutHandler } from '../src/app/api/finance/payouts/[id]/execute/route';
import { UserRole, LedgerAccountCode, DEFAULT_PRICING } from '@vent/domain';
import { getSupabaseAdmin, getSupabaseServerClient } from '../src/lib/supabase-server';
import { elevateTestSessionToAal2 } from './helpers/mfa';

describe('Package 8 — Finance authority, refunds & listener liabilities', () => {
  const admin = getSupabaseAdmin();

  let testUserId: string;
  let testUserJwt: string;
  let makerUserId: string;
  let makerAal1Jwt: string;
  let makerAal2Jwt: string;
  let approverUserId: string;
  let approverAal2Jwt: string;
  let refundPaymentId: string;
  let refundSessionId: string;
  let listenerProfileId: string;
  let earningId: string;
  let payoutWindowStart: string;
  let payoutWindowEnd: string;

  async function createStaff(role: string, label: string) {
    const phone = `91${Math.floor(1000000000 + Math.random() * 9000000000)}`;
    const password = 'Password123!';
    const { data: auth, error: authError } = await admin.auth.admin.createUser({
      phone,
      phone_confirm: true,
      password,
      app_metadata: { role },
    });
    expect(authError).toBeNull();

    const { data: user, error: userError } = await admin.from('users').insert({
      auth_user_id: auth.user!.id,
      handle: `${label}_${Date.now()}_${Math.floor(Math.random() * 10000)}`,
      age_verified_at: new Date().toISOString(),
      status: 'active',
    } as any).select().single();
    expect(userError).toBeNull();

    const client = getSupabaseServerClient();
    const { data: signedIn, error: signInError } = await client.auth.signInWithPassword({ phone, password });
    expect(signInError).toBeNull();
    const aal1Jwt = signedIn.session!.access_token;
    const aal2Jwt = await elevateTestSessionToAal2(client);

    return { userId: (user as any).id as string, aal1Jwt, aal2Jwt };
  }

  beforeAll(async () => {
    const phoneU = `91${Math.floor(1000000000 + Math.random() * 9000000000)}`;
    const { data: authU } = await admin.auth.admin.createUser({
      phone: phoneU,
      phone_confirm: true,
      password: 'Password123!',
      app_metadata: { role: UserRole.USER },
    });
    const { data: user } = await admin.from('users').insert({
      auth_user_id: authU.user!.id,
      handle: `FinanceUser_${Date.now()}_${Math.floor(Math.random() * 10000)}`,
      age_verified_at: new Date().toISOString(),
      status: 'active',
    } as any).select().single();
    testUserId = (user as any).id;

    const clientU = getSupabaseServerClient();
    const { data: sessionU } = await clientU.auth.signInWithPassword({ phone: phoneU, password: 'Password123!' });
    testUserJwt = sessionU.session!.access_token;

    const maker = await createStaff(UserRole.FINANCE, 'FinanceMaker');
    makerUserId = maker.userId;
    makerAal1Jwt = maker.aal1Jwt;
    makerAal2Jwt = maker.aal2Jwt;

    const approver = await createStaff(UserRole.FINANCE, 'FinanceApprover');
    approverUserId = approver.userId;
    approverAal2Jwt = approver.aal2Jwt;

    const { data: listenerAuth } = await admin.auth.admin.createUser({
      phone: `91${Math.floor(1000000000 + Math.random() * 9000000000)}`,
      phone_confirm: true,
      password: 'Password123!',
      app_metadata: { role: UserRole.LISTENER },
    });
    const { data: listenerUser } = await admin.from('users').insert({
      auth_user_id: listenerAuth.user!.id,
      handle: `FinanceListener_${Date.now()}_${Math.floor(Math.random() * 10000)}`,
      age_verified_at: new Date().toISOString(),
      status: 'active',
    } as any).select().single();
    const { data: profile } = await admin.from('listener_profiles').insert({
      user_id: (listenerUser as any).id,
      display_name: `Finance Listener ${Date.now()}`,
      status: 'active',
      tier: 'listener',
      languages: ['English'],
      topics: ['Work & Career Stress'],
      verified_at: new Date().toISOString(),
      training_expires_at: new Date(Date.now() + 7 * 86400000).toISOString(),
    } as any).select().single();
    listenerProfileId = (profile as any).id;

    // Refund fixture: the caller can lie in JSON, but the canonical persisted
    // session says a technical failure at 0 seconds.
    const refundAmount = 50000;
    const { data: payment } = await admin.from('payments').insert({
      user_id: testUserId,
      provider: 'razorpay',
      provider_order_id: `order_refund_${crypto.randomUUID()}`,
      provider_payment_id: `pay_refund_${crypto.randomUUID()}`,
      amount_paise: refundAmount,
      currency: 'INR',
      state: 'captured',
      captured_at: new Date().toISOString(),
    } as any).select().single();
    refundPaymentId = (payment as any).id;

    const captureEvent = crypto.randomUUID();
    await admin.from('ledger_entries').insert([
      {
        event_id: captureEvent,
        account_code: LedgerAccountCode.CASH_PG_CLEARING,
        direction: 'debit',
        amount_paise: refundAmount,
        currency: 'INR',
        reference_type: 'payment',
        reference_id: refundPaymentId,
      },
      {
        event_id: captureEvent,
        account_code: LedgerAccountCode.CUSTOMER_SERVICE_REVENUE,
        direction: 'credit',
        amount_paise: refundAmount,
        currency: 'INR',
        reference_type: 'payment',
        reference_id: refundPaymentId,
      },
    ] as any);

    const { data: refundRequest } = await admin.from('support_requests').insert({
      user_id: testUserId,
      topic: 'Work & Career Stress',
      language: 'English',
      service_tier: 'listener',
      state: 'technical_failed',
      payment_order_id: refundPaymentId,
      idempotency_key: `refund_req_${crypto.randomUUID()}`,
    } as any).select().single();
    const { data: failedSession } = await admin.from('sessions').insert({
      request_id: (refundRequest as any).id,
      user_id: testUserId,
      listener_id: listenerProfileId,
      room_name: `room_refund_${crypto.randomUUID().replace(/-/g, '')}`,
      state: 'ended',
      started_at: new Date().toISOString(),
      ended_at: new Date().toISOString(),
      duration_seconds: 0,
      end_reason: 'technical_failure',
    } as any).select().single();
    refundSessionId = (failedSession as any).id;

    // Payout fixture goes through the real session-completion RPC so the earning
    // and listener-payable accrual are generated by the production path.
    payoutWindowStart = new Date(Date.now() - 1000).toISOString();
    const { data: payoutRequest } = await admin.from('support_requests').insert({
      user_id: testUserId,
      topic: 'Work & Career Stress',
      language: 'English',
      service_tier: 'listener',
      state: 'connected',
      idempotency_key: `payout_req_${crypto.randomUUID()}`,
    } as any).select().single();
    const { data: activeSession } = await admin.from('sessions').insert({
      request_id: (payoutRequest as any).id,
      user_id: testUserId,
      listener_id: listenerProfileId,
      room_name: `room_payout_${crypto.randomUUID().replace(/-/g, '')}`,
      state: 'active',
      started_at: new Date(Date.now() - 15 * 60_000).toISOString(),
    } as any).select().single();

    const { data: ended, error: endError } = await (admin as any).rpc('atomic_end_session', {
      p_session_id: (activeSession as any).id,
      p_caller_user_id: testUserId,
      p_end_reason: 'normal_completion',
    });
    expect(endError).toBeNull();
    expect(ended.success).toBe(true);
    earningId = ended.earning_id;
    payoutWindowEnd = new Date(Date.now() + 1000).toISOString();
  });

  it('uses current AAL2, not merely a finance role, for privileged payout actions', async () => {
    const req = new NextRequest('http://localhost:3000/api/finance/payouts/proposal', {
      method: 'POST',
      headers: { authorization: `Bearer ${makerAal1Jwt}`, 'content-type': 'application/json' },
      body: JSON.stringify({ periodStart: payoutWindowStart, periodEnd: payoutWindowEnd }),
    });
    const res = await createProposalHandler(req);
    expect(res.status).toBe(403);
  });

  it('derives refund evidence from the bound session and ignores caller-manipulated duration/reason', async () => {
    const req = new NextRequest('http://localhost:3000/api/finance/refunds', {
      method: 'POST',
      headers: { authorization: `Bearer ${testUserJwt}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        paymentId: refundPaymentId,
        // These values would produce a different outcome if trusted.
        durationSeconds: 1200,
        failureReason: 'user_ended_voluntary',
      }),
    });

    const res = await refundHandler(req);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.sessionId).toBe(refundSessionId);
    expect(data.canonicalDurationSeconds).toBe(0);
    expect(data.canonicalFailureReason).toBe('technical_interruption');
    expect(data.refundPercentage).toBe(100);
    expect(data.providerOutcome).toBe('not_configured');
    expect(data.ledgerPosted).toBe(false);

    const { data: refund } = await admin.from('refunds').select('reason, amount_paise, state').eq('payment_id', refundPaymentId).single();
    expect((refund as any).reason).toBe('technical_interruption');
    expect(Number((refund as any).amount_paise)).toBe(50000);
    expect((refund as any).state).toBe('pending_provider');
  });

  it('accrues listener compensation exactly once and pays only from that immutable earning', async () => {
    const { data: earning } = await (admin as any).from('listener_earnings').select('*').eq('id', earningId).single();
    expect(Number(earning.amount_paise)).toBe(Number(DEFAULT_PRICING.listenerEarningsPaise));
    expect(earning.state).toBe('earned');

    const { data: accrual } = await admin.from('ledger_entries').select('*').eq('reference_type', 'listener_earning').eq('reference_id', earningId);
    expect(accrual).toHaveLength(2);
    const accrualDebit = (accrual as any[]).find((e) => e.direction === 'debit');
    const accrualCredit = (accrual as any[]).find((e) => e.direction === 'credit');
    expect(accrualDebit.account_code).toBe('listener_compensation_expense');
    expect(accrualCredit.account_code).toBe(LedgerAccountCode.LISTENER_PAYABLE);

    // Replaying completion cannot create another earning or another journal.
    const { data: sessionRow } = await admin.from('sessions').select('id').eq('id', earning.session_id).single();
    const { data: replay } = await (admin as any).rpc('atomic_end_session', {
      p_session_id: (sessionRow as any).id,
      p_caller_user_id: testUserId,
      p_end_reason: 'normal_completion',
    });
    expect(replay.already_ended).toBe(true);
    const { data: earningsAfterReplay } = await (admin as any).from('listener_earnings').select('id').eq('session_id', earning.session_id);
    expect(earningsAfterReplay).toHaveLength(1);
    const { data: accrualAfterReplay } = await admin.from('ledger_entries').select('id').eq('reference_type', 'listener_earning').eq('reference_id', earningId);
    expect(accrualAfterReplay).toHaveLength(2);

    const proposalReq = new NextRequest('http://localhost:3000/api/finance/payouts/proposal', {
      method: 'POST',
      headers: { authorization: `Bearer ${makerAal2Jwt}`, 'content-type': 'application/json' },
      body: JSON.stringify({ periodStart: payoutWindowStart, periodEnd: payoutWindowEnd }),
    });
    const proposalRes = await createProposalHandler(proposalReq);
    expect(proposalRes.status).toBe(201);
    const proposal = await proposalRes.json();
    expect(proposal.totalPaise).toBe(Number(DEFAULT_PRICING.listenerEarningsPaise));
    expect(proposal.eligibleEarningsCount).toBe(1);

    // Creator cannot approve their own proposal.
    const selfApproveReq = new NextRequest(`http://localhost:3000/api/finance/payouts/${proposal.batchId}/approve`, {
      method: 'POST',
      headers: { authorization: `Bearer ${makerAal2Jwt}` },
    });
    const selfApprove = await approvePayoutHandler(selfApproveReq, { params: Promise.resolve({ id: proposal.batchId }) });
    expect(selfApprove.status).toBe(409);
    expect((await selfApprove.json()).code).toBe('SEPARATION_OF_DUTIES_REQUIRED');

    // Even with a reference, settlement before approval is rejected.
    const earlySettleReq = new NextRequest(`http://localhost:3000/api/finance/payouts/${proposal.batchId}/execute`, {
      method: 'POST',
      headers: { authorization: `Bearer ${approverAal2Jwt}`, 'content-type': 'application/json' },
      body: JSON.stringify({ settlementReference: `UTR-EARLY-${crypto.randomUUID()}` }),
    });
    const earlySettle = await executePayoutHandler(earlySettleReq, { params: Promise.resolve({ id: proposal.batchId }) });
    expect(earlySettle.status).toBe(409);
    expect((await earlySettle.json()).code).toBe('HUMAN_APPROVAL_REQUIRED');

    const approveReq = new NextRequest(`http://localhost:3000/api/finance/payouts/${proposal.batchId}/approve`, {
      method: 'POST',
      headers: { authorization: `Bearer ${approverAal2Jwt}` },
    });
    const approveRes = await approvePayoutHandler(approveReq, { params: Promise.resolve({ id: proposal.batchId }) });
    expect(approveRes.status).toBe(200);
    expect((await approveRes.json()).approvedBy).toBe(approverUserId);
    expect(approverUserId).not.toBe(makerUserId);

    // No evidence => no settlement and no liability-clearing journal.
    const noEvidenceReq = new NextRequest(`http://localhost:3000/api/finance/payouts/${proposal.batchId}/execute`, {
      method: 'POST',
      headers: { authorization: `Bearer ${approverAal2Jwt}`, 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });
    const noEvidence = await executePayoutHandler(noEvidenceReq, { params: Promise.resolve({ id: proposal.batchId }) });
    expect(noEvidence.status).toBe(400);
    expect((await noEvidence.json()).code).toBe('SETTLEMENT_EVIDENCE_REQUIRED');
    const { data: prematureEntries } = await admin.from('ledger_entries').select('id').eq('reference_type', 'payout').eq('reference_id', proposal.batchId);
    expect(prematureEntries).toHaveLength(0);

    const settlementReference = `UTR-${crypto.randomUUID()}`;
    const settleReq = new NextRequest(`http://localhost:3000/api/finance/payouts/${proposal.batchId}/execute`, {
      method: 'POST',
      headers: { authorization: `Bearer ${approverAal2Jwt}`, 'content-type': 'application/json' },
      body: JSON.stringify({ settlementReference }),
    });
    const settleRes = await executePayoutHandler(settleReq, { params: Promise.resolve({ id: proposal.batchId }) });
    expect(settleRes.status).toBe(200);
    const settled = await settleRes.json();
    expect(settled.status).toBe('settled');
    expect(settled.settlementReference).toBe(settlementReference);

    const { data: paidEarning } = await (admin as any).from('listener_earnings').select('state, paid_at').eq('id', earningId).single();
    expect(paidEarning.state).toBe('paid');
    expect(paidEarning.paid_at).toBeTruthy();

    const { data: payoutEntries } = await admin.from('ledger_entries').select('*').eq('reference_type', 'payout').eq('reference_id', proposal.batchId);
    expect(payoutEntries).toHaveLength(2);
    expect((payoutEntries as any[]).find((e) => e.direction === 'debit').account_code).toBe(LedgerAccountCode.LISTENER_PAYABLE);
    expect((payoutEntries as any[]).find((e) => e.direction === 'credit').account_code).toBe(LedgerAccountCode.CASH_PG_CLEARING);
  });

  it('keeps the complete ledger in trial balance after accrual and settlement', async () => {
    const req = new NextRequest('http://localhost:3000/api/finance/reconcile', {
      method: 'GET',
      headers: { authorization: `Bearer ${makerAal2Jwt}` },
    });
    const res = await reconcileHandler(req);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.isBalanced).toBe(true);
    expect(data.totalDebitsPaise).toBe(data.totalCreditsPaise);
  });
});
