import { describe, it, expect, afterAll, beforeAll } from 'vitest';
import { NextRequest } from 'next/server';
import crypto from 'node:crypto';
import { SESSION_CAP_SECONDS } from '@vent/domain';
import { getSupabaseAdmin } from '../src/lib/supabase-server';
import { OperationsWorker } from '../src/features/operations/worker';
import { POST as cronHandler } from '../src/app/api/operations/cron/route';

/**
 * Operations worker suite — executed against the real local Postgres.
 *
 * Proves the jobs the product depends on actually run, converge when re-run
 * (restart/retry safety) and never touch the wrong lifecycle row.
 */

const admin = getSupabaseAdmin() as any;
const runId = crypto.randomUUID().slice(0, 8);

const created = {
  userIds: [] as string[],
  listenerProfileIds: [] as string[],
  requestIds: [] as string[],
  sessionIds: [] as string[],
  reservationIds: [] as string[],
};

async function makeUser(label: string): Promise<string> {
  const { data, error } = await admin
    .from('users')
    .insert({
      auth_user_id: crypto.randomUUID(),
      handle: `Wk${label}${runId}`,
      age_verified_at: new Date().toISOString(),
      status: 'active',
    })
    .select()
    .single();
  if (error || !data) throw new Error(`fixture user failed: ${error?.message}`);
  created.userIds.push(data.id);
  return data.id as string;
}

async function makeListener(userId: string, presenceState = 'available'): Promise<string> {
  const { data, error } = await admin
    .from('listener_profiles')
    .insert({
      user_id: userId,
      display_name: `Worker Listener ${runId}`,
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
    state: presenceState,
    heartbeat_at: new Date().toISOString(),
    available_since: new Date().toISOString(),
  });
  if (presenceErr) throw new Error(`fixture presence failed: ${presenceErr.message}`);
  return data.id as string;
}

async function makeRequest(userId: string, state: string): Promise<string> {
  const { data, error } = await admin
    .from('support_requests')
    .insert({
      user_id: userId,
      topic: 'Work & Career Stress',
      language: 'English',
      service_tier: 'listener',
      state,
      queued_at: state === 'queued' ? new Date().toISOString() : null,
      idempotency_key: `worker_${runId}_${crypto.randomUUID()}`,
    })
    .select()
    .single();
  if (error || !data) throw new Error(`fixture request failed: ${error?.message}`);
  created.requestIds.push(data.id);
  return data.id as string;
}

async function makeSession(params: {
  requestId: string;
  userId: string;
  listenerId: string;
  state: string;
  startedAtIso: string | null;
}): Promise<string> {
  const { data, error } = await admin
    .from('sessions')
    .insert({
      request_id: params.requestId,
      user_id: params.userId,
      listener_id: params.listenerId,
      room_name: `room_worker_${runId}_${crypto.randomUUID().slice(0, 8)}`,
      state: params.state,
      started_at: params.startedAtIso,
    })
    .select()
    .single();
  if (error || !data) throw new Error(`fixture session failed: ${error?.message}`);
  created.sessionIds.push(data.id);
  return data.id as string;
}

async function makeReservation(params: {
  requestId: string;
  listenerId: string;
  state: string;
  expiresAtIso: string;
}): Promise<string> {
  const { data, error } = await admin
    .from('match_reservations')
    .insert({
      request_id: params.requestId,
      listener_id: params.listenerId,
      state: params.state,
      score: 0.5,
      score_components: {},
      expires_at: params.expiresAtIso,
    })
    .select()
    .single();
  if (error || !data) throw new Error(`fixture reservation failed: ${error?.message}`);
  created.reservationIds.push(data.id);
  return data.id as string;
}

beforeAll(() => {
  expect(SESSION_CAP_SECONDS).toBe(1200);
});

