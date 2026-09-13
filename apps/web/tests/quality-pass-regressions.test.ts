import { describe, it, expect, afterAll } from 'vitest';
import crypto from 'node:crypto';
import { NextRequest } from 'next/server';
import { createSupabaseClient } from '@vent/db';
import {
  getSupabaseAdmin,
  getSupabaseServerUrl,
  getSupabaseAnonKey,
} from '../src/lib/supabase-server';
import { OperationsWorker } from '../src/features/operations/worker';
import { POST as endSessionHandler } from '../src/app/api/sessions/[id]/end/route';

/**
 * Regression suite for defects found by the independent quality pass:
 * - a capture must not be reachable for a request that can no longer be
 *   entitled (money taken, no entitlement)
 * - the reconciliation metric must distinguish real orphans from normal
 *   lifecycle outcomes
 * - a client cannot invent an end reason
 */

const admin = getSupabaseAdmin() as any;
const runId = crypto.randomUUID().slice(0, 8);

const created = {
  userIds: [] as string[],
  listenerProfileIds: [] as string[],
  requestIds: [] as string[],
  paymentIds: [] as string[],
  sessionIds: [] as string[],
};

async function makeUser(label: string): Promise<string> {
  const { data, error } = await admin
    .from('users')
    .insert({
      auth_user_id: crypto.randomUUID(),
      handle: `Qg${label}${runId}`,
      age_verified_at: new Date().toISOString(),
      status: 'active',
    })
    .select()
    .single();
  if (error || !data) throw new Error(`fixture user failed: ${error?.message}`);
  created.userIds.push(data.id);
  return data.id as string;
}

async function makePayment(userId: string, state: string): Promise<string> {
  const { data, error } = await admin
    .from('payments')
    .insert({
      user_id: userId,
      provider: 'razorpay',
      provider_order_id: `order_qg_${runId}_${crypto.randomUUID().slice(0, 8)}`,
      amount_paise: 19900,
      currency: 'INR',
      state,
      ...(state === 'captured' ? { captured_at: new Date().toISOString() } : {}),
    })
    .select()
    .single();
  if (error || !data) throw new Error(`fixture payment failed: ${error?.message}`);
  created.paymentIds.push(data.id);
  return data.id as string;
}

async function makeRequest(userId: string, state: string, paymentId: string | null): Promise<string> {
  const { data, error } = await admin
    .from('support_requests')
    .insert({
      user_id: userId,
      topic: 'Work & Career Stress',
      language: 'English',
      service_tier: 'listener',
      state,
      payment_order_id: paymentId,
      queued_at: state === 'queued' ? new Date().toISOString() : null,
      idempotency_key: `qg_${runId}_${crypto.randomUUID()}`,
    })
    .select()
    .single();
  if (error || !data) throw new Error(`fixture request failed: ${error?.message}`);
  created.requestIds.push(data.id);
  return data.id as string;
}

afterAll(async () => {
  for (const id of created.sessionIds) await admin.from('sessions').delete().eq('id', id);
  for (const id of created.requestIds) await admin.from('support_requests').delete().eq('id', id);
  for (const id of created.paymentIds) await admin.from('payments').delete().eq('id', id);
  for (const id of created.listenerProfileIds) await admin.from('listener_profiles').delete().eq('id', id);
  for (const id of created.userIds) await admin.from('users').delete().eq('id', id);
});

describe('reconciliation distinguishes orphans from normal lifecycle outcomes', () => {
  it('flags an orphan capture but not a completed or reserved request', async () => {
    const user = await makeUser('Recon');

    // Real orphan: captured with nothing bound.
    const orphanPayment = await makePayment(user, 'captured');

    // Normal outcomes: captured and bound, further along the lifecycle.
    const completedPayment = await makePayment(user, 'captured');
    await makeRequest(user, 'completed', completedPayment);
    const reservedPayment = await makePayment(user, 'captured');
    await makeRequest(user, 'reserved', reservedPayment);

    // Actionable: captured but the request never reached the queue.
    const stuckPayment = await makePayment(user, 'captured');
    await makeRequest(user, 'created', stuckPayment);

    const worker = new OperationsWorker(admin);
    const report = await worker.runCycle();
    const job = report.jobs.find((j) => j.job === 'reconcile_payments');
    expect(job?.errors).toEqual([]);

    const details = job?.details as { orphanPaymentIds: string[]; neverQueuedPaymentIds: string[] };
    expect(details.orphanPaymentIds).toContain(orphanPayment);
    expect(details.neverQueuedPaymentIds).toContain(stuckPayment);
    // Captured payments whose request legitimately completed or is reserved
    // must not be reported as discrepancies.
    expect(details.orphanPaymentIds).not.toContain(completedPayment);
    expect(details.orphanPaymentIds).not.toContain(reservedPayment);
    expect(details.neverQueuedPaymentIds).not.toContain(completedPayment);
    expect(details.neverQueuedPaymentIds).not.toContain(reservedPayment);
  });
});

