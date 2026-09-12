import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { NextRequest } from 'next/server';
import crypto from 'node:crypto';
import { POST as createCaseHandler } from '../src/app/api/safety-cases/route';
import { POST as acknowledgeCaseHandler } from '../src/app/api/safety-cases/[id]/acknowledge/route';
import { POST as resolveCaseHandler } from '../src/app/api/safety-cases/[id]/resolve/route';
import { UserRole } from '@vent/domain';
import { getSupabaseAdmin, getSupabaseServerClient } from '../src/lib/supabase-server';

describe('Package 7 — Real Safety System Hardening & Audit Logging', () => {
  const admin = getSupabaseAdmin();

  let testUserId: string;
  let testUserJwt: string;
  let testListenerUserId: string;
  let testListenerJwt: string;
  let testListenerProfileId: string;
  let testSupervisorUserId: string;
  let testSupervisorJwt: string;
  let testSessionId: string;
  let testSupportRequestId: string;

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
      handle: `SafetyUser_${Date.now()}_${Math.floor(Math.random() * 10000)}`,
      age_verified_at: new Date().toISOString(),
      status: 'active',
    } as any).select().single();
    testUserId = (u as any).id;

    const clientU = getSupabaseServerClient();
    const { data: sU } = await clientU.auth.signInWithPassword({ phone: phoneU, password: 'Password123!' });
    testUserJwt = sU.session!.access_token;

    // 2. Create Listener
    const phoneL = `91${Math.floor(1000000000 + Math.random() * 9000000000)}`;
    const { data: authL } = await admin.auth.admin.createUser({
      phone: phoneL,
      phone_confirm: true,
      password: 'Password123!',
      app_metadata: { role: UserRole.LISTENER },
    });
    const { data: uL } = await admin.from('users').insert({
      auth_user_id: authL.user!.id,
      handle: `SafetyListener_${Date.now()}_${Math.floor(Math.random() * 10000)}`,
      age_verified_at: new Date().toISOString(),
      status: 'active',
    } as any).select().single();
    testListenerUserId = (uL as any).id;

    const clientL = getSupabaseServerClient();
    const { data: sL } = await clientL.auth.signInWithPassword({ phone: phoneL, password: 'Password123!' });
    testListenerJwt = sL.session!.access_token;

    const { data: lp } = await admin.from('listener_profiles').insert({
      user_id: testListenerUserId,
      display_name: 'Safety Listener',
      status: 'active',
      tier: 'listener',
      languages: ['English'],
      topics: ['work_stress'],
      quality_prior: 4.5,
    } as any).select().single();
    testListenerProfileId = (lp as any).id;

    await (admin.from('listener_presence') as any).upsert({
      listener_id: testListenerProfileId,
      state: 'in_session',
      heartbeat_at: new Date().toISOString(),
    });

    // 3. Create Clinical Supervisor
    const phoneSup = `91${Math.floor(1000000000 + Math.random() * 9000000000)}`;
    const { data: authSup } = await admin.auth.admin.createUser({
      phone: phoneSup,
      phone_confirm: true,
      password: 'Password123!',
      app_metadata: { role: UserRole.CLINICAL_SUPERVISOR },
    });
    const { data: uSup } = await admin.from('users').insert({
      auth_user_id: authSup.user!.id,
      handle: `Supervisor_${Date.now()}_${Math.floor(Math.random() * 10000)}`,
      age_verified_at: new Date().toISOString(),
      status: 'active',
    } as any).select().single();
    testSupervisorUserId = (uSup as any).id;

    const clientSup = getSupabaseServerClient();
    const { data: sSup } = await clientSup.auth.signInWithPassword({ phone: phoneSup, password: 'Password123!' });
    testSupervisorJwt = sSup.session!.access_token;

    // 4. Create Support Request and Active Session
    const { data: req } = await admin.from('support_requests').insert({
      user_id: testUserId,
      topic: 'work_stress',
      language: 'English',
      service_tier: 'listener',
      state: 'reserved',
      idempotency_key: `safety_test_req_${Date.now()}`,
    } as any).select().single();
    testSupportRequestId = (req as any).id;

    const { data: sess } = await admin.from('sessions').insert({
      request_id: testSupportRequestId,
      user_id: testUserId,
      listener_id: testListenerProfileId,
      room_name: `room_safety_${Date.now()}`,
      state: 'active',
      started_at: new Date(Date.now() - 60000).toISOString(),
    } as any).select().single();
    testSessionId = (sess as any).id;
  });

  afterAll(async () => {
    await admin.from('users').delete().in('id', [testUserId, testListenerUserId, testSupervisorUserId]);
  });

  it('creates safety case in database, safely terminates active session, and logs audit event', async () => {
    const req = new NextRequest('http://localhost:3000/api/safety-cases', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${testListenerJwt}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        sessionId: testSessionId,
        severity: 'urgent',
        reasonCodes: ['self_harm_risk'],
        idempotencyKey: crypto.randomUUID(),
      }),
    });

    const res = await createCaseHandler(req);
    expect(res.status).toBe(201);
    const data = await res.json();

    expect(data.caseId).toBeDefined();
    expect(data.state).toBe('open');
    expect(data.severity).toBe('urgent');
    expect(data.idempotentReplay).toBeFalsy();

    // 1. Verify case persisted in public.safety_cases
    const { data: dbCase } = await admin.from('safety_cases').select('*').eq('id', data.caseId).single();
    expect(dbCase).toBeDefined();
    expect((dbCase as any).session_id).toBe(testSessionId);
    expect((dbCase as any).opened_by).toBe(testListenerUserId);
    expect((dbCase as any).severity).toBe('urgent');

    // 2. Verify active session immediately terminated to safety_ended
    const { data: dbSess } = await admin.from('sessions').select('*').eq('id', testSessionId).single();
    expect((dbSess as any).state).toBe('safety_ended');
    expect((dbSess as any).end_reason).toBe('safety_escalation');

    // 3. Verify support request is recorded as a SAFETY outcome, not a normal
    //    completion. `completed` would conflate a safety escalation with a
    //    routine session end and hide it from safety reporting; the request
    //    state machine has a dedicated `safety_escalated` branch (PRD FR-04).
    const { data: dbReq } = await admin.from('support_requests').select('*').eq('id', testSupportRequestId).single();
    expect((dbReq as any).state).toBe('safety_escalated');

    // 4. Verify listener presence freed to available
    const { data: dbPresence } = await admin.from('listener_presence').select('*').eq('listener_id', testListenerProfileId).single();
    expect((dbPresence as any).state).toBe('available');

    // 5. Verify immutable audit event written
    const { data: auditLogs } = await admin
      .from('audit_events')
      .select('*')
      .eq('entity_id', data.caseId)
      .eq('action', 'safety_case_created');

    expect(auditLogs).toHaveLength(1);
    expect((auditLogs as any)[0].actor_id).toBe(testListenerUserId);
  });

  it('CRITICAL ACCEPTANCE: Duplicate safety report is idempotent and returns existing case', async () => {
    const req = new NextRequest('http://localhost:3000/api/safety-cases', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${testListenerJwt}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        sessionId: testSessionId,
        severity: 'urgent',
        reasonCodes: ['self_harm_risk'],
        idempotencyKey: crypto.randomUUID(),
      }),
    });

    const res = await createCaseHandler(req);
    expect(res.status).toBe(201);
    const data = await res.json();

    expect(data.idempotentReplay).toBe(true);

    // INVARIANT: Still only ONE safety case in DB for this session
    const { data: cases } = await admin.from('safety_cases').select('*').eq('session_id', testSessionId);
    expect(cases).toHaveLength(1);
  });

  it('rejects unauthenticated safety case creation with 401', async () => {
    const req = new NextRequest('http://localhost:3000/api/safety-cases', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        sessionId: testSessionId,
        severity: 'urgent',
        reasonCodes: ['self_harm_risk'],
      }),
    });

    const res = await createCaseHandler(req);
    expect(res.status).toBe(401);
  });

  it('clinical supervisor can acknowledge and resolve safety case', async () => {
    const { data: currentCase } = await admin.from('safety_cases').select('id').eq('session_id', testSessionId).single();
    const caseId = (currentCase as any).id;

    // 1. Acknowledge case
    const ackReq = new NextRequest(`http://localhost:3000/api/safety-cases/${caseId}/acknowledge`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${testSupervisorJwt}`,
        'content-type': 'application/json',
      },
    });

    const ackRes = await acknowledgeCaseHandler(ackReq, { params: Promise.resolve({ id: caseId }) });
    expect(ackRes.status).toBe(200);
    const ackData = await ackRes.json();
    expect(ackData.state).toBe('acknowledged');

    // Verify in DB
    const { data: ackDb } = await admin.from('safety_cases').select('*').eq('id', caseId).single();
    expect((ackDb as any).state).toBe('acknowledged');
    expect((ackDb as any).supervisor_id).toBe(testSupervisorUserId);
    expect((ackDb as any).acknowledged_at).toBeDefined();

    // 2. Resolve case
    const resReq = new NextRequest(`http://localhost:3000/api/safety-cases/${caseId}/resolve`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${testSupervisorJwt}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        resolutionCode: 'crisis_referred',
      }),
    });

    const resRes = await resolveCaseHandler(resReq, { params: Promise.resolve({ id: caseId }) });
    expect(resRes.status).toBe(200);
    const resData = await resRes.json();
    expect(resData.state).toBe('resolved');
    expect(resData.resolutionCode).toBe('crisis_referred');

    // Verify in DB
    const { data: resDb } = await admin.from('safety_cases').select('*').eq('id', caseId).single();
    expect((resDb as any).state).toBe('resolved');
    expect((resDb as any).resolution_code).toBe('crisis_referred');
    expect((resDb as any).resolved_at).toBeDefined();

    // Verify audit logs for both ack and resolve
    const { data: auditEvents } = await admin.from('audit_events').select('action').eq('entity_id', caseId);
    const actions = (auditEvents as any[]).map(a => a.action);
    expect(actions).toContain('safety_case_created');
    expect(actions).toContain('safety_case_acknowledged');
    expect(actions).toContain('safety_case_resolved');
  });

  it('rejects regular user when trying to acknowledge or resolve with 403 Forbidden', async () => {
    const { data: currentCase } = await admin.from('safety_cases').select('id').eq('session_id', testSessionId).single();
    const caseId = (currentCase as any).id;

    // Regular user attempt
    const ackReq = new NextRequest(`http://localhost:3000/api/safety-cases/${caseId}/acknowledge`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${testUserJwt}`,
      },
    });

    const ackRes = await acknowledgeCaseHandler(ackReq, { params: Promise.resolve({ id: caseId }) });
    expect(ackRes.status).toBe(403);
  });
});