afterAll(async () => {
  for (const id of created.sessionIds) await admin.from('sessions').delete().eq('id', id);
  for (const id of created.reservationIds) await admin.from('match_reservations').delete().eq('id', id);
  for (const id of created.requestIds) await admin.from('support_requests').delete().eq('id', id);
  for (const id of created.listenerProfileIds) {
    await admin.from('listener_presence').delete().eq('listener_id', id);
    await admin.from('listener_profiles').delete().eq('id', id);
  }
  for (const id of created.userIds) {
    await admin.from('audit_events').delete().eq('actor_id', id);
    await admin.from('users').delete().eq('id', id);
  }
});

describe('session duration cap is enforced by the server', () => {
  it('ends a session past the cap and releases everything it held', async () => {
    const user = await makeUser('CapUser');
    const listenerUser = await makeUser('CapListener');
    const listenerId = await makeListener(listenerUser, 'reserved');
    const requestId = await makeRequest(user, 'connected');
    const reservationId = await makeReservation({
      requestId,
      listenerId,
      state: 'accepted',
      expiresAtIso: new Date(Date.now() + 60_000).toISOString(),
    });
    const startedAt = new Date(Date.now() - (SESSION_CAP_SECONDS + 120) * 1000).toISOString();
    const sessionId = await makeSession({ requestId, userId: user, listenerId, state: 'active', startedAtIso: startedAt });
    await admin.from('listener_presence').update({ current_reservation_id: reservationId }).eq('listener_id', listenerId);

    const worker = new OperationsWorker(admin);
    const report = await worker.runCycle();
    const capJob = report.jobs.find((j) => j.job === 'enforce_session_cap');
    expect(capJob?.errors).toEqual([]);
    expect(capJob?.changed).toBe(1);

    const { data: sessionAfter } = await admin
      .from('sessions')
      .select('state, end_reason, duration_seconds, ended_at')
      .eq('id', sessionId)
      .single();
    expect(sessionAfter.state).toBe('ended');
    expect(sessionAfter.end_reason).toBe('duration_cap');
    expect(sessionAfter.duration_seconds).toBeGreaterThanOrEqual(SESSION_CAP_SECONDS);
    expect(sessionAfter.ended_at).not.toBeNull();

    const { data: requestAfter } = await admin.from('support_requests').select('state').eq('id', requestId).single();
    expect(requestAfter.state).toBe('completed');

    const { data: presenceAfter } = await admin
      .from('listener_presence')
      .select('state, current_reservation_id')
      .eq('listener_id', listenerId)
      .single();
    expect(presenceAfter.state).toBe('available');
    expect(presenceAfter.current_reservation_id).toBeNull();

    const { data: reservationAfter } = await admin
      .from('match_reservations')
      .select('state')
      .eq('id', reservationId)
      .single();
    expect(reservationAfter.state).toBe('cancelled');
  });

  it('leaves a session inside the cap untouched, and re-running converges', async () => {
    const user = await makeUser('FreshUser');
    const listenerUser = await makeUser('FreshListener');
    const listenerId = await makeListener(listenerUser, 'reserved');
    const requestId = await makeRequest(user, 'connected');
    const sessionId = await makeSession({
      requestId,
      userId: user,
      listenerId,
      state: 'active',
      startedAtIso: new Date(Date.now() - 30_000).toISOString(),
    });

    const worker = new OperationsWorker(admin);
    const first = await worker.runCycle();
    const second = await worker.runCycle();

    expect(first.jobs.find((j) => j.job === 'enforce_session_cap')?.changed).toBe(0);
    // Restart/retry safety: a second cycle must not find new work.
    expect(second.jobs.find((j) => j.job === 'enforce_session_cap')?.changed).toBe(0);
    expect(second.jobs.find((j) => j.job === 'expire_offers')?.changed).toBe(0);

    const { data: sessionAfter } = await admin.from('sessions').select('state').eq('id', sessionId).single();
    expect(sessionAfter.state).toBe('active');
  });
});

