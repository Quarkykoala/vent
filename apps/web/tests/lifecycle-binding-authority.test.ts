import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import crypto from 'node:crypto';
import { getSupabaseAdmin } from '../src/lib/supabase-server';

/**
 * Review-lead regression suite — payment/request binding, terminal-state
 * inertness and listener release, executed against the real local Postgres.
 *
 * Each test reproduces the exact counterexample recorded by the independent
 * review probes (see logs/agent-runs/2026-09-08-muse-mvp-review/*) and asserts
 * the repaired postcondition from persisted rows, not from SQL text.
 */

const admin = getSupabaseAdmin() as any;
const runId = crypto.randomUUID().slice(0, 8);

const created = {
  userIds: [] as string[],
  listenerProfileIds: [] as string[],
  requestIds: [] as string[],
  paymentIds: [] as string[],
  sessionIds: [] as string[],
  reservationIds: [] as string[],
  safetyCaseIds: [] as string[],
};

async function makeUser(label: string): Promise<string> {
  const { data, error } = await admin
    .from('users')
    .insert({
      auth_user_id: crypto.randomUUID(),
      handle: `Lc${label}${runId}${Math.floor(Math.random() * 1000)}`,
      age_verified_at: new Date().toISOString(),
      status: 'active',
    })
    .select()
    .single();
  if (error || !data) throw new Error(`fixture user failed: ${error?.message}`);
  created.userIds.push(data.id);
  return data.id as string;
}

async function makeListener(userId: string): Promise<{ profileId: string }> {
  const { data, error } = await admin
    .from('listener_profiles')
    .insert({
      user_id: userId,
      display_name: `Lifecycle Listener ${runId}`,
      status: 'active',
      tier: 'listener',
      languages: ['English'],
      topics: ['Work & Career Stress'],
      verified_at: new Date().toISOString(),
      training_expires_at: new Date(Date.now() + 86_400_000).toISOString(),
    })
    .select()
    .single();
  if (error || !data) throw new Error(`fixture listener failed: ${error?.message}`);
  created.listenerProfileIds.push(data.id);

  const { error: presenceErr } = await admin.from('listener_presence').insert({
    listener_id: data.id,
    state: 'available',
    heartbeat_at: new Date().toISOString(),
    available_since: new Date().toISOString(),
  });
  if (presenceErr) throw new Error(`fixture presence failed: ${presenceErr.message}`);

  return { profileId: data.id as string };
}

async function makeRequest(params: {
  userId: string;
  state?: string;
  paymentId?: string | null;
  queuedAt?: string | null;
}): Promise<string> {
  const { data, error } = await admin
    .from('support_requests')
    .insert({
      user_id: params.userId,
      topic: 'Work & Career Stress',
      language: 'English',
      service_tier: 'listener',
      state: params.state ?? 'created',
      payment_order_id: params.paymentId ?? null,
      queued_at: params.queuedAt ?? null,
      idempotency_key: `lifecycle_${runId}_${crypto.randomUUID()}`,
    })
    .select()
    .single();
  if (error || !data) throw new Error(`fixture request failed: ${error?.message}`);
  created.requestIds.push(data.id);
  return data.id as string;
}

async function makePayment(userId: string, state = 'created'): Promise<{ id: string; providerOrderId: string }> {
  const providerOrderId = `order_lifecycle_${runId}_${crypto.randomUUID().slice(0, 8)}`;
  const { data, error } = await admin
    .from('payments')
    .insert({
      user_id: userId,
      provider: 'razorpay',
      provider_order_id: providerOrderId,
      amount_paise: 19900,
      currency: 'INR',
      state,
    })
    .select()
    .single();
  if (error || !data) throw new Error(`fixture payment failed: ${error?.message}`);
  created.paymentIds.push(data.id);
  return { id: data.id as string, providerOrderId };
}

async function requestStates(ids: string[]): Promise<Array<{ id: string; state: string; payment_order_id: string | null }>> {
  const { data, error } = await admin
    .from('support_requests')
    .select('id, state, payment_order_id')
    .in('id', ids);
  if (error) throw new Error(`state read failed: ${error.message}`);
  return data as Array<{ id: string; state: string; payment_order_id: string | null }>;
}

async function presenceOf(listenerId: string): Promise<{ state: string; current_reservation_id: string | null }> {
  const { data, error } = await admin
    .from('listener_presence')
    .select('state, current_reservation_id')
    .eq('listener_id', listenerId)
    .single();
  if (error) throw new Error(`presence read failed: ${error.message}`);
  return data as { state: string; current_reservation_id: string | null };
}

