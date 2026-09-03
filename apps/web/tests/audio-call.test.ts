import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { NextRequest } from 'next/server';
import { POST as tokenHandler } from '../src/app/api/sessions/[id]/token/route';
import { LiveKitService } from '../src/features/sessions/livekit-service';
import { getSupabaseAdmin, getSupabaseServerClient } from '../src/lib/supabase-server';

describe('Package 5 — Real LiveKit Audio Tokens & Privacy Guards', () => {
  const admin = getSupabaseAdmin();

  let testUserAId: string;
  let testUserAJwt: string;
  let testUserBId: string;
  let testUserBJwt: string;
  let testListenerUserId: string;
  let testListenerJwt: string;
  let testListenerProfileId: string;
  let testSessionId: string;
  const testRoomName = `room_livekit_${Date.now()}_${Math.floor(Math.random() * 10000)}`;

  beforeAll(async () => {
    // 1. Create User A (Session participant)
    const phoneA = `91${Math.floor(1000000000 + Math.random() * 9000000000)}`;
    const { data: authA, error: errA } = await admin.auth.admin.createUser({
      phone: phoneA,
      phone_confirm: true,
      password: 'Password123!',
    });
    if (errA || !authA.user) throw new Error(`authA error: ${errA?.message}`);

    const { data: uA, error: uAErr } = await admin.from('users').insert({
      auth_user_id: authA.user.id,
      handle: `AudioUserA_${Date.now()}_${Math.floor(Math.random() * 10000)}`,
      age_verified_at: new Date().toISOString(),
      status: 'active',
    } as any).select().single();
    if (uAErr || !uA) throw new Error(`uA insert error: ${uAErr?.message}`);
    testUserAId = (uA as any).id;

    const clientA = getSupabaseServerClient();
    const { data: sA } = await clientA.auth.signInWithPassword({ phone: phoneA, password: 'Password123!' });
    testUserAJwt = sA.session!.access_token;

    // 2. Create User B (Third party / bystander)
    const phoneB = `91${Math.floor(1000000000 + Math.random() * 9000000000)}`;
    const { data: authB, error: errB } = await admin.auth.admin.createUser({
      phone: phoneB,
      phone_confirm: true,
      password: 'Password123!',
    });
    if (errB || !authB.user) throw new Error(`authB error: ${errB?.message}`);

    const { data: uB, error: uBErr } = await admin.from('users').insert({
      auth_user_id: authB.user.id,
      handle: `AudioUserB_${Date.now()}_${Math.floor(Math.random() * 10000)}`,
      age_verified_at: new Date().toISOString(),
      status: 'active',
    } as any).select().single();
    if (uBErr || !uB) throw new Error(`uB insert error: ${uBErr?.message}`);
    testUserBId = (uB as any).id;

    const clientB = getSupabaseServerClient();
    const { data: sB } = await clientB.auth.signInWithPassword({ phone: phoneB, password: 'Password123!' });
    testUserBJwt = sB.session!.access_token;

    // 3. Create Listener User & Profile
    const phoneL = `91${Math.floor(1000000000 + Math.random() * 9000000000)}`;
    const { data: authL, error: errL } = await admin.auth.admin.createUser({
      phone: phoneL,
      phone_confirm: true,
      password: 'Password123!',
    });
    if (errL || !authL.user) throw new Error(`authL error: ${errL?.message}`);

    const { data: uL, error: uLErr } = await admin.from('users').insert({
      auth_user_id: authL.user.id,
      handle: `AudioListener_${Date.now()}_${Math.floor(Math.random() * 10000)}`,
      age_verified_at: new Date().toISOString(),
      status: 'active',
    } as any).select().single();
    if (uLErr || !uL) throw new Error(`uL insert error: ${uLErr?.message}`);
    testListenerUserId = (uL as any).id;

    const clientL = getSupabaseServerClient();
    const { data: sL } = await clientL.auth.signInWithPassword({ phone: phoneL, password: 'Password123!' });
    testListenerJwt = sL.session!.access_token;

    const { data: lProfile, error: lpErr } = await admin.from('listener_profiles').insert({
      user_id: testListenerUserId,
      display_name: 'Audio Listener',
      status: 'active',
      tier: 'listener',
      languages: ['English'],
      topics: ['work_stress'],
      quality_prior: 4.8,
    } as any).select().single();
    if (lpErr || !lProfile) throw new Error(`lProfile error: ${lpErr?.message}`);
    testListenerProfileId = (lProfile as any).id;

    // 4. Create support request & active session in PostgreSQL
    const { data: req, error: reqErr } = await admin.from('support_requests').insert({
      user_id: testUserAId,
      topic: 'work_stress',
      language: 'English',
      service_tier: 'listener',
      state: 'reserved',
      idempotency_key: `audio_req_${Date.now()}`,
    } as any).select().single();
    if (reqErr || !req) throw new Error(`req error: ${reqErr?.message}`);

    const { data: sess, error: sessErr } = await admin.from('sessions').insert({
      request_id: (req as any).id,
      user_id: testUserAId,
      listener_id: testListenerProfileId,
      room_name: testRoomName,
      state: 'connecting',
      started_at: new Date().toISOString(),
    } as any).select().single();
    if (sessErr || !sess) throw new Error(`sess error: ${sessErr?.message}`);
    testSessionId = (sess as any).id;
  });

  afterAll(async () => {
    await admin.from('users').delete().in('id', [testUserAId, testUserBId, testListenerUserId]);
  });

  it('unauthenticated request rejected with 401', async () => {
    const req = new NextRequest(`http://localhost:3000/api/sessions/${testSessionId}/token`, {
      method: 'POST',
    });

    const res = await tokenHandler(req, { params: Promise.resolve({ id: testSessionId }) });
    expect(res.status).toBe(401);
  });

  it('third-party user (not session participant) rejected with 403 Forbidden', async () => {
    const req = new NextRequest(`http://localhost:3000/api/sessions/${testSessionId}/token`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${testUserBJwt}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ role: 'user' }),
    });

    const res = await tokenHandler(req, { params: Promise.resolve({ id: testSessionId }) });
    expect(res.status).toBe(403);
    const data = await res.json();
    expect(data.error).toMatch(/Forbidden|not a participant/i);
  });

  it('FAIL CLOSED: returns 503 when LiveKit credentials are unconfigured', async () => {
    const oldSim = process.env.LIVEKIT_TEST_SIMULATOR;
    delete process.env.LIVEKIT_TEST_SIMULATOR;

    const req = new NextRequest(`http://localhost:3000/api/sessions/${testSessionId}/token`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${testUserAJwt}`,
        'content-type': 'application/json',
      },
    });

    const res = await tokenHandler(req, { params: Promise.resolve({ id: testSessionId }) });
    expect(res.status).toBe(503);
    const data = await res.json();
    expect(data.code).toBe('LIVEKIT_CONFIG_ERROR');

    if (oldSim) process.env.LIVEKIT_TEST_SIMULATOR = oldSim;
  });

  it('authorized user receives token bound to room with server-derived role and NO recording grants', async () => {
    process.env.LIVEKIT_TEST_SIMULATOR = 'true';

    // Client attempts to tamper by requesting role: 'listener'
    const req = new NextRequest(`http://localhost:3000/api/sessions/${testSessionId}/token`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${testUserAJwt}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ role: 'listener' }), // spoofing attempt!
    });

    const res = await tokenHandler(req, { params: Promise.resolve({ id: testSessionId }) });
    expect(res.status).toBe(200);
    const data = await res.json();

    expect(data.token).toBeDefined();
    expect(data.url).toBe('wss://sim.livekit.cloud');
    // INVARIANT: Server ignored client role: 'listener' and correctly derived 'user'!
    expect(data.participantAlias).toMatch(/^user_/);

    // Verify token claims cryptographically
    const verifier = new LiveKitService('lk_sim_key_001', 'lk_sim_secret_001_8888888888888888', 'wss://sim.livekit.cloud');
    const claims = verifier.verifyToken(data.token);

    expect(claims.video.room).toBe(testRoomName);
    expect(claims.video.canPublish).toBe(true);
    expect(claims.video.canSubscribe).toBe(true);
    expect(claims.video.canPublishData).toBe(false);

    // CRITICAL PRIVACY INVARIANT: Recording flag must strictly be false
    expect(claims.video.record).toBe(false);

    delete process.env.LIVEKIT_TEST_SIMULATOR;
  });

  it('assigned listener receives token bound to room with listener role', async () => {
    process.env.LIVEKIT_TEST_SIMULATOR = 'true';

    const req = new NextRequest(`http://localhost:3000/api/sessions/${testSessionId}/token`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${testListenerJwt}`,
        'content-type': 'application/json',
      },
    });

    const res = await tokenHandler(req, { params: Promise.resolve({ id: testSessionId }) });
    expect(res.status).toBe(200);
    const data = await res.json();

    expect(data.participantAlias).toMatch(/^listener_/);

    delete process.env.LIVEKIT_TEST_SIMULATOR;
  });
});
