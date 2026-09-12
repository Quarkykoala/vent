import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import { NextRequest } from 'next/server';
import crypto from 'node:crypto';
import {
  UserRole,
  type UserRoleType,
  SupportRequestState,
  MatchReservationState,
  ListenerPresenceState,
} from '@vent/domain';
import {
  getSupabaseAdmin,
  getSupabaseServerUrl,
  getSupabaseAnonKey,
} from '../src/lib/supabase-server';
import {
  createSupabaseClient,
  MatchingRepository,
  ListenerRepository,
  SupportRequestRepository,
} from '@vent/db';
import { MatchingCoordinator } from '../src/features/matching/coordinator';
import { POST as matchHandler } from '../src/app/api/support-requests/[id]/match/route';

interface TestActor {
  userId: string;
  authUserId: string;
  token: string;
  phone: string;
}

interface ListenerFixture extends TestActor {
  profileId: string;
}

interface StateRecord {
  id: string;
  state: string;
  [key: string]: unknown;
}

interface PresenceRow {
  listener_id: string;
  state: string;
  heartbeat_at: string;
  available_since?: string | null;
}

interface ReservationRow {
  id: string;
  request_id: string;
  listener_id: string;
  state: string;
  expires_at: string;
}

interface RequestRow {
  id: string;
  state: string;
}

interface TestAdminClient {
  auth: {
    admin: {
      createUser: (params: Record<string, unknown>) => Promise<{ data: { user: { id: string } | null }; error: Error | null }>;
      deleteUser: (id: string) => Promise<{ error: Error | null }>;
    };
  };
  from: (table: string) => {
    insert: (values: Record<string, unknown>) => {
      select: (columns?: string) => {
        single: () => Promise<{ data: Record<string, unknown> | null; error: Error | null }>;
      };
    };
    update: (values: Record<string, unknown>) => {
      eq: (col: string, val: unknown) => Promise<{ error: Error | null }>;
    };
    delete: () => {
      in: (col: string, values: string[]) => Promise<{ error: Error | null }>;
      eq: (col: string, val: string) => Promise<{ error: Error | null }>;
    };
    select: (columns?: string) => {
      eq: (col: string, val: unknown) => {
        single: () => Promise<{ data: Record<string, unknown> | null; error: Error | null }>;
        maybeSingle: () => Promise<{ data: Record<string, unknown> | null; error: Error | null }>;
        in?: (col: string, values: unknown[]) => Promise<{ data: Record<string, unknown>[] | null; error: Error | null }>;
      };
    };
  };
}

const endpoint = new URL(getSupabaseServerUrl());
if (endpoint.hostname !== '127.0.0.1' || endpoint.port !== '54321') {
  throw new Error('Matching authorization tests require the local Vent test stack (127.0.0.1:54321).');
}

const admin = getSupabaseAdmin();
const testDb = admin as unknown as TestAdminClient;
const suiteRunId = crypto.randomUUID().slice(0, 8);