async function ledgerCountForPayment(paymentId: string): Promise<number> {
  const { count, error } = await admin
    .from('ledger_entries')
    .select('id', { count: 'exact', head: true })
    .eq('reference_type', 'payment')
    .eq('reference_id', paymentId);
  if (error) throw new Error(`ledger read failed: ${error.message}`);
  return count ?? 0;
}

beforeAll(() => {
  expect(typeof runId).toBe('string');
});

afterAll(async () => {
  // Fixture hygiene: remove every row this run created. Append-only payment
  // and ledger rows created here are synthetic (order_lifecycle_*) and are left
  // in place by the same convention the other suites use.
  for (const id of created.sessionIds) await admin.from('sessions').delete().eq('id', id);
  for (const id of created.reservationIds) await admin.from('match_reservations').delete().eq('id', id);
  for (const id of created.requestIds) {
    await admin.from('match_reservations').delete().eq('request_id', id);
    await admin.from('safety_cases').delete().eq('session_id', id);
  }
  await admin.from('safety_cases').delete().in('id', created.safetyCaseIds.length ? created.safetyCaseIds : ['00000000-0000-0000-0000-000000000000']);
  for (const id of created.requestIds) await admin.from('support_requests').delete().eq('id', id);
  for (const id of created.listenerProfileIds) {
    await admin.from('listener_presence').delete().eq('listener_id', id);
    await admin.from('match_reservations').delete().eq('listener_id', id);
    await admin.from('listener_profiles').delete().eq('id', id);
  }
  for (const id of created.userIds) {
    await admin.from('audit_events').delete().eq('actor_id', id);
    await admin.from('payments').delete().eq('user_id', id);
    await admin.from('users').delete().eq('id', id);
  }
});

describe('Payment -> request binding is one-to-one', () => {
  it('ALLOW: a capture queues exactly the request bound to that order', async () => {
    const payer = await makeUser('Payer');
    const payment = await makePayment(payer);
    const boundRequest = await makeRequest({ userId: payer, paymentId: payment.id });
    const unrelatedRequest = await makeRequest({ userId: payer });

    const { data, error } = await admin.rpc('atomic_capture_payment_webhook', {
      p_provider_order_id: payment.providerOrderId,
      p_provider_payment_id: `pay_${runId}_one`,
      p_amount_paise: 19900,
      p_currency: 'INR',
      p_idempotency_key: `lifecycle_capture_${runId}_1`,
      p_idempotency_response: { ok: true },
    });
    expect(error).toBeNull();
    expect(data.success).toBe(true);
    expect(data.entitlement_bound).toBe(true);
    expect(data.queued_request_id).toBe(boundRequest);

    const states = await requestStates([boundRequest, unrelatedRequest]);
    const bound = states.find((r) => r.id === boundRequest);
    const unrelated = states.find((r) => r.id === unrelatedRequest);
    expect(bound?.state).toBe('queued');
    expect(bound?.payment_order_id).toBe(payment.id);
    // The defect this suite reproduces: previously BOTH requests were queued
    // and both carried the single payment link.
    expect(unrelated?.state).toBe('created');
    expect(unrelated?.payment_order_id).toBeNull();

    expect(await ledgerCountForPayment(payment.id)).toBe(2);
  });

  it('DENY: a replay (new event id, same order) cannot queue a second request', async () => {
    const payer = await makeUser('Replayer');
    const payment = await makePayment(payer);
    const boundRequest = await makeRequest({ userId: payer, paymentId: payment.id });
    const unrelatedRequest = await makeRequest({ userId: payer });

    await admin.rpc('atomic_capture_payment_webhook', {
      p_provider_order_id: payment.providerOrderId,
      p_provider_payment_id: `pay_${runId}_replay_a`,
      p_amount_paise: 19900,
      p_currency: 'INR',
      p_idempotency_key: `lifecycle_capture_${runId}_2a`,
      p_idempotency_response: { attempt: 'a' },
    });

    const { data } = await admin.rpc('atomic_capture_payment_webhook', {
      p_provider_order_id: payment.providerOrderId,
      p_provider_payment_id: `pay_${runId}_replay_b`,
      p_amount_paise: 19900,
      p_currency: 'INR',
      p_idempotency_key: `lifecycle_capture_${runId}_2b`,
      p_idempotency_response: { attempt: 'b' },
    });
    expect(data.idempotent_replay).toBe(true);

    const states = await requestStates([boundRequest, unrelatedRequest]);
    expect(states.find((r) => r.id === unrelatedRequest)?.state).toBe('created');
    expect(states.find((r) => r.id === boundRequest)?.state).toBe('queued');
    // Ledger stayed balanced: exactly one capture event for this payment.
    expect(await ledgerCountForPayment(payment.id)).toBe(2);
  });

  it('DENY: amount or currency mismatch never captures and never queues', async () => {
    const payer = await makeUser('Mismatch');
    const payment = await makePayment(payer);
    const request = await makeRequest({ userId: payer, paymentId: payment.id });

    const { data: amountResult } = await admin.rpc('atomic_capture_payment_webhook', {
      p_provider_order_id: payment.providerOrderId,
      p_provider_payment_id: `pay_${runId}_bad_amount`,
      p_amount_paise: 1,
      p_currency: 'INR',
      p_idempotency_key: `lifecycle_capture_${runId}_3a`,
      p_idempotency_response: {},
    });
    expect(amountResult.success).toBe(false);
    expect(amountResult.code).toBe('AMOUNT_MISMATCH');

    const { data: currencyResult } = await admin.rpc('atomic_capture_payment_webhook', {
      p_provider_order_id: payment.providerOrderId,
      p_provider_payment_id: `pay_${runId}_bad_currency`,
      p_amount_paise: 19900,
      p_currency: 'USD',
      p_idempotency_key: `lifecycle_capture_${runId}_3b`,
      p_idempotency_response: {},
    });
    expect(currencyResult.success).toBe(false);
    expect(currencyResult.code).toBe('CURRENCY_MISMATCH');

    const states = await requestStates([request]);
    expect(states[0].state).toBe('created');
    expect(await ledgerCountForPayment(payment.id)).toBe(0);
  });

  it('DENY: the database refuses to bind one payment to two requests', async () => {
    const payer = await makeUser('Unique');
    const payment = await makePayment(payer);
    await makeRequest({ userId: payer, paymentId: payment.id });

    const { error } = await admin.from('support_requests').insert({
      user_id: payer,
      topic: 'Work & Career Stress',
      language: 'English',
      service_tier: 'listener',
      state: 'created',
      payment_order_id: payment.id,
      idempotency_key: `lifecycle_dup_${runId}`,
    } as any);

    expect(error).not.toBeNull();
    expect(error?.code).toBe('23505');
  });
});