describe('an order cannot be created for a request that can no longer be entitled', () => {
  it('DENY: a completed request returns REQUEST_NOT_PAYABLE and creates no payment', async () => {
    const phone = `+9199${crypto.randomUUID().replace(/\D/g, '').slice(0, 7)}`;
    const { data: authUser, error: authErr } = await admin.auth.admin.createUser({
      phone,
      phone_confirm: true,
      password: 'Password123!',
    });
    if (authErr || !authUser.user) throw new Error(`auth fixture failed: ${authErr?.message}`);

    const { data: userRow, error: userErr } = await admin
      .from('users')
      .insert({
        auth_user_id: authUser.user.id,
        handle: `QgOrder${runId}${Math.floor(Math.random() * 1000)}`,
        age_verified_at: new Date().toISOString(),
        status: 'active',
      })
      .select()
      .single();
    if (userErr || !userRow) throw new Error(`user fixture failed: ${userErr?.message}`);
    created.userIds.push(userRow.id);

    // Sign in on a DEDICATED client. Calling signInWithPassword on the shared
    // admin client would attach the user's JWT to it and silently drop
    // service-role authority for every later fixture write in this file.
    const signInClient = createSupabaseClient({
      supabaseUrl: getSupabaseServerUrl(),
      supabaseAnonKey: getSupabaseAnonKey(),
    });
    const { data: signIn, error: signInErr } = await signInClient.auth.signInWithPassword({
      phone,
      password: 'Password123!',
    });
    if (signInErr || !signIn.session) throw new Error(`sign-in failed: ${signInErr?.message}`);

    // A request that has already finished must never be payable again.
    const requestId = await makeRequest(userRow.id, 'completed', null);

    const { POST: createOrderHandler } = await import('../src/app/api/payments/orders/route');
    const res = await createOrderHandler(
      new NextRequest('http://localhost/api/payments/orders', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${signIn.session.access_token}`,
        },
        body: JSON.stringify({ requestId }),
      })
    );

    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.code).toBe('REQUEST_NOT_PAYABLE');

    const { count } = await admin
      .from('payments')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userRow.id);
    expect(count).toBe(0);

    await admin.auth.admin.deleteUser(authUser.user.id);
  });
});

describe('financial history is append-only at the database level', () => {
  it('ALLOW: the worker reports a balanced trial balance with no one-sided events', async () => {
    const worker = new OperationsWorker(admin);
    const report = await worker.runCycle();
    const job = report.jobs.find((j) => j.job === 'verify_ledger_integrity');
    expect(job?.errors).toEqual([]);
    const details = job?.details as {
      unbalancedEvents: number;
      trialBalanceBalanced: boolean;
    };
    expect(details.unbalancedEvents).toBe(0);
    expect(details.trialBalanceBalanced).toBe(true);
  });

  it('DENY: ledger_entries cannot be updated or deleted', async () => {
    const user = await makeUser('Ledger');
    const payment = await makePayment(user, 'captured');
    const eventId = crypto.randomUUID();
    // A balanced pair: the ledger is append-only, so a test fixture must never
    // leave a one-sided event behind.
    const { data: entries } = await admin
      .from('ledger_entries')
      .insert([
        {
          event_id: eventId,
          account_code: 'cash_pg_clearing',
          direction: 'debit',
          amount_paise: 19900,
          currency: 'INR',
          reference_type: 'payment',
          reference_id: payment,
        },
        {
          event_id: eventId,
          account_code: 'customer_service_revenue',
          direction: 'credit',
          amount_paise: 19900,
          currency: 'INR',
          reference_type: 'payment',
          reference_id: payment,
        },
      ])
      .select();
    const entry = (entries as any[]).find((e) => e.direction === 'debit');

    const { error: updateErr } = await admin
      .from('ledger_entries')
      .update({ amount_paise: 1 } as any)
      .eq('id', entry.id);
    expect(updateErr).not.toBeNull();
    expect(updateErr?.message).toMatch(/append-only/i);

    const { error: deleteErr } = await admin.from('ledger_entries').delete().eq('id', entry.id);
    expect(deleteErr).not.toBeNull();
    expect(deleteErr?.message).toMatch(/append-only/i);

    const { data: unchanged } = await admin
      .from('ledger_entries')
      .select('amount_paise')
      .eq('id', entry.id)
      .single();
    expect(Number(unchanged.amount_paise)).toBe(19900);
  });

  it('DENY: audit_events cannot be rewritten', async () => {
    const user = await makeUser('Audit');
    const { data: auditRow } = await admin
      .from('audit_events')
      .insert({
        actor_id: user,
        actor_role: 'system',
        action: 'regression_probe',
        entity_type: 'payment',
        entity_id: crypto.randomUUID(),
        metadata: {},
      })
      .select()
      .single();

    const { error } = await admin
      .from('audit_events')
      .update({ action: 'tampered' } as any)
      .eq('id', auditRow.id);
    expect(error).not.toBeNull();
    expect(error?.message).toMatch(/append-only/i);
  });
});

describe('payout approval cannot rewrite an audited decision', () => {
  it('DENY: a settled batch cannot be re-approved', async () => {
    const maker = await makeUser('FinanceMaker');
    const approver = await makeUser('FinanceApprover');
    const recorder = await makeUser('FinanceRecorder');
    const { data: batch, error: batchError } = await admin
      .from('payout_batches')
      .insert({
        period_start: new Date(Date.now() - 86400000).toISOString(),
        period_end: new Date().toISOString(),
        total_paise: 10000,
        status: 'settled',
        created_by: maker,
        approved_by: approver,
        approved_at: new Date().toISOString(),
        executed_at: new Date().toISOString(),
        settlement_reference: `qg-settlement-${runId}`,
        settlement_recorded_by: recorder,
        settled_at: new Date().toISOString(),
      })
      .select()
      .single();
    expect(batchError).toBeNull();
    expect(batch).not.toBeNull();

    const { data } = await admin.rpc('atomic_approve_payout_batch', {
      p_batch_id: batch.id,
      p_approver_id: approver,
      p_approver_role: 'finance',
    });
    expect(data.success).toBe(false);
    expect(data.code).toBe('INVALID_BATCH_STATE');

    const { data: after } = await admin.from('payout_batches').select('status').eq('id', batch.id).single();
    expect(after.status).toBe('settled');

    await admin.from('payout_batches').delete().eq('id', batch.id);
  });

  it('ENFORCE: maker cannot approve own batch; independent approval is idempotent', async () => {
    const maker = await makeUser('FinanceMaker2');
    const approver = await makeUser('FinanceApprover2');
    const { data: batch, error: batchError } = await admin
      .from('payout_batches')
      .insert({
        period_start: new Date(Date.now() - 86400000).toISOString(),
        period_end: new Date().toISOString(),
        total_paise: 10000,
        status: 'pending_approval',
        created_by: maker,
      })
      .select()
      .single();
    expect(batchError).toBeNull();
    expect(batch).not.toBeNull();

    const { data: selfApproval } = await admin.rpc('atomic_approve_payout_batch', {
      p_batch_id: batch.id,
      p_approver_id: maker,
      p_approver_role: 'finance',
    });
    expect(selfApproval.success).toBe(false);
    expect(selfApproval.code).toBe('SEPARATION_OF_DUTIES_REQUIRED');

    const { data: first } = await admin.rpc('atomic_approve_payout_batch', {
      p_batch_id: batch.id,
      p_approver_id: approver,
      p_approver_role: 'finance',
    });
    expect(first.success).toBe(true);
    expect(first.status).toBe('approved');
    expect(first.idempotent_replay).toBe(false);

    const { data: replay } = await admin.rpc('atomic_approve_payout_batch', {
      p_batch_id: batch.id,
      p_approver_id: approver,
      p_approver_role: 'finance',
    });
    expect(replay.success).toBe(true);
    expect(replay.status).toBe('approved');
    expect(replay.idempotent_replay).toBe(true);

    await admin.from('payout_batches').delete().eq('id', batch.id);
  });
});

describe('session end reason is a controlled value', () => {
  it('DENY: an unapproved end reason is rejected before any state change', async () => {
    const user = await makeUser('EndReason');
    const listenerUser = await makeUser('EndReasonListener');
    const { data: profile } = await admin
      .from('listener_profiles')
      .insert({
        user_id: listenerUser,
        display_name: `QG Listener ${runId}`,
        status: 'active',
        tier: 'listener',
        languages: ['English'],
        topics: ['Work & Career Stress'],
        verified_at: new Date().toISOString(),
        training_expires_at: new Date(Date.now() + 86_400_000).toISOString(),
      })
      .select()
      .single();
    created.listenerProfileIds.push(profile.id);

    const requestId = await makeRequest(user, 'connected', null);
    const { data: session } = await admin
      .from('sessions')
      .insert({
        request_id: requestId,
        user_id: user,
        listener_id: profile.id,
        room_name: `room_qg_${runId}_${crypto.randomUUID().slice(0, 8)}`,
        state: 'active',
        started_at: new Date().toISOString(),
      })
      .select()
      .single();
    created.sessionIds.push(session.id);

    // No Authorization header: the handler must reject the reason before it
    // ever reaches authentication or the database.
    const res = await endSessionHandler(
      new NextRequest(`http://localhost/api/sessions/${session.id}/end`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: 'i_made_this_up' }),
      }),
      { params: Promise.resolve({ id: session.id }) }
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.code).toBe('INVALID_END_REASON');

    const { data: after } = await admin.from('sessions').select('state').eq('id', session.id).single();
    expect(after.state).toBe('active');
  });
});