describe('offer expiry and presence sweeps actually run', () => {
  it('expires an overdue offer, requeues the request and frees the listener', async () => {
    const user = await makeUser('OfferUser');
    const listenerUser = await makeUser('OfferListener');
    const listenerId = await makeListener(listenerUser, 'reserved');
    const requestId = await makeRequest(user, 'reserved');
    const reservationId = await makeReservation({
      requestId,
      listenerId,
      state: 'offered',
      expiresAtIso: new Date(Date.now() - 5_000).toISOString(),
    });

    const worker = new OperationsWorker(admin);
    const report = await worker.runCycle();
    const job = report.jobs.find((j) => j.job === 'expire_offers');
    expect(job?.errors).toEqual([]);
    expect(job?.changed).toBeGreaterThanOrEqual(1);

    const { data: reservationAfter } = await admin
      .from('match_reservations')
      .select('state')
      .eq('id', reservationId)
      .single();
    expect(reservationAfter.state).toBe('expired');

    const { data: requestAfter } = await admin.from('support_requests').select('state').eq('id', requestId).single();
    expect(requestAfter.state).toBe('queued');

    const { data: presenceAfter } = await admin
      .from('listener_presence')
      .select('state')
      .eq('listener_id', listenerId)
      .single();
    expect(presenceAfter.state).toBe('available');
  });

  it('sweeps a stale available listener offline but never a stale reserved one', async () => {
    const staleUser = await makeUser('StaleUser');
    const staleListenerId = await makeListener(staleUser, 'available');
    const reservedUser = await makeUser('ReservedUser');
    const reservedListenerId = await makeListener(reservedUser, 'reserved');

    const ancient = new Date(Date.now() - 10 * 60_000).toISOString();
    await admin.from('listener_presence').update({ heartbeat_at: ancient }).eq('listener_id', staleListenerId);
    await admin.from('listener_presence').update({ heartbeat_at: ancient }).eq('listener_id', reservedListenerId);

    const worker = new OperationsWorker(admin);
    await worker.runCycle();

    const { data: staleAfter } = await admin
      .from('listener_presence')
      .select('state')
      .eq('listener_id', staleListenerId)
      .single();
    expect(staleAfter.state).toBe('offline');

    const { data: reservedAfter } = await admin
      .from('listener_presence')
      .select('state')
      .eq('listener_id', reservedListenerId)
      .single();
    expect(reservedAfter.state).toBe('reserved');
  });
});

describe('operations cron endpoint fails closed', () => {
  const originalSecret = process.env.OPERATIONS_CRON_SECRET;

  afterAll(() => {
    if (originalSecret === undefined) delete process.env.OPERATIONS_CRON_SECRET;
    else process.env.OPERATIONS_CRON_SECRET = originalSecret;
  });

  function makeRequest(headers: Record<string, string> = {}) {
    return new NextRequest('http://localhost/api/operations/cron', { method: 'POST', headers });
  }

  it('DENY: refuses to run when no secret is configured', async () => {
    delete process.env.OPERATIONS_CRON_SECRET;
    const res = await cronHandler(makeRequest({ 'x-operations-secret': 'anything' }));
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.code).toBe('OPERATIONS_NOT_CONFIGURED');
  });

  it('DENY: rejects a wrong or missing secret', async () => {
    process.env.OPERATIONS_CRON_SECRET = `worker_secret_${runId}_abcdefgh`;
    const wrong = await cronHandler(makeRequest({ 'x-operations-secret': 'not-the-secret' }));
    expect(wrong.status).toBe(401);
    const missing = await cronHandler(makeRequest());
    expect(missing.status).toBe(401);
  });

  it('ALLOW: runs a cycle with the correct secret and returns a per-job report', async () => {
    process.env.OPERATIONS_CRON_SECRET = `worker_secret_${runId}_abcdefgh`;
    const res = await cronHandler(makeRequest({ 'x-operations-secret': process.env.OPERATIONS_CRON_SECRET! }));
    expect([200, 207]).toContain(res.status);
    const body = await res.json();
    const jobNames = body.jobs.map((j: { job: string }) => j.job);
    expect(jobNames).toEqual([
      'expire_offers',
      'sweep_stale_presence',
      'enforce_session_cap',
      'reconcile_payments',
      'verify_ledger_integrity',
      'report_pending_deletions',
    ]);
    for (const job of body.jobs) {
      expect(Array.isArray(job.errors)).toBe(true);
      expect(typeof job.durationMs).toBe('number');
    }
  });
});
