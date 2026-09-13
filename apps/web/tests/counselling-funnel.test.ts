import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { NextRequest } from 'next/server';
import { POST as createReferralHandler } from '../src/app/api/counselling/referral/route';
import { POST as respondReferralHandler } from '../src/app/api/counselling/referral/[id]/respond/route';
import { POST as transferReferralHandler } from '../src/app/api/counselling/referral/[id]/transfer/route';
import { UserRole } from '@vent/domain';
import { getSupabaseAdmin, getSupabaseServerClient } from '../src/lib/supabase-server';

describe('Package 9 — Counselling Funnel, Partner Transfer & Consent Invariants', () => {
  const admin = getSupabaseAdmin();

  let userAId: string;
  let userAJwt: string;
  let userBId: string;
  let userBJwt: string;
  let listenerUserId: string;
  let listenerJwt: string;
  let listenerProfileId: string;
  let partnerId: string;
  let sessionId: string;

  beforeAll(async () => {
    // 1. Create User A (Participant)
    const phoneA = `91${Math.floor(1000000000 + Math.random() * 9000000000)}`;
    const { data: authA } = await admin.auth.admin.createUser({
      phone: phoneA,
      phone_confirm: true,
      password: 'Password123!',
      app_metadata: { role: UserRole.USER },
    });
    const { data: uA } = await admin.from('users').insert({
      auth_user_id: authA.user!.id,
      handle: `CounsUserA_${Date.now()}_${Math.floor(Math.random() * 10000)}`,
      age_verified_at: new Date().toISOString(),
      status: 'active',
    } as any).select().single();
    userAId = (uA as any).id;

    const clientA = getSupabaseServerClient();
    const { data: sA } = await clientA.auth.signInWithPassword({ phone: phoneA, password: 'Password123!' });
    userAJwt = sA.session!.access_token;

    // 2. Create User B (Third party)
    const phoneB = `91${Math.floor(1000000000 + Math.random() * 9000000000)}`;
    const { data: authB } = await admin.auth.admin.createUser({
      phone: phoneB,
      phone_confirm: true,
      password: 'Password123!',
      app_metadata: { role: UserRole.USER },
    });
    const { data: uB } = await admin.from('users').insert({
      auth_user_id: authB.user!.id,
      handle: `CounsUserB_${Date.now()}_${Math.floor(Math.random() * 10000)}`,
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
      app_metadata: { role: UserRole.LISTENER },
    });
    const { data: uL } = await admin.from('users').insert({
      auth_user_id: authL.user!.id,
      handle: `CounsListener_${Date.now()}_${Math.floor(Math.random() * 10000)}`,
      age_verified_at: new Date().toISOString(),
      status: 'active',
    } as any).select().single();
    listenerUserId = (uL as any).id;

    const clientL = getSupabaseServerClient();
    const { data: sL } = await clientL.auth.signInWithPassword({ phone: phoneL, password: 'Password123!' });
    listenerJwt = sL.session!.access_token;

    const { data: lp } = await admin.from('listener_profiles').insert({
      user_id: listenerUserId,
      display_name: 'Regular Listener',
      status: 'active',
      tier: 'listener', // not counsellor tier!
      languages: ['English'],
      topics: ['work_stress'],
      quality_prior: 4.5,
    } as any).select().single();
    listenerProfileId = (lp as any).id;

    // 4. Create Active Licensed Partner
    const { data: part } = await (admin.from('counselling_partners' as any) as any).insert({
      name: 'Vandrevala Foundation',
      license_number: 'LIC-VF-2026-IND',
      status: 'active',
      contact_email: 'partners@vandrevalafoundation.org',
    }).select().single();
    partnerId = (part as any).id;

    // 5. Create session
    const { data: req } = await admin.from('support_requests').insert({
      user_id: userAId,
      topic: 'work_stress',
      language: 'English',
      service_tier: 'listener',
      state: 'completed',
      idempotency_key: `couns_req_${Date.now()}`,
    } as any).select().single();

    const { data: sess } = await admin.from('sessions').insert({
      request_id: (req as any).id,
      user_id: userAId,
      listener_id: listenerProfileId,
      room_name: `room_couns_${Date.now()}`,
      state: 'ended',
      started_at: new Date(Date.now() - 300000).toISOString(),
      ended_at: new Date().toISOString(),
    } as any).select().single();
    sessionId = (sess as any).id;
  });

  afterAll(async () => {
    await admin.from('users').delete().in('id', [userAId, userBId, listenerUserId]);
    await admin.from('counselling_partners' as any).delete().eq('id', partnerId);
  });

  it('referral created and persisted in PostgreSQL without transcript or clinical notes', async () => {
    const req = new NextRequest('http://localhost:3000/api/counselling/referral', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${userAJwt}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        sessionId,
        category: 'grief_support',
        partnerId,
      }),
    });

    const res = await createReferralHandler(req);
    expect(res.status).toBe(201);
    const data = await res.json();

    expect(data.referralId).toBeDefined();
    expect(data.state).toBe('offered');
    expect(data.isNonDiagnostic).toBe(true);

    // Verify row in PostgreSQL
    const { data: dbRef } = await admin.from('counselling_referrals' as any).select('*').eq('id', data.referralId).single();
    expect(dbRef).toBeDefined();
    expect((dbRef as any).state).toBe('offered');
    expect((dbRef as any).user_consented).toBe(false);
    expect((dbRef as any).category).toBe('grief_support');
  });

  it('rejects clinical/medical diagnostic category outside non-diagnostic scope with 400', async () => {
    const req = new NextRequest('http://localhost:3000/api/counselling/referral', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${listenerJwt}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        sessionId,
        category: 'clinical_evaluation',
      }),
    });

    const res = await createReferralHandler(req);
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toMatch(/Invalid referral input/i);
  });

  it('STRICT INVARIANT: Partner transfer requires prior explicit user consent', async () => {
    // 1. Create a fresh offered referral
    const { data: freshRef } = await (admin.from('counselling_referrals' as any) as any).insert({
      session_id: sessionId,
      user_id: userAId,
      referred_by_listener_id: listenerProfileId,
      partner_id: partnerId,
      category: 'stress_management',
      state: 'offered',
      user_consented: false,
    }).select().single();
    const refId = (freshRef as any).id;

    // 2. ATTEMPT TRANSFER BEFORE USER CONSENT -> REJECTED!
    const transferBeforeReq = new NextRequest(`http://localhost:3000/api/counselling/referral/${refId}/transfer`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${userAJwt}`,
      },
    });

    const transferBeforeRes = await transferReferralHandler(transferBeforeReq, { params: Promise.resolve({ id: refId }) });
    expect(transferBeforeRes.status).toBe(400);
    const errData = await transferBeforeRes.json();
    expect(errData.code).toBe('USER_CONSENT_REQUIRED');

    // 3. User responds with explicit consent
    const respondReq = new NextRequest(`http://localhost:3000/api/counselling/referral/${refId}/respond`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${userAJwt}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        response: 'accepted',
        consentedContact: '+919876543210',
      }),
    });

    const respondRes = await respondReferralHandler(respondReq, { params: Promise.resolve({ id: refId }) });
    expect(respondRes.status).toBe(200);
    const respondData = await respondRes.json();
    expect(respondData.state).toBe('accepted');
    expect(respondData.userConsented).toBe(true);

    // 4. NOW Transfer succeeds with minimal necessary payload
    const transferAfterReq = new NextRequest(`http://localhost:3000/api/counselling/referral/${refId}/transfer`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${userAJwt}`,
      },
    });

    const transferAfterRes = await transferReferralHandler(transferAfterReq, { params: Promise.resolve({ id: refId }) });
    expect(transferAfterRes.status).toBe(200);
    const transferData = await transferAfterRes.json();
    expect(transferData.state).toBe('transferred');
    expect(transferData.partnerPayload.consentedContact).toBe('+919876543210');
    expect(transferData.partnerPayload.category).toBe('stress_management');
  });

  it('rejects unauthorized user B from accepting user A’s referral with 403', async () => {
    const { data: ref } = await admin.from('counselling_referrals' as any).select('id').eq('user_id', userAId).limit(1).single();

    const badReq = new NextRequest(`http://localhost:3000/api/counselling/referral/${(ref as any).id}/respond`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${userBJwt}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        response: 'accepted',
      }),
    });

    const badRes = await respondReferralHandler(badReq, { params: Promise.resolve({ id: (ref as any).id }) });
    expect(badRes.status).toBe(403);
  });
});