describe('Terminal states are inert', () => {
  it('DENY: acceptance replay after a completed session changes nothing', async () => {
    const user = await makeUser('TerminalUser');
    const listenerUser = await makeUser('TerminalListener');
    const { profileId } = await makeListener(listenerUser);
    const requestId = await makeRequest({ userId: user, state: 'completed' });

    const { data: reservation } = await admin
      .from('match_reservations')
      .insert({
        request_id: requestId,
        listener_id: profileId,
        state: 'accepted',
        score: 0.9,
        score_components: {},
        expires_at: new Date(Date.now() + 60_000).toISOString(),
        accepted_at: new Date().toISOString(),
      })
      .select()
      .single();
    created.reservationIds.push(reservation.id);

    const { data: session } = await admin
      .from('sessions')
      .insert({
        request_id: requestId,
        user_id: user,
        listener_id: profileId,
        room_name: `room_lifecycle_${runId}_${crypto.randomUUID().slice(0, 8)}`,
        state: 'ended',
        started_at: new Date(Date.now() - 60_000).toISOString(),
        ended_at: new Date().toISOString(),
        duration_seconds: 60,
        end_reason: 'normal_completion',
      })
      .select()
      .single();
    created.sessionIds.push(session.id);
    await admin.from('listener_presence').update({ state: 'available' }).eq('listener_id', profileId);

    const before = await presenceOf(profileId);

    const { data, error } = await admin.rpc('atomic_accept_session_recovery', {
      p_reservation_id: reservation.id,
      p_listener_id: profileId,
    });
    expect(error).toBeNull();
    expect(data.success).toBe(false);
    expect(data.code).toBe('TERMINAL_STATE');

    const after = await presenceOf(profileId);
    expect(after.state).toBe('available');
    expect(after.state).toBe(before.state);

    const { count } = await admin
      .from('sessions')
      .select('id', { count: 'exact', head: true })
      .eq('request_id', requestId);
    expect(count).toBe(1);

    const states = await requestStates([requestId]);
    expect(states[0].state).toBe('completed');
  });

  it('DENY: accepting an offer left over from a terminal request cannot resurrect it', async () => {
    const user = await makeUser('StaleOfferUser');
    const listenerUser = await makeUser('StaleOfferListener');
    const { profileId } = await makeListener(listenerUser);
    const requestId = await makeRequest({ userId: user, state: 'cancelled' });

    const { data: reservation } = await admin
      .from('match_reservations')
      .insert({
        request_id: requestId,
        listener_id: profileId,
        state: 'offered',
        score: 0.5,
        score_components: {},
        expires_at: new Date(Date.now() + 60_000).toISOString(),
      })
      .select()
      .single();
    created.reservationIds.push(reservation.id);

    const { data } = await admin.rpc('atomic_accept_reservation', {
      p_reservation_id: reservation.id,
      p_listener_id: profileId,
    });
    expect(data.success).toBe(false);
    expect(data.code).toBe('TERMINAL_STATE');

    const states = await requestStates([requestId]);
    expect(states[0].state).toBe('cancelled');

    const { data: reservationAfter } = await admin
      .from('match_reservations')
      .select('state')
      .eq('id', reservation.id)
      .single();
    expect(reservationAfter.state).toBe('offered');

    const { count } = await admin
      .from('sessions')
      .select('id', { count: 'exact', head: true })
      .eq('request_id', requestId);
    expect(count).toBe(0);
  });
});

