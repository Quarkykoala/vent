import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { NextRequest } from 'next/server';
import { POST as endSessionHandler } from '../src/app/api/sessions/[id]/end/route';
import { POST as rateSessionHandler } from '../src/app/api/sessions/[id]/rating/route';
import { POST as blockHandler } from '../src/app/api/blocks/route';
import { MatchingRepository } from '@vent/db';
import { getSupabaseAdmin, getSupabaseServerClient } from '../src/lib/supabase-server';

describe('Package 6 — Session Completion, Bayesian Ratings & Blocks', () => {
  const admin = getSupabaseAdmin();
  const matchingRepo = new MatchingRepository(admin);

  let userAId: string;
  let userAJwt: string;
  let userBId: string;
  let userBJwt: string;
  let listenerUserId: string;
  let listenerJwt: string;
  let listenerProfileId: string;

  beforeAll(async () => {
    // 1. Create User A
    const phoneA = `91${Math.floor(1000000000 + Math.random() * 9000000000)}`;
    const { data: authA } = await admin.auth.admin.createUser({
      phone: phoneA,
      phone_confirm: true,
      password: 'Password123!',
    });
    const { data: uA } = await admin.from('users').insert({
      auth_user_id: authA.user!.id,
      handle: `RatingUserA_${Date.now()}_${Math.floor(Math.random() * 10000)}`,
      age_verified_at: new Date().toISOString(),
      status: 'active',
    } as any).select().single();
    userAId = (uA as any).id;

    const clientA = getSupabaseServerClient();
    const { data: sA } = await clientA.auth.signInWithPassword({ phone: phoneA, password: 'Password123!' });
    userAJwt = sA.session!.access_token;

    // 2. Create User B
    const phoneB = `91${Math.floor(1000000000 + Math.random() * 9000000000)}`;
    const { data: authB } = await admin.auth.admin.createUser({
      phone: phoneB,
      phone_confirm: true,
      password: 'Password123!',
    });
    const { data: uB } = await admin.from('users').insert({
      auth_user_id: authB.user!.id,
      handle: `RatingUserB_${Date.now()}_${Math.floor(Math.random() * 10000)}`,
      age_verified_at: new Date().toISOString(),
      status: 'active',
    } as any).select().single();
    userBId = (uB as any).id;

    const clientB = getSupabaseServerClient();
    const { data: sB } = await clientB.auth.signInWithPassword({ phone: phoneB, password: 'Password123!' });
    userBJwt = sB.session!.access_token;

    // 3. Create Listener
    const phoneL = `91${Math.floor(1000000000 + Math.random() * 9000000000)}`;
    const { data: authL } = await admin.auth.admin.createUser({
      phone: phoneL,
      phone_confirm: true,
      password: 'Password123!',
    });
    const { data: uL } = await admin.from('users').insert({
      auth_user_id: authL.user!.id,
      handle: `RatingListener_${Date.now()}_${Math.floor(Math.random() * 10000)}`,
      age_verified_at: new Date().toISOString(),
      status: 'active',
    } as any).select().single();
    listenerUserId = (uL as any).id;

    const clientL = getSupabaseServerClient();
    const { data: sL } = await clientL.auth.signInWithPassword({ phone: phoneL, password: 'Password123!' });
    listenerJwt = sL.session!.access_token;

    const { data: lp } = await admin.from('listener_profiles').insert({
      user_id: listenerUserId,
      display_name: 'Rating Listener',
      status: 'active',
      tier: 'listener',
      languages: ['English'],
      topics: ['work_stress'],
      quality_prior: 4.5,
    } as any).select().single();
    listenerProfileId = (lp as any).id;

    await (admin.from('listener_presence') as any).upsert({
      listener_id: listenerProfileId,
      state: 'in_session',
      heartbeat_at: new Date().toISOString(),
    });
  });

  afterAll(async () => {
    await admin.from('users').delete().in('id', [userAId, userBId, listenerUserId]);
  });

  it('session completion atomically updates DB state, sets duration, and frees listener presence', async () => {
    // 1. Create support request & active session
    const { data: req } = await admin.from('support_requests').insert({
      user_id: userAId,
      topic: 'work_stress',
      language: 'English',
      service_tier: 'listener',
      state: 'reserved',
      idempotency_key: `complete_req_${Date.now()}`,
    } as any).select().single();

    const startTime = new Date(Date.now() - 120000).toISOString(); // 2 minutes ago
    const { data: sess } = await admin.from('sessions').insert({
      request_id: (req as any).id,
      user_id: userAId,
      listener_id: listenerProfileId,
      room_name: `room_comp_${Date.now()}`,
      state: 'active',
      started_at: startTime,
    } as any).select().single();
    const sessionId = (sess as any).id;

    // Call /api/sessions/[id]/end
    const endReq = new NextRequest(`http://localhost:3000/api/sessions/${sessionId}/end`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${userAJwt}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ reason: 'normal_completion' }),
    });

    const endRes = await endSessionHandler(endReq, { params: Promise.resolve({ id: sessionId }) });
    expect(endRes.status).toBe(200);
    const endData = await endRes.json();
    expect(endData.state).toBe('ended');
    expect(endData.durationSeconds).toBeGreaterThanOrEqual(118);

    // Verify session in Postgres
    const { data: dbSess } = await admin.from('sessions').select('*').eq('id', sessionId).single();
    expect((dbSess as any).state).toBe('ended');
    expect((dbSess as any).ended_at).toBeDefined();

    // Verify support request transitioned to completed
    const { data: dbReq } = await admin.from('support_requests').select('*').eq('id', (req as any).id).single();
    expect((dbReq as any).state).toBe('completed');

    // Verify listener presence freed to available
    const { data: dbPresence } = await admin.from('listener_presence').select('*').eq('listener_id', listenerProfileId).single();
    expect((dbPresence as any).state).toBe('available');
  });

  it('rejects rating someone else’s session with 403 Forbidden', async () => {
    // Create an ended session for User A
    const { data: req } = await admin.from('support_requests').insert({
      user_id: userAId,
      topic: 'work_stress',
      language: 'English',
      service_tier: 'listener',
      state: 'completed',
      idempotency_key: `rate_forbidden_req_${Date.now()}`,
    } as any).select().single();

    const { data: sess } = await admin.from('sessions').insert({
      request_id: (req as any).id,
      user_id: userAId,
      listener_id: listenerProfileId,
      room_name: `room_forbid_${Date.now()}`,
      state: 'ended',
      started_at: new Date(Date.now() - 60000).toISOString(),
      ended_at: new Date().toISOString(),
    } as any).select().single();

    // User B attempts to rate User A's session
    const rateReq = new NextRequest(`http://localhost:3000/api/sessions/${(sess as any).id}/rating`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${userBJwt}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        stars: 5,
        reasonTags: ['great_listener'],
        blockListener: false,
      }),
    });

    const res = await rateSessionHandler(rateReq, { params: Promise.resolve({ id: (sess as any).id }) });
    expect(res.status).toBe(403);
    const data = await res.json();
    expect(data.error).toMatch(/Forbidden|Only the user/i);
  });

  it('rejects rating an unended session with 400', async () => {
    // Create active session
    const { data: req } = await admin.from('support_requests').insert({
      user_id: userAId,
      topic: 'work_stress',
      language: 'English',
      service_tier: 'listener',
      state: 'reserved',
      idempotency_key: `unended_req_${Date.now()}`,
    } as any).select().single();

    const { data: sess } = await admin.from('sessions').insert({
      request_id: (req as any).id,
      user_id: userAId,
      listener_id: listenerProfileId,
      room_name: `room_unended_${Date.now()}`,
      state: 'active',
      started_at: new Date().toISOString(),
    } as any).select().single();

    const rateReq = new NextRequest(`http://localhost:3000/api/sessions/${(sess as any).id}/rating`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${userAJwt}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        stars: 5,
        reasonTags: ['great_listener'],
        blockListener: false,
      }),
    });

    const res = await rateSessionHandler(rateReq, { params: Promise.resolve({ id: (sess as any).id }) });
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toMatch(/Session must be ended/i);
  });

  it('submitting rating updates listener Bayesian quality score in Postgres', async () => {
    // 1. Create ended session
    const { data: req } = await admin.from('support_requests').insert({
      user_id: userAId,
      topic: 'work_stress',
      language: 'English',
      service_tier: 'listener',
      state: 'completed',
      idempotency_key: `rate_success_req_${Date.now()}`,
    } as any).select().single();

    const { data: sess } = await admin.from('sessions').insert({
      request_id: (req as any).id,
      user_id: userAId,
      listener_id: listenerProfileId,
      room_name: `room_success_${Date.now()}`,
      state: 'ended',
      started_at: new Date(Date.now() - 300000).toISOString(),
      ended_at: new Date().toISOString(),
    } as any).select().single();
    const sessionId = (sess as any).id;

    // Reset listener quality_prior to exactly 4.5
    await (admin.from('listener_profiles') as any).update({ quality_prior: 4.5 }).eq('id', listenerProfileId);

    // Submit 5-star rating
    const rateReq = new NextRequest(`http://localhost:3000/api/sessions/${sessionId}/rating`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${userAJwt}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        stars: 5,
        reasonTags: ['great_listener', 'felt_heard'],
        blockListener: false,
      }),
    });

    const res = await rateSessionHandler(rateReq, { params: Promise.resolve({ id: sessionId }) });
    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data.stars).toBe(5);
    expect(data.updatedBayesianQuality).toBeDefined();

    // Verify updated in Postgres: (20 * 4.5 + 5.0) / 21 = 95 / 21 ≈ 4.52
    const { data: lp } = await admin.from('listener_profiles').select('quality_prior').eq('id', listenerProfileId).single();
    expect(Number((lp as any).quality_prior)).toBe(4.52);
  });

  it('rejects duplicate rating on the same session with 409 Conflict', async () => {
    // Find the session we just rated in previous test
    const { data: existingRating } = await admin.from('ratings').select('session_id').limit(1).single();
    const ratedSessionId = (existingRating as any).session_id;

    const rateReq = new NextRequest(`http://localhost:3000/api/sessions/${ratedSessionId}/rating`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${userAJwt}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        stars: 5,
        reasonTags: ['great_listener'],
        blockListener: false,
      }),
    });

    const res = await rateSessionHandler(rateReq, { params: Promise.resolve({ id: ratedSessionId }) });
    expect(res.status).toBe(409);
    const data = await res.json();
    expect(data.error).toMatch(/duplicate ratings prohibited|already been rated/i);
  });

  it('block mutation bidirectionally excludes the pair from future matching', async () => {
    // User B blocks Listener User
    const blockReq = new NextRequest('http://localhost:3000/api/blocks', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${userBJwt}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        blockedId: listenerUserId,
        reasonCode: 'harassment',
      }),
    });

    const blockRes = await blockHandler(blockReq);
    expect(blockRes.status).toBe(201);

    // Ensure listener is available with fresh heartbeat
    await (admin.from('listener_presence') as any).update({
      state: 'available',
      heartbeat_at: new Date().toISOString(),
      current_reservation_id: null,
    }).eq('listener_id', listenerProfileId);

    // Create a support request for User B
    const { data: req } = await admin.from('support_requests').insert({
      user_id: userBId,
      topic: 'work_stress',
      language: 'English',
      service_tier: 'listener',
      state: 'queued',
      idempotency_key: `block_match_test_${Date.now()}`,
    } as any).select().single();

    // INVARIANT: Matching transaction MUST reject match due to block constraint!
    await expect(
      matchingRepo.createReservation({
        requestId: (req as any).id,
        listenerId: listenerProfileId,
        score: 0.9,
        scoreComponents: {
          languageScore: 1.0,
          topicScore: 1.0,
          waitFairness: 0.5,
          bayesianQuality: 4.5,
          repeatAffinity: 0,
          loadBalance: 1.0,
        },
      })
    ).rejects.toThrow(/user block constraint/i);
  });
});
