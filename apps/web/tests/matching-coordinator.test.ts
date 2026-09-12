import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { NextRequest } from 'next/server';
import { UserRole, type UserRoleType } from '@vent/domain';
import {
  getSupabaseAdmin,
  getSupabaseServerUrl,
  getSupabaseAnonKey,
} from '../src/lib/supabase-server';
import { createSupabaseClient, MatchingRepository, ListenerRepository } from '@vent/db';
import { MatchingCoordinator } from '../src/features/matching/coordinator';
import { POST as acceptHandler } from '../src/app/api/matches/[id]/accept/route';
import { POST as expiryHandler } from '../src/app/api/operations/reservation-expiry/route';
import { POST as matchHandler } from '../src/app/api/support-requests/[id]/match/route';

/**
 * WP-7 (P4.2/P4.3): real coordinator execution against the live database.
 * Concurrency uses the database's own row locking (Promise.allSettled on the
 * atomic RPC) — no sleep-based coordination anywhere.
 */

const raw = () => getSupabaseAdmin() as any;

interface ListenerFixture {
  userId: string;
  authUserId: string;
  profileId: string;
  token: string;
  phone: string;
}

async function provisionActor(
  role: UserRoleType,
  handlePrefix: string,
  nonce: number
): Promise<{ userId: string; authUserId: string; token: string; phone: string }> {
  const admin = raw();
  const phone = `+919${Date.now().toString().slice(-6)}${Math.floor(100 + Math.random() * 900)}${nonce}`;
  const { data: created, error } = await admin.auth.admin.createUser({
    phone,
    phone_confirm: true,
    password: 'Password123!',
    app_metadata: { role },
  });
  if (error || !created.user) throw new Error(`provision ${handlePrefix}: ${error?.message}`);

  const { data: userRow, error: userErr } = await admin
    .from('users')
    .insert({
      auth_user_id: created.user.id,
      handle: `${handlePrefix}_${nonce}_${Date.now()}`,
      age_verified_at: new Date().toISOString(),
      status: 'active',
    })
    .select()
    .single();
  if (userErr || !userRow) throw new Error(`users row ${handlePrefix}: ${userErr?.message}`);

  const url = getSupabaseServerUrl();
  const anonKey = getSupabaseAnonKey();
  const loginClient = createSupabaseClient({ supabaseUrl: url, supabaseAnonKey: anonKey });
  const { data: signIn, error: signInErr } = await loginClient.auth.signInWithPassword({
    phone,
    password: 'Password123!',
  });
  if (signInErr || !signIn.session) throw new Error(`login ${handlePrefix}: ${signInErr?.message}`);

  return {
    userId: (userRow as any).id,
    authUserId: created.user.id,
    token: signIn.session.access_token,
    phone,
  };
}