describe('A finished session releases the listener for the next session', () => {
  it('ALLOW: after a completed session the same listener can be matched again', async () => {
    const user = await makeUser('RepeatUser');
    const listenerUser = await makeUser('RepeatListener');
    const { profileId } = await makeListener(listenerUser);

    const firstRequest = await makeRequest({ userId: user, state: 'queued', queuedAt: new Date().toISOString() });
    const { data: reserved } = await admin.rpc('atomic_reserve_match', {
      p_request_id: firstRequest,
      p_listener_id: profileId,
      p_score: 0.8,
      p_score_components: {},
      p_ttl_seconds: 45,
    });
    expect(reserved.success).toBe(true);
    created.reservationIds.push(reserved.reservation_id);

    const { data: accepted } = await admin.rpc('atomic_accept_reservation', {
      p_reservation_id: reserved.reservation_id,
      p_listener_id: profileId,
    });
    expect(accepted.success).toBe(true);

    const { data: recovered } = await admin.rpc('atomic_accept_session_recovery', {
      p_reservation_id: reserved.reservation_id,
      p_listener_id: profileId,
    });
    expect(recovered.success).toBe(true);
    created.sessionIds.push(recovered.session_id);

    const { data: ended } = await admin.rpc('atomic_end_session', {
      p_session_id: recovered.session_id,
      p_caller_user_id: listenerUser,
      p_end_reason: 'normal_completion',
    });
    expect(ended.success).toBe(true);

    // Reservation settled and presence released.
    const { data: reservationAfter } = await admin
      .from('match_reservations')
      .select('state')
      .eq('id', reserved.reservation_id)
      .single();
    expect(reservationAfter.state).toBe('cancelled');
    const presence = await presenceOf(profileId);
    expect(presence.state).toBe('available');
    expect(presence.current_reservation_id).toBeNull();

    // The regression this guards: an accepted reservation stayed "active"
    // forever, so the partial unique index blocked every later reservation.
    const secondRequest = await makeRequest({ userId: user, state: 'queued', queuedAt: new Date().toISOString() });
    const { data: second } = await admin.rpc('atomic_reserve_match', {
      p_request_id: secondRequest,
      p_listener_id: profileId,
      p_score: 0.8,
      p_score_components: {},
      p_ttl_seconds: 45,
    });
    expect(second.success).toBe(true);
    created.reservationIds.push(second.reservation_id);
  });

  it('DENY: ending an already-ended session reports already_ended and mutates nothing', async () => {
    const user = await makeUser('IdempotentEnd');
    const listenerUser = await makeUser('IdempotentEndListener');
    const { profileId } = await makeListener(listenerUser);
    const requestId = await makeRequest({ userId: user, state: 'completed' });

    const { data: session } = await admin
      .from('sessions')
      .insert({
        request_id: requestId,
        user_id: user,
        listener_id: profileId,
        room_name: `room_lifecycle_${runId}_end_${crypto.randomUUID().slice(0, 8)}`,
        state: 'ended',
        started_at: new Date(Date.now() - 120_000).toISOString(),
        ended_at: new Date().toISOString(),
        duration_seconds: 120,
      })
      .select()
      .single();
    created.sessionIds.push(session.id);

    const { data } = await admin.rpc('atomic_end_session', {
      p_session_id: session.id,
      p_caller_user_id: listenerUser,
      p_end_reason: 'normal_completion',
    });
    expect(data.success).toBe(true);
    expect(data.already_ended).toBe(true);

    const { data: sessionAfter } = await admin
      .from('sessions')
      .select('state, duration_seconds')
      .eq('id', session.id)
      .single();
    expect(sessionAfter.state).toBe('ended');
    expect(sessionAfter.duration_seconds).toBe(120);
  });
});