describe('R1: Matching authorization regression — state and ownership invariants', () => {
  const cleanup = {
    sessionIds: [] as string[],
    reservationIds: [] as string[],
    requestIds: [] as string[],
    paymentIds: [] as string[],
    profileIds: [] as string[],
    userIds: [] as string[],
    authUserIdSet: new Set<string>(),
  };

  let owner: TestActor;
  let nonOwner: TestActor;
  let listenerRepo: ListenerRepository;
  let matchingRepo: MatchingRepository;
  let nonce = 0;

  function scenarioLanguage(scenarioKey: string): string {
    nonce += 1;
    return `AuthLang_${suiteRunId}_${scenarioKey}_${nonce}`;
  }

  async function provisionActor(role: UserRoleType, prefix: string): Promise<TestActor> {
    nonce += 1;
    const phone = `+919${Date.now().toString().slice(-6)}${Math.floor(100 + Math.random() * 900)}${nonce % 10}`;
    const password = 'Password123!';

    const { data: created, error: createErr } = await testDb.auth.admin.createUser({
      phone,
      phone_confirm: true,
      password,
      app_metadata: { role },
    });
    if (createErr || !created.user) {
      throw new Error(`Provision actor ${prefix} auth failed: ${createErr?.message}`);
    }
    const authUserId = created.user.id;
    cleanup.authUserIdSet.add(authUserId);

    const { data: userRow, error: userErr } = await testDb
      .from('users')
      .insert({
        auth_user_id: authUserId,
        handle: `${prefix}_${nonce}_${Date.now()}`,
        age_verified_at: new Date().toISOString(),
        status: 'active',
      })
      .select('id')
      .single();
    if (userErr || !userRow) {
      throw new Error(`Provision actor ${prefix} user row failed: ${userErr?.message}`);
    }
    const userId = userRow.id as string;
    cleanup.userIds.push(userId);

    const client = createSupabaseClient({
      supabaseUrl: getSupabaseServerUrl(),
      supabaseAnonKey: getSupabaseAnonKey(),
    });
    const { data: signIn, error: signInErr } = await client.auth.signInWithPassword({
      phone,
      password,
    });
    if (signInErr || !signIn.session) {
      throw new Error(`SignIn ${prefix} failed: ${signInErr?.message}`);
    }

    return {
      userId,
      authUserId,
      token: signIn.session.access_token,
      phone,
    };
  }

  async function makeFreshListener(prefix: string, language: string): Promise<ListenerFixture> {
    nonce += 1;
    const actor = await provisionActor(UserRole.LISTENER, prefix);
    const profile = await listenerRepo.createProfile({
      userId: actor.userId,
      displayName: `${prefix} ${nonce}`,
      languages: [language],
      topics: ['Work & Career Stress'],
    });
    cleanup.profileIds.push(profile.id);

    const updateRes = await testDb
      .from('listener_profiles')
      .update({
        status: 'active',
        training_expires_at: new Date(Date.now() + 90 * 24 * 3600 * 1000).toISOString(),
      })
      .eq('id', profile.id);
    if (updateRes.error) {
      throw new Error(`Update listener profile failed: ${updateRes.error.message}`);
    }

    await listenerRepo.setPresenceState(profile.id, ListenerPresenceState.AVAILABLE);

    return {
      ...actor,
      profileId: profile.id,
    };
  }

  async function createPaidRequest(userActor: TestActor, language: string): Promise<string> {
    nonce += 1;
    const { data: payment, error: payErr } = await testDb
      .from('payments')
      .insert({
        user_id: userActor.userId,
        provider: 'razorpay',
        provider_order_id: `order_auth_${nonce}_${Date.now()}`,
        amount_paise: 50000,
        currency: 'INR',
        state: 'captured',
        captured_at: new Date().toISOString(),
      })
      .select('id')
      .single();
    if (payErr || !payment) throw new Error(`Create payment failed: ${payErr?.message}`);
    const paymentId = payment.id as string;
    cleanup.paymentIds.push(paymentId);

    const { data: req, error: reqErr } = await testDb
      .from('support_requests')
      .insert({
        user_id: userActor.userId,
        topic: 'Work & Career Stress',
        language,
        service_tier: 'listener',
        state: SupportRequestState.QUEUED,
        payment_order_id: paymentId,
        queued_at: new Date().toISOString(),
        idempotency_key: `req_auth_${nonce}_${crypto.randomUUID()}`,
      })
      .select('id')
      .single();
    if (reqErr || !req) throw new Error(`Create request failed: ${reqErr?.message}`);
    const requestId = req.id as string;
    cleanup.requestIds.push(requestId);

    return requestId;
  }

  function makePostRequest(requestId: string, token?: string): NextRequest {
    const headers: Record<string, string> = {
      'content-type': 'application/json',
    };
    if (token) {
      headers.authorization = `Bearer ${token}`;
    }
    return new NextRequest(`http://localhost:3000/api/support-requests/${requestId}/match`, {
      method: 'POST',
      headers,
    });
  }

  async function getFullState(requestId: string, listenerProfileId?: string) {
    const requestRes = await testDb.from('support_requests').select('*').eq('id', requestId).maybeSingle();
    let presenceRes: { data: Record<string, unknown> | null } = { data: null };
    if (listenerProfileId) {
      presenceRes = await testDb.from('listener_presence').select('*').eq('listener_id', listenerProfileId).single();
    }

    const { data: allReservations, error: resErr } = await admin
      .from('match_reservations')
      .select('*')
      .eq('request_id', requestId);
    if (resErr) throw new Error(`Query reservations failed: ${resErr.message}`);

    const { data: allSessions, error: sessErr } = await admin
      .from('sessions')
      .select('*')
      .eq('request_id', requestId);
    if (sessErr) throw new Error(`Query sessions failed: ${sessErr.message}`);

    return {
      request: requestRes.data as StateRecord | null,
      reservations: (allReservations ?? []) as StateRecord[],
      sessions: (allSessions ?? []) as StateRecord[],
      presence: presenceRes.data as StateRecord | null,
    };
  }

  beforeAll(async () => {
    listenerRepo = new ListenerRepository(admin);
    matchingRepo = new MatchingRepository(admin);

    owner = await provisionActor(UserRole.USER, 'R1_Owner');
    nonOwner = await provisionActor(UserRole.USER, 'R1_Attacker');
  });

  afterEach(async () => {
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    const cleanupErrors: string[] = [];

    if (cleanup.sessionIds.length) {
      const res = await testDb.from('sessions').delete().in('id', cleanup.sessionIds);
      if (res.error) cleanupErrors.push(`sessions: ${res.error.message}`);
    }
    if (cleanup.reservationIds.length) {
      const res = await testDb.from('match_reservations').delete().in('id', cleanup.reservationIds);
      if (res.error) cleanupErrors.push(`match_reservations: ${res.error.message}`);
    }
    if (cleanup.requestIds.length) {
      const res1 = await testDb.from('sessions').delete().in('request_id', cleanup.requestIds);
      if (res1.error) cleanupErrors.push(`sessions by request: ${res1.error.message}`);
      const res2 = await testDb.from('match_reservations').delete().in('request_id', cleanup.requestIds);
      if (res2.error) cleanupErrors.push(`reservations by request: ${res2.error.message}`);
      const res3 = await testDb.from('support_requests').delete().in('id', cleanup.requestIds);
      if (res3.error) cleanupErrors.push(`support_requests: ${res3.error.message}`);
    }
    if (cleanup.paymentIds.length) {
      const res = await testDb.from('payments').delete().in('id', cleanup.paymentIds);
      if (res.error) cleanupErrors.push(`payments: ${res.error.message}`);
    }
    if (cleanup.profileIds.length) {
      const res1 = await testDb.from('listener_presence').delete().in('listener_id', cleanup.profileIds);
      if (res1.error) cleanupErrors.push(`listener_presence: ${res1.error.message}`);
      const res2 = await testDb.from('listener_profiles').delete().in('id', cleanup.profileIds);
      if (res2.error) cleanupErrors.push(`listener_profiles: ${res2.error.message}`);
    }
    if (cleanup.userIds.length) {
      const res = await testDb.from('users').delete().in('id', cleanup.userIds);
      if (res.error) cleanupErrors.push(`users: ${res.error.message}`);
    }
    for (const authId of cleanup.authUserIdSet) {
      const res = await testDb.auth.admin.deleteUser(authId);
      if (res.error) cleanupErrors.push(`auth user ${authId}: ${res.error.message}`);
    }

    if (cleanupErrors.length > 0) {
      console.error('Test cleanup had errors:', cleanupErrors);
      throw new Error(`Cleanup failed: ${cleanupErrors.join('; ')}`);
    }
  });

  it('criterion 1 & 5: denies a non-owner on a queued request with 403, leaving request, reservations, sessions, and listener presence unchanged without invoking coordinator', async () => {
    const lang = scenarioLanguage('crit1');
    const freshListener = await makeFreshListener('R1_L_Crit1', lang);
    const requestId = await createPaidRequest(owner, lang);

    // Verify the scenario really has an active, trained, fresh, available, eligible listener
    const profile = await listenerRepo.getProfile(freshListener.profileId);
    expect(profile).not.toBeNull();
    expect(profile?.status).toBe('active');
    expect(new Date(profile!.training_expires_at!).getTime()).toBeGreaterThan(Date.now());
    expect(profile?.languages).toContain(lang);
    expect(profile?.topics).toContain('Work & Career Stress');

    const { data: presenceCheckData, error: pCheckErr } = await admin
      .from('listener_presence')
      .select('*')
      .eq('listener_id', freshListener.profileId)
      .single();
    if (pCheckErr || !presenceCheckData) throw new Error(`Presence check failed: ${pCheckErr?.message}`);
    const presenceCheck = presenceCheckData as unknown as PresenceRow;
    expect(presenceCheck.state).toBe(ListenerPresenceState.AVAILABLE);
    expect(Date.now() - new Date(presenceCheck.heartbeat_at).getTime()).toBeLessThan(30_000);

    const beforeState = await getFullState(requestId, freshListener.profileId);
    expect(beforeState.request).not.toBeNull();
    expect(beforeState.presence).not.toBeNull();
    expect(beforeState.request?.state).toBe(SupportRequestState.QUEUED);
    expect(beforeState.reservations).toHaveLength(0);
    expect(beforeState.presence?.state).toBe(ListenerPresenceState.AVAILABLE);

    const attemptMatchSpy = vi.spyOn(MatchingCoordinator.prototype, 'attemptMatch');

    const req = makePostRequest(requestId, nonOwner.token);
    const res = await matchHandler(req, { params: Promise.resolve({ id: requestId }) });

    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toMatch(/forbidden|not the owner/i);

    // Business state must remain completely unchanged
    const afterState = await getFullState(requestId, freshListener.profileId);
    expect(afterState.request).not.toBeNull();
    expect(afterState.presence).not.toBeNull();
    expect(afterState.request?.state).toBe(SupportRequestState.QUEUED);
    expect(afterState.reservations).toHaveLength(0);
    expect(afterState.sessions).toHaveLength(0);
    expect(afterState.presence?.state).toBe(ListenerPresenceState.AVAILABLE);

    // Coordinator must NEVER be invoked on denied requests
    expect(attemptMatchSpy).not.toHaveBeenCalled();
  });

  it('criterion 2 & 5: denies a non-owner on an expired offered reservation with 403, without triggering lazy expiry, requeueing, listener release, or rematching', async () => {
    const lang = scenarioLanguage('crit2');
    const assignedListener = await makeFreshListener('R1_L_Assigned', lang);
    const standbyListener = await makeFreshListener('R1_L_Standby', lang);

    // Verify standby listener is active, trained, fresh, available, eligible candidate
    const standbyProfile = await listenerRepo.getProfile(standbyListener.profileId);
    expect(standbyProfile).not.toBeNull();
    expect(standbyProfile?.status).toBe('active');
    expect(new Date(standbyProfile!.training_expires_at!).getTime()).toBeGreaterThan(Date.now());
    expect(standbyProfile?.languages).toContain(lang);

    const { data: standbyPresenceCheckData, error: spErr } = await admin
      .from('listener_presence')
      .select('*')
      .eq('listener_id', standbyListener.profileId)
      .single();
    if (spErr || !standbyPresenceCheckData) throw new Error(`Standby presence check failed: ${spErr?.message}`);
    const standbyPresenceCheck = standbyPresenceCheckData as unknown as PresenceRow;
    expect(standbyPresenceCheck.state).toBe(ListenerPresenceState.AVAILABLE);
    expect(Date.now() - new Date(standbyPresenceCheck.heartbeat_at).getTime()).toBeLessThan(30_000);

    const requestId = await createPaidRequest(owner, lang);

    // Create an active reservation for the owner's request
    const reservation = await matchingRepo.createReservation({
      requestId,
      listenerId: assignedListener.profileId,
      score: 0.95,
      scoreComponents: {
        languageScore: 1.0,
        topicScore: 1.0,
        waitFairness: 0.8,
        bayesianQuality: 0.9,
        repeatAffinity: 0.0,
        loadBalance: 1.0,
      },
      expiresInSeconds: 45,
    });
    cleanup.reservationIds.push(reservation.id);

    // Manually set expires_at to 5 minutes in the past without using sleeps
    const pastExpiresAt = new Date(Date.now() - 300_000).toISOString();
    const updateRes = await testDb
      .from('match_reservations')
      .update({ expires_at: pastExpiresAt })
      .eq('id', reservation.id);
    if (updateRes.error) throw new Error(`Update reservation expiry failed: ${updateRes.error.message}`);

    // Read back and verify the expired offered reservation exists before the route call
    const { data: readBackResData, error: rbErr } = await admin
      .from('match_reservations')
      .select('*')
      .eq('id', reservation.id)
      .single();
    if (rbErr || !readBackResData) throw new Error(`Read back reservation failed: ${rbErr?.message}`);
    const readBackRes = readBackResData as unknown as ReservationRow;
    expect(readBackRes.state).toBe(MatchReservationState.OFFERED);
    expect(new Date(readBackRes.expires_at).getTime()).toBeLessThan(Date.now());

    const beforeState = await getFullState(requestId, assignedListener.profileId);
    expect(beforeState.request).not.toBeNull();
    expect(beforeState.presence).not.toBeNull();
    expect(beforeState.request?.state).toBe(SupportRequestState.RESERVED);
    expect(beforeState.reservations).toHaveLength(1);
    expect(beforeState.reservations[0].id).toBe(reservation.id);
    expect(beforeState.reservations[0].state).toBe(MatchReservationState.OFFERED);
    expect(beforeState.presence?.state).toBe(ListenerPresenceState.RESERVED);

    const attemptMatchSpy = vi.spyOn(MatchingCoordinator.prototype, 'attemptMatch');

    // Non-owner attempts to trigger matching/rematching on the expired offer
    const req = makePostRequest(requestId, nonOwner.token);
    const res = await matchHandler(req, { params: Promise.resolve({ id: requestId }) });

    expect(res.status).toBe(403);

    // Business state must remain untouched:
    // Reservation MUST still be offered (not expired), request still reserved (not requeued), listener still reserved (not released)
    const afterState = await getFullState(requestId, assignedListener.profileId);
    expect(afterState.request).not.toBeNull();
    expect(afterState.presence).not.toBeNull();
    expect(afterState.request?.state).toBe(SupportRequestState.RESERVED);
    expect(afterState.reservations).toHaveLength(1);
    expect(afterState.reservations[0].id).toBe(reservation.id);
    expect(afterState.reservations[0].state).toBe(MatchReservationState.OFFERED);
    expect(afterState.presence?.state).toBe(ListenerPresenceState.RESERVED);

    // Standby listener must remain available (never matched)
    const { data: standbyPresenceData, error: sErr } = await admin
      .from('listener_presence')
      .select('state')
      .eq('listener_id', standbyListener.profileId)
      .single();
    if (sErr || !standbyPresenceData) throw new Error(`Query standby presence failed: ${sErr?.message}`);
    const standbyPresence = standbyPresenceData as unknown as PresenceRow;
    expect(standbyPresence.state).toBe(ListenerPresenceState.AVAILABLE);

    // Coordinator must not have been invoked
    expect(attemptMatchSpy).not.toHaveBeenCalled();
  });

  it('criterion 3 & 5: returns 401 on missing or invalid authentication without invoking coordinator', async () => {
    const lang = scenarioLanguage('crit3_auth');
    const requestId = await createPaidRequest(owner, lang);
    const attemptMatchSpy = vi.spyOn(MatchingCoordinator.prototype, 'attemptMatch');

    // Case A: Missing authorization header
    const missingAuthReq = makePostRequest(requestId);
    const missingAuthRes = await matchHandler(missingAuthReq, {
      params: Promise.resolve({ id: requestId }),
    });
    expect(missingAuthRes.status).toBe(401);
    expect(attemptMatchSpy).not.toHaveBeenCalled();

    // Case B: Invalid bearer token
    const invalidAuthReq = makePostRequest(requestId, 'invalid.jwt.token');
    const invalidAuthRes = await matchHandler(invalidAuthReq, {
      params: Promise.resolve({ id: requestId }),
    });
    expect(invalidAuthRes.status).toBe(401);
    expect(attemptMatchSpy).not.toHaveBeenCalled();

    // Persisted state must be untouched
    const afterState = await getFullState(requestId);
    expect(afterState.request).not.toBeNull();
    expect(afterState.request?.state).toBe(SupportRequestState.QUEUED);
    expect(afterState.reservations).toHaveLength(0);
  });

  it('criterion 3 & 5: returns 404 for nonexistent support request without invoking coordinator', async () => {
    const nonExistentId = crypto.randomUUID();
    const attemptMatchSpy = vi.spyOn(MatchingCoordinator.prototype, 'attemptMatch');

    const req = makePostRequest(nonExistentId, owner.token);
    const res = await matchHandler(req, { params: Promise.resolve({ id: nonExistentId }) });

    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toMatch(/not found/i);
    expect(attemptMatchSpy).not.toHaveBeenCalled();
  });

  it('criterion 3 & 5: returns controlled 500 on ownership lookup failure without invoking matching or leaking DB error details', async () => {
    const lang = scenarioLanguage('crit3_err');
    const requestId = await createPaidRequest(owner, lang);
    const attemptMatchSpy = vi.spyOn(MatchingCoordinator.prototype, 'attemptMatch');

    // Controlled database-boundary failure injection during support request lookup
    const lookupSpy = vi
      .spyOn(SupportRequestRepository.prototype, 'findById')
      .mockRejectedValueOnce(
        new Error('relation "secret_table" failure: user=postgres password=secret_password connection reset')
      );

    const req = makePostRequest(requestId, owner.token);
    const res = await matchHandler(req, { params: Promise.resolve({ id: requestId }) });

    expect(res.status).toBe(500);
    const body = await res.json();
    // Must be a controlled error message that does NOT expose raw provider details or internal query text
    expect(body.error).toBeDefined();
    expect(body.error).not.toMatch(/secret_table|password|postgres/i);
    expect(attemptMatchSpy).not.toHaveBeenCalled();

    lookupSpy.mockRestore();
  });

  it('criterion 4 & 5: legitimate owner matches queued request, repeating while offer active produces no duplicate, and authorized lazy expiry rematches', async () => {
    const lang = scenarioLanguage('crit4_owner');
    const listener1 = await makeFreshListener('R1_L_Owner1', lang);
    const listener2 = await makeFreshListener('R1_L_Owner2', lang);
    const scenarioListenerIds = new Set([listener1.profileId, listener2.profileId]);

    const requestId = await createPaidRequest(owner, lang);
    const attemptMatchSpy = vi.spyOn(MatchingCoordinator.prototype, 'attemptMatch');

    // 1. Initial match by legitimate owner
    const req1 = makePostRequest(requestId, owner.token);
    const res1 = await matchHandler(req1, { params: Promise.resolve({ id: requestId }) });

    expect(res1.status).toBe(201);
    const body1 = await res1.json();
    expect(body1.status).toBe('reserved');
    expect(body1.reservationId).toBeDefined();
    expect(body1.listenerId).toBeDefined();
    expect(scenarioListenerIds.has(body1.listenerId)).toBe(true);
    cleanup.reservationIds.push(body1.reservationId);

    const state1 = await getFullState(requestId, body1.listenerId);
    expect(state1.request).not.toBeNull();
    expect(state1.presence).not.toBeNull();
    expect(state1.request?.state).toBe(SupportRequestState.RESERVED);
    expect(state1.reservations).toHaveLength(1);
    expect(state1.reservations[0].id).toBe(body1.reservationId);
    expect(state1.reservations[0].state).toBe(MatchReservationState.OFFERED);
    expect(state1.presence?.state).toBe(ListenerPresenceState.RESERVED);
    expect(attemptMatchSpy).toHaveBeenCalledTimes(1);

    // 2. Repeat request while offer is active: returns offer_pending, NO new reservation created
    const req2 = makePostRequest(requestId, owner.token);
    const res2 = await matchHandler(req2, { params: Promise.resolve({ id: requestId }) });

    expect(res2.status).toBe(200);
    const body2 = await res2.json();
    expect(body2.status).toBe('offer_pending');
    expect(body2.reservationId).toBe(body1.reservationId);

    const state2 = await getFullState(requestId, body1.listenerId);
    expect(state2.reservations).toHaveLength(1); // Still exactly one reservation
    expect(state2.reservations[0].id).toBe(body1.reservationId);

    // 3. Force expiry in fixture: set active reservation expires_at to past without sleeps
    const pastExpiresAt = new Date(Date.now() - 300_000).toISOString();
    const updateRes = await testDb
      .from('match_reservations')
      .update({ expires_at: pastExpiresAt })
      .eq('id', body1.reservationId);
    if (updateRes.error) throw new Error(`Update reservation expiry failed: ${updateRes.error.message}`);

    // Read back and verify the offered reservation has expired timestamp before next route call
    const { data: readBackResData, error: rbErr } = await admin
      .from('match_reservations')
      .select('*')
      .eq('id', body1.reservationId)
      .single();
    if (rbErr || !readBackResData) throw new Error(`Read back reservation failed: ${rbErr?.message}`);
    const readBackRes = readBackResData as unknown as ReservationRow;
    expect(readBackRes.state).toBe(MatchReservationState.OFFERED);
    expect(new Date(readBackRes.expires_at).getTime()).toBeLessThan(Date.now());

    // 4. Owner polls after expiry: authorized lazy expiry triggers, expiring first offer and creating replacement match
    const req3 = makePostRequest(requestId, owner.token);
    const res3 = await matchHandler(req3, { params: Promise.resolve({ id: requestId }) });

    // Strict G2 expectation: MUST be 201 'reserved', producing a NEW reservation ID and reserving an eligible scenario listener
    expect(res3.status).toBe(201);
    const body3 = await res3.json();
    expect(body3.status).toBe('reserved');
    expect(body3.reservationId).toBeDefined();
    expect(body3.reservationId).not.toBe(body1.reservationId);
    expect(body3.listenerId).toBeDefined();
    expect(scenarioListenerIds.has(body3.listenerId)).toBe(true);
    cleanup.reservationIds.push(body3.reservationId);

    // Persisted state expectations:
    // - exactly two reservations for this fresh request
    // - old reservation is EXPIRED
    // - exactly one actively OFFERED reservation (the new one)
    // - request is RESERVED
    // - newly selected listener is RESERVED
    const { data: allResData, error: allResErr } = await admin
      .from('match_reservations')
      .select('*')
      .eq('request_id', requestId);
    if (allResErr || !allResData) throw new Error(`Query reservations failed: ${allResErr?.message}`);
    const allRes = allResData as unknown as ReservationRow[];
    expect(allRes).toHaveLength(2);

    const oldOffer = allRes.find((r) => r.id === body1.reservationId);
    expect(oldOffer).toBeDefined();
    expect(oldOffer?.state).toBe(MatchReservationState.EXPIRED);

    const activeOffers = allRes.filter((r) => r.state === MatchReservationState.OFFERED);
    expect(activeOffers).toHaveLength(1);
    expect(activeOffers[0].id).toBe(body3.reservationId);

    const { data: reqRowData, error: reqErr } = await admin
      .from('support_requests')
      .select('state')
      .eq('id', requestId)
      .single();
    if (reqErr || !reqRowData) throw new Error(`Query request failed: ${reqErr?.message}`);
    const reqRow = reqRowData as unknown as RequestRow;
    expect(reqRow.state).toBe(SupportRequestState.RESERVED);

    const { data: newPresenceData, error: npErr } = await admin
      .from('listener_presence')
      .select('state')
      .eq('listener_id', body3.listenerId)
      .single();
    if (npErr || !newPresenceData) throw new Error(`Query new presence failed: ${npErr?.message}`);
    const newPresence = newPresenceData as unknown as PresenceRow;
    expect(newPresence.state).toBe(ListenerPresenceState.RESERVED);
  });
});