describe('WP-7 — Queue coordinator, atomic reservation, accept→session (live DB)', () => {
  const admin = raw();
  const coordinator = new MatchingCoordinator(getSupabaseAdmin());
  const matchingRepo = new MatchingRepository(getSupabaseAdmin());
  const listenerRepo = new ListenerRepository(getSupabaseAdmin());

  const cleanupIds = {
    sessionIds: [] as string[],
    reservationIds: [] as string[],
    requestIds: [] as string[],
    paymentIds: [] as string[],
    profileIds: [] as string[],
    presenceIds: [] as string[],
    blockIds: [] as string[],
    userIds: [] as string[],
    authUserIds: [] as string[],
  };

  let user: { userId: string; authUserId: string; token: string; phone: string };
  let listenerA: ListenerFixture;
  let listenerB: ListenerFixture;
  let ops: { userId: string; authUserId: string; token: string; phone: string };
  let nonce = 0;

  async function makeListener(prefix: string, availableSinceMinutesAgo: number): Promise<ListenerFixture> {
    nonce += 1;
    const actor = await provisionActor(UserRole.LISTENER, prefix, nonce);
    cleanupIds.userIds.push(actor.userId);
    cleanupIds.authUserIds.push(actor.authUserId);

    const profile = await listenerRepo.createProfile({
      userId: actor.userId,
      displayName: `${prefix} ${nonce}`,
      languages: ['English'],
      topics: ['Work & Career Stress'],
    });
    cleanupIds.profileIds.push(profile.id);
    cleanupIds.presenceIds.push(profile.id);

    await admin
      .from('listener_profiles')
      .update({
        status: 'active',
        training_expires_at: new Date(Date.now() + 90 * 24 * 3600 * 1000).toISOString(),
      })
      .eq('id', profile.id);

    await (admin.from('listener_presence') as any)
      .update({
        state: 'available',
        heartbeat_at: new Date().toISOString(),
        available_since: new Date(Date.now() - availableSinceMinutesAgo * 60_000).toISOString(),
      })
      .eq('listener_id', profile.id);

    return { ...actor, profileId: profile.id };
  }

  async function setAvailablePresence(
    listener: ListenerFixture,
    availableSinceMinutesAgo: number
  ): Promise<void> {
    await (admin.from('listener_presence') as any)
      .update({
        state: 'available',
        heartbeat_at: new Date().toISOString(),
        available_since: new Date(Date.now() - availableSinceMinutesAgo * 60_000).toISOString(),
      })
      .eq('listener_id', listener.profileId);
  }

  async function makeQueuedPaidRequest(): Promise<{ requestId: string; paymentId: string }> {
    nonce += 1;
    const { data: payment, error: payErr } = await admin
      .from('payments')
      .insert({
        user_id: user.userId,
        provider: 'razorpay',
        provider_order_id: `order_coord_${nonce}_${Date.now()}`,
        amount_paise: 50000,
        currency: 'INR',
        state: 'captured',
        captured_at: new Date().toISOString(),
      })
      .select()
      .single();
    if (payErr || !payment) throw new Error(`payment fixture: ${payErr?.message}`);
    cleanupIds.paymentIds.push((payment as any).id);

    const { data: request, error: reqErr } = await admin
      .from('support_requests')
      .insert({
        user_id: user.userId,
        topic: 'Work & Career Stress',
        language: 'English',
        service_tier: 'listener',
        state: 'queued',
        payment_order_id: (payment as any).id,
        queued_at: new Date().toISOString(),
        idempotency_key: `coord_req_${nonce}_${Date.now()}`,
      })
      .select()
      .single();
    if (reqErr || !request) throw new Error(`request fixture: ${reqErr?.message}`);
    cleanupIds.requestIds.push((request as any).id);

    return { requestId: (request as any).id, paymentId: (payment as any).id };
  }

  beforeAll(async () => {
    user = await provisionActor(UserRole.USER, 'CoordUser', 0);
    cleanupIds.userIds.push(user.userId);
    cleanupIds.authUserIds.push(user.authUserId);

    listenerA = await makeListener('CoordListenerA', 1);
    listenerB = await makeListener('CoordListenerB', 10);

    ops = await provisionActor(UserRole.LISTENER_OPS, 'CoordOps', 99);
    cleanupIds.userIds.push(ops.userId);
    cleanupIds.authUserIds.push(ops.authUserId);
  });

  afterAll(async () => {
    if (cleanupIds.sessionIds.length) {
      await admin.from('sessions').delete().in('id', cleanupIds.sessionIds);
    }
    if (cleanupIds.reservationIds.length) {
      await admin.from('match_reservations').delete().in('id', cleanupIds.reservationIds);
    }
    if (cleanupIds.requestIds.length) {
      await admin.from('support_requests').delete().in('id', cleanupIds.requestIds);
    }
    if (cleanupIds.paymentIds.length) {
      await admin.from('payments').delete().in('id', cleanupIds.paymentIds);
    }
    if (cleanupIds.blockIds.length) {
      await admin.from('blocks').delete().in('id', cleanupIds.blockIds);
    }
    if (cleanupIds.presenceIds.length) {
      await admin.from('listener_presence').delete().in('listener_id', cleanupIds.presenceIds);
    }
    if (cleanupIds.profileIds.length) {
      await admin.from('listener_profiles').delete().in('id', cleanupIds.profileIds);
    }
    if (cleanupIds.userIds.length) {
      await admin.from('users').delete().in('id', cleanupIds.userIds);
    }
    for (const authId of cleanupIds.authUserIds) {
      await admin.auth.admin.deleteUser(authId);
    }
  });

  it('reserves the best candidate atomically and persists score components', async () => {
    await setAvailablePresence(listenerA, 1);
    await setAvailablePresence(listenerB, 10);
    const { requestId } = await makeQueuedPaidRequest();
    const result = await coordinator.attemptMatch(requestId);

    expect(result.status).toBe('reserved');
    expect(result.reservationId).toBeDefined();
    cleanupIds.reservationIds.push(result.reservationId!);

    const reservation = await matchingRepo.getReservation(result.reservationId!);
    expect(reservation!.state).toBe('offered');
    expect(reservation!.score_components).toHaveProperty('languageScore');

    const { data: reqRow } = await admin
      .from('support_requests')
      .select('state')
      .eq('id', requestId)
      .single();
    expect((reqRow as any).state).toBe('reserved');

    const { data: presence } = await admin
      .from('listener_presence')
      .select('state')
      .eq('listener_id', reservation!.listener_id)
      .single();
    expect((presence as any).state).toBe('reserved');

    // Release the offer so later suites/tests see an eligible listener pool.
    await matchingRepo.declineReservation(result.reservationId!);
  });

  it('rejects matching for a request without captured payment entitlement', async () => {
    const { data: request, error } = await admin
      .from('support_requests')
      .insert({
        user_id: user.userId,
        topic: 'Work & Career Stress',
        language: 'English',
        service_tier: 'listener',
        state: 'created',
        idempotency_key: `coord_unpaid_${Date.now()}`,
      })
      .select()
      .single();
    cleanupIds.requestIds.push((request as any).id);
    expect(error).toBeNull();

    const result = await coordinator.attemptMatch((request as any).id);
    expect(result.status).toBe('not_entitled');

    const { data: active } = await admin
      .from('match_reservations')
      .select('id')
      .eq('request_id', (request as any).id);
    expect(active).toHaveLength(0);
  });

  it('R4: rejects a queued request linked to a non-captured (failed) payment', async () => {
    await setAvailablePresence(listenerA, 1);
    const { data: payment } = await admin
      .from('payments')
      .insert({
        user_id: user.userId,
        provider: 'razorpay',
        provider_order_id: `order_r4_failed_${Date.now()}`,
        amount_paise: 50000,
        currency: 'INR',
        state: 'failed',
      })
      .select()
      .single();
    cleanupIds.paymentIds.push((payment as any).id);

    const { data: request } = await admin
      .from('support_requests')
      .insert({
        user_id: user.userId,
        topic: 'Work & Career Stress',
        language: 'English',
        service_tier: 'listener',
        state: 'queued',
        payment_order_id: (payment as any).id,
        queued_at: new Date().toISOString(),
        idempotency_key: `coord_r4_failed_${Date.now()}`,
      })
      .select()
      .single();
    cleanupIds.requestIds.push((request as any).id);

    const result = await coordinator.attemptMatch((request as any).id);
    expect(result.status).toBe('not_entitled');
    expect(result.message).toMatch(/not captured/i);

    const { data: active } = await admin
      .from('match_reservations')
      .select('id')
      .eq('request_id', (request as any).id);
    expect(active).toHaveLength(0);
  });

  it('R4: rejects a queued request linked to another user\u2019s captured payment', async () => {
    await setAvailablePresence(listenerA, 1);
    const { data: payment } = await admin
      .from('payments')
      .insert({
        user_id: listenerA.userId,
        provider: 'razorpay',
        provider_order_id: `order_r4_other_${Date.now()}`,
        amount_paise: 50000,
        currency: 'INR',
        state: 'captured',
        captured_at: new Date().toISOString(),
      })
      .select()
      .single();
    cleanupIds.paymentIds.push((payment as any).id);

    const { data: request } = await admin
      .from('support_requests')
      .insert({
        user_id: user.userId,
        topic: 'Work & Career Stress',
        language: 'English',
        service_tier: 'listener',
        state: 'queued',
        payment_order_id: (payment as any).id,
        queued_at: new Date().toISOString(),
        idempotency_key: `coord_r4_other_${Date.now()}`,
      })
      .select()
      .single();
    cleanupIds.requestIds.push((request as any).id);

    const result = await coordinator.attemptMatch((request as any).id);
    expect(result.status).toBe('not_entitled');
    expect(result.message).toMatch(/different user/i);

    const { data: active } = await admin
      .from('match_reservations')
      .select('id')
      .eq('request_id', (request as any).id);
    expect(active).toHaveLength(0);
  });

  it('R4: rejects a queued request whose linked payment row is missing', async () => {
    await setAvailablePresence(listenerA, 1);
    const { data: request } = await admin
      .from('support_requests')
      .insert({
        user_id: user.userId,
        topic: 'Work & Career Stress',
        language: 'English',
        service_tier: 'listener',
        state: 'queued',
        payment_order_id: crypto.randomUUID(),
        queued_at: new Date().toISOString(),
        idempotency_key: `coord_r4_missing_${Date.now()}`,
      })
      .select()
      .single();
    cleanupIds.requestIds.push((request as any).id);

    const result = await coordinator.attemptMatch((request as any).id);
    expect(result.status).toBe('not_entitled');
    expect(result.message).toMatch(/not found/i);

    const { data: active } = await admin
      .from('match_reservations')
      .select('id')
      .eq('request_id', (request as any).id);
    expect(active).toHaveLength(0);
  });

  it('serializes concurrent claims: exactly one of two parallel claims wins', async () => {
    await setAvailablePresence(listenerA, 1);
    await setAvailablePresence(listenerB, 10);
    const { requestId } = await makeQueuedPaidRequest();

    const [claimA, claimB] = await Promise.allSettled([
      matchingRepo.createReservation({
        requestId,
        listenerId: listenerA.profileId,
        score: 0.9,
        scoreComponents: {
          languageScore: 1,
          topicScore: 1,
          waitFairness: 0.5,
          bayesianQuality: 0.5,
          repeatAffinity: 0,
          loadBalance: 1,
        },
      }),
      matchingRepo.createReservation({
        requestId,
        listenerId: listenerB.profileId,
        score: 0.9,
        scoreComponents: {
          languageScore: 1,
          topicScore: 1,
          waitFairness: 0.5,
          bayesianQuality: 0.5,
          repeatAffinity: 0,
          loadBalance: 1,
        },
      }),
    ]);

    const settled = [claimA, claimB].filter((r) => r.status === 'fulfilled');
    const rejected = [claimA, claimB].filter(
      (r) => r.status === 'rejected'
    ) as PromiseRejectedResult[];

    expect(settled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    const winner = (settled[0] as PromiseFulfilledResult<any>).value;
    cleanupIds.reservationIds.push(winner.id);

    const { data: active } = await admin
      .from('match_reservations')
      .select('id, state')
      .eq('request_id', requestId)
      .in('state', ['offered', 'accepted']);
    expect(active).toHaveLength(1);

    // Release so later tests see an eligible pool.
    await matchingRepo.declineReservation(winner.id);
  });

  it('decline releases the pair and the request can rematch', async () => {
    await setAvailablePresence(listenerA, 1);
    await setAvailablePresence(listenerB, 10);
    const { requestId } = await makeQueuedPaidRequest();
    const first = await coordinator.attemptMatch(requestId);
    expect(first.status).toBe('reserved');
    cleanupIds.reservationIds.push(first.reservationId!);
    const firstListenerId = first.listenerId!;

    // The other listener has been waiting longer; release the first via decline.
    await matchingRepo.declineReservation(first.reservationId!, firstListenerId);

    const { data: reqAfterDecline } = await admin
      .from('support_requests')
      .select('state')
      .eq('id', requestId)
      .single();
    expect((reqAfterDecline as any).state).toBe('queued');

    const rematch = await coordinator.attemptMatch(requestId);
    expect(rematch.status).toBe('reserved');
    expect(rematch.reservationId).not.toBe(first.reservationId);
    cleanupIds.reservationIds.push(rematch.reservationId!);
    await matchingRepo.declineReservation(rematch.reservationId!);
  });

  it('lazily expires a past-TTL offer and rematches; ops expiry is idempotent', async () => {
    await setAvailablePresence(listenerA, 1);
    await setAvailablePresence(listenerB, 10);
    const { requestId } = await makeQueuedPaidRequest();
    const first = await coordinator.attemptMatch(requestId);
    expect(first.status).toBe('reserved');
    cleanupIds.reservationIds.push(first.reservationId!);

    // Force the offer past its TTL (authoritative clock lives in the row).
    await admin
      .from('match_reservations')
      .update({ expires_at: new Date(Date.now() - 1000).toISOString() })
      .eq('id', first.reservationId!);

    const expiryOps = await expiryHandler(
      new NextRequest('http://localhost:3000/api/operations/reservation-expiry', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${ops.token}`,
        },
        body: JSON.stringify({ reservationId: first.reservationId }),
      })
    );
    expect(expiryOps.status).toBe(200);
    expect((await expiryOps.json()).action).toBe('expired');

    // Worker-restart/retry: a second identical invocation must be a no-op.
    const expiryAgain = await expiryHandler(
      new NextRequest('http://localhost:3000/api/operations/reservation-expiry', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${ops.token}`,
        },
        body: JSON.stringify({ reservationId: first.reservationId }),
      })
    );
    expect((await expiryAgain.json()).action).toBe('already_settled');

    const rematch = await coordinator.attemptMatch(requestId);
    expect(rematch.status).toBe('reserved');
    expect(rematch.reservationId).not.toBe(first.reservationId);
    cleanupIds.reservationIds.push(rematch.reservationId!);
    await matchingRepo.declineReservation(rematch.reservationId!);
  });

  it('never matches a blocked pair (either direction)', async () => {
    await setAvailablePresence(listenerA, 1);
    await setAvailablePresence(listenerB, 10);
    const { requestId } = await makeQueuedPaidRequest();

    const { data: block, error } = await admin
      .from('blocks')
      .insert({
        blocker_id: user.userId,
        blocked_id: listenerA.userId,
        reason_code: 'coordinator_test',
      })
      .select()
      .single();
    expect(error).toBeNull();
    cleanupIds.blockIds.push((block as any).id);

    const result = await coordinator.attemptMatch(requestId);
    expect(result.status).toBe('reserved');
    cleanupIds.reservationIds.push(result.reservationId!);
    expect(result.listenerId).toBe(listenerB.profileId);
    await matchingRepo.declineReservation(result.reservationId!);
  });

  it('returns no_candidates when no listener speaks the requested language', async () => {
    // One payment entitles exactly one request, so this request needs its own
    // captured payment rather than reusing another fixture's.
    const { data: hindiPayment, error: hindiPayErr } = await admin
      .from('payments')
      .insert({
        user_id: user.userId,
        provider: 'razorpay',
        provider_order_id: `order_coord_hindi_${Date.now()}`,
        amount_paise: 50000,
        currency: 'INR',
        state: 'captured',
        captured_at: new Date().toISOString(),
      })
      .select()
      .single();
    if (hindiPayErr || !hindiPayment) throw new Error(`hindi payment fixture: ${hindiPayErr?.message}`);
    cleanupIds.paymentIds.push((hindiPayment as any).id);

    const { data: request, error } = await admin
      .from('support_requests')
      .insert({
        user_id: user.userId,
        topic: 'Work & Career Stress',
        language: 'Hindi',
        service_tier: 'listener',
        state: 'queued',
        payment_order_id: (hindiPayment as any).id,
        queued_at: new Date().toISOString(),
        idempotency_key: `coord_hindi_${Date.now()}`,
      })
      .select()
      .single();
    cleanupIds.requestIds.push((request as any).id);
    expect(error).toBeNull();

    const result = await coordinator.attemptMatch((request as any).id);
    expect(result.status).toBe('no_candidates');
  });

  it('accept creates a session, connects the request, and rejects duplicate accepts', async () => {
    await setAvailablePresence(listenerA, 1);
    await setAvailablePresence(listenerB, 10);
    const { requestId } = await makeQueuedPaidRequest();
    const match = await coordinator.attemptMatch(requestId);
    expect(match.status).toBe('reserved');
    cleanupIds.reservationIds.push(match.reservationId!);

    // Ensure the accepting listener owns the reservation: match targets the
    // longer-waiting listener (B), so accept as that listener's user.
    const acceptingListener =
      match.listenerId === listenerA.profileId ? listenerA : listenerB;

    const res = await acceptHandler(
      new NextRequest(`http://localhost:3000/api/matches/${match.reservationId}/accept`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${acceptingListener.token}`,
        },
      }),
      { params: Promise.resolve({ id: match.reservationId! }) }
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.sessionId).toBeDefined();
    expect(body.roomName).toMatch(/^room_/);
    expect(body.requestState).toBe('connected');
    cleanupIds.sessionIds.push(body.sessionId);

    const { data: reqRow } = await admin
      .from('support_requests')
      .select('state')
      .eq('id', requestId)
      .single();
    expect((reqRow as any).state).toBe('connected');

    // R2: a retry after accept (e.g. a lost response) recovers the same session.
    const dup = await acceptHandler(
      new NextRequest(`http://localhost:3000/api/matches/${match.reservationId}/accept`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${acceptingListener.token}`,
        },
      }),
      { params: Promise.resolve({ id: match.reservationId! }) }
    );
    expect(dup.status).toBe(200);
    const dupBody = await dup.json();
    expect(dupBody.sessionId).toBe(body.sessionId);
    expect(dupBody.recovered).toBe(true);

    const { data: sessions } = await admin
      .from('sessions')
      .select('id')
      .eq('request_id', requestId);
    expect(sessions).toHaveLength(1);
  });

  it('R2: retry after accept never strands the request and yields exactly one session', async () => {
    // Isolated listener pair: earlier tests leave the shared pool reserved
    // behind accepted sessions, so this test provisions its own candidates.
    const listenerR1 = await makeListener('R2ListenerA', 1);
    const listenerR2 = await makeListener('R2ListenerB', 2);
    await setAvailablePresence(listenerR1, 1);
    await setAvailablePresence(listenerR2, 2);
    const { requestId } = await makeQueuedPaidRequest();
    const match = await coordinator.attemptMatch(requestId);
    expect(match.status).toBe('reserved');
    expect([listenerR1.profileId, listenerR2.profileId]).toContain(match.listenerId);
    cleanupIds.reservationIds.push(match.reservationId!);

    const acceptingListener =
      match.listenerId === listenerR1.profileId ? listenerR1 : listenerR2;
    const acceptBody = {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${acceptingListener.token}`,
      },
    };

    const first = await acceptHandler(
      new NextRequest(`http://localhost:3000/api/matches/${match.reservationId}/accept`, acceptBody),
      { params: Promise.resolve({ id: match.reservationId! }) }
    );
    expect(first.status).toBe(200);
    const firstBody = await first.json();
    expect(firstBody.recovered).toBe(false);
    cleanupIds.sessionIds.push(firstBody.sessionId);

    // Simulate three rapid retries (lost responses / double clicks).
    for (let attempt = 0; attempt < 3; attempt++) {
      const retry = await acceptHandler(
        new NextRequest(`http://localhost:3000/api/matches/${match.reservationId}/accept`, acceptBody),
        { params: Promise.resolve({ id: match.reservationId! }) }
      );
      expect(retry.status).toBe(200);
      const retryBody = await retry.json();
      expect(retryBody.sessionId).toBe(firstBody.sessionId);
      expect(retryBody.roomName).toBe(firstBody.roomName);
      expect(retryBody.requestState).toBe('connected');
    }

    const { data: sessions } = await admin
      .from('sessions')
      .select('id, room_name')
      .eq('request_id', requestId);
    expect(sessions).toHaveLength(1);

    const { data: reqRow } = await admin
      .from('support_requests')
      .select('state')
      .eq('id', requestId)
      .single();
    expect((reqRow as any).state).toBe('connected');
  });

  it('match route enforces ownership (403 for non-owner)', async () => {
    await setAvailablePresence(listenerA, 1);
    const { requestId } = await makeQueuedPaidRequest();

    const res = await matchHandler(
      new NextRequest(`http://localhost:3000/api/support-requests/${requestId}/match`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${listenerA.token}`,
        },
      }),
      { params: Promise.resolve({ id: requestId }) }
    );
    expect(res.status).toBe(403);

    // Verify denied call did not mutate request or create reservation
    const { data: requestRow } = await admin
      .from('support_requests')
      .select('state')
      .eq('id', requestId)
      .single();
    expect(requestRow?.state).toBe('queued');

    const { data: reservations } = await admin
      .from('match_reservations')
      .select('id')
      .eq('request_id', requestId);
    expect(reservations).toHaveLength(0);
  });
});