describe('Safety cases are participant-scoped and terminal-safe', () => {
  it('DENY: a non-participant cannot open a safety case or terminate a session', async () => {
    const user = await makeUser('SafetyUser');
    const listenerUser = await makeUser('SafetyListener');
    const intruder = await makeUser('Intruder');
    const { profileId } = await makeListener(listenerUser);
    const requestId = await makeRequest({ userId: user, state: 'connected' });

    const { data: session } = await admin
      .from('sessions')
      .insert({
        request_id: requestId,
        user_id: user,
        listener_id: profileId,
        room_name: `room_lifecycle_${runId}_safety_${crypto.randomUUID().slice(0, 8)}`,
        state: 'active',
        started_at: new Date().toISOString(),
      })
      .select()
      .single();
    created.sessionIds.push(session.id);

    const { data, error } = await admin.rpc('atomic_create_safety_case', {
      p_session_id: session.id,
      p_reporter_user_id: intruder,
      p_severity: 'urgent',
      p_reason_codes: ['intruder_probe'],
      p_reporter_role: 'user',
    });
    expect(error).toBeNull();
    expect(data.success).toBe(false);
    expect(data.code).toBe('UNAUTHORIZED_REPORTER');

    const { data: sessionAfter } = await admin.from('sessions').select('state').eq('id', session.id).single();
    expect(sessionAfter.state).toBe('active');
  });

  it('ALLOW: a participant opens one case, the session ends safely, and a replay is idempotent', async () => {
    const user = await makeUser('SafetyUser2');
    const listenerUser = await makeUser('SafetyListener2');
    const { profileId } = await makeListener(listenerUser);
    const requestId = await makeRequest({ userId: user, state: 'connected' });

    const { data: reservation } = await admin
      .from('match_reservations')
      .insert({
        request_id: requestId,
        listener_id: profileId,
        state: 'accepted',
        score: 0.7,
        score_components: {},
        expires_at: new Date(Date.now() + 60_000).toISOString(),
        accepted_at: new Date().toISOString(),
      })
      .select()
      .single();
    created.reservationIds.push(reservation.id);

    const { data: session } = await admin
      .from('sessions')
      .insert({
        request_id: requestId,
        user_id: user,
        listener_id: profileId,
        room_name: `room_lifecycle_${runId}_safety2_${crypto.randomUUID().slice(0, 8)}`,
        state: 'active',
        started_at: new Date().toISOString(),
      })
      .select()
      .single();
    created.sessionIds.push(session.id);
    await admin.from('listener_presence').update({ state: 'reserved', current_reservation_id: reservation.id }).eq('listener_id', profileId);

    const { data: first } = await admin.rpc('atomic_create_safety_case', {
      p_session_id: session.id,
      p_reporter_user_id: user,
      p_severity: 'urgent',
      p_reason_codes: ['self_harm_risk'],
      p_reporter_role: 'user',
    });
    expect(first.success).toBe(true);
    expect(first.state).toBe('open');
    created.safetyCaseIds.push(first.case_id);

    const { data: sessionAfter } = await admin.from('sessions').select('state').eq('id', session.id).single();
    expect(sessionAfter.state).toBe('safety_ended');

    const requestAfter = await requestStates([requestId]);
    expect(requestAfter[0].state).toBe('safety_escalated');

    const presence = await presenceOf(profileId);
    expect(presence.state).toBe('available');
    expect(presence.current_reservation_id).toBeNull();

    const { data: reservationAfter } = await admin
      .from('match_reservations')
      .select('state')
      .eq('id', reservation.id)
      .single();
    expect(reservationAfter.state).toBe('cancelled');

    const { data: replay } = await admin.rpc('atomic_create_safety_case', {
      p_session_id: session.id,
      p_reporter_user_id: user,
      p_severity: 'urgent',
      p_reason_codes: ['self_harm_risk'],
      p_reporter_role: 'user',
    });
    expect(replay.success).toBe(true);
    expect(replay.idempotent_replay).toBe(true);
    expect(replay.case_id).toBe(first.case_id);

    const { count } = await admin
      .from('safety_cases')
      .select('id', { count: 'exact', head: true })
      .eq('session_id', session.id);
    expect(count).toBe(1);

    // The safety path is also terminal-safe: the session stays safety_ended.
    const { data: stillEnded } = await admin.from('sessions').select('state').eq('id', session.id).single();
    expect(stillEnded.state).toBe('safety_ended');
  });
});
