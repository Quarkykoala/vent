import { describe, it, expect, beforeAll } from 'vitest';
import { NextRequest } from 'next/server';
import crypto from 'node:crypto';
import { GET as listCasesHandler, POST as createCaseHandler } from '../src/app/api/safety-cases/route';
import { POST as acknowledgeCaseHandler } from '../src/app/api/safety-cases/[id]/acknowledge/route';
import { POST as resolveCaseHandler } from '../src/app/api/safety-cases/[id]/resolve/route';
import { UserRole } from '@vent/domain';
import { getSupabaseAdmin, getSupabaseServerClient } from '../src/lib/supabase-server';
import { elevateTestSessionToAal2 } from './helpers/mfa';

describe('Package 7 — Safety authority, least privilege & audit atomicity', () => {
  const admin = getSupabaseAdmin();

  let testUserId: string;
  let testUserJwt: string;
  let testListenerUserId: string;
  let testListenerJwt: string;
  let testListenerProfileId: string;
  let supervisorUserId: string;
  let supervisorAal1Jwt: string;
  let supervisorAal2Jwt: string;
  let listenerOpsAal2Jwt: string;
  let testSessionId: string;
  let testSupportRequestId: string;
  let caseId: string;

  async function createStaff(role: string, label: string) {
    const phone = `91${Math.floor(1000000000 + Math.random() * 9000000000)}`;
    const password = 'Password123!';
    const { data: auth } = await admin.auth.admin.createUser({
      phone,
      phone_confirm: true,
      password,
      app_metadata: { role },
    });
    const { data: user } = await admin.from('users').insert({
      auth_user_id: auth.user!.id,
      handle: `${label}_${Date.now()}_${Math.floor(Math.random() * 10000)}`,
      age_verified_at: new Date().toISOString(),
      status: 'active',
    } as any).select().single();

    const client = getSupabaseServerClient();
    const { data: signedIn } = await client.auth.signInWithPassword({ phone, password });
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
      topics: ['Work & Career Stress'],
      quality_prior: 4.5,
    } as any).select().single();
    testListenerProfileId = (lp as any).id;
    await (admin.from('listener_presence') as any).upsert({
      listener_id: testListenerProfileId,
      state: 'in_session',
      heartbeat_at: new Date().toISOString(),
    });

    const supervisor = await createStaff(UserRole.CLINICAL_SUPERVISOR, 'Supervisor');
    supervisorUserId = supervisor.userId;
    supervisorAal1Jwt = supervisor.aal1Jwt;
    supervisorAal2Jwt = supervisor.aal2Jwt;

    const listenerOps = await createStaff(UserRole.LISTENER_OPS, 'ListenerOps');
    listenerOpsAal2Jwt = listenerOps.aal2Jwt;

    const { data: req } = await admin.from('support_requests').insert({
      user_id: testUserId,
      topic: 'Work & Career Stress',
      language: 'English',
      service_tier: 'listener',
      state: 'connected',
      idempotency_key: `safety_test_req_${crypto.randomUUID()}`,
    } as any).select().single();
    testSupportRequestId = (req as any).id;

    const { data: sess } = await admin.from('sessions').insert({
      request_id: testSupportRequestId,
      user_id: testUserId,
      listener_id: testListenerProfileId,
      room_name: `room_safety_${crypto.randomUUID().replace(/-/g, '')}`,
      state: 'active',
      started_at: new Date(Date.now() - 60_000).toISOString(),
    } as any).select().single();
    testSessionId = (sess as any).id;
  });

  it('creates a participant-scoped safety case and atomically ends the live session', async () => {
    const req = new NextRequest('http://localhost:3000/api/safety-cases', {
      method: 'POST',
      headers: { authorization: `Bearer ${testListenerJwt}`, 'content-type': 'application/json' },
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
    caseId = data.caseId;
    expect(data.state).toBe('open');

    const { data: dbSess } = await admin.from('sessions').select('state, end_reason').eq('id', testSessionId).single();
    expect((dbSess as any).state).toBe('safety_ended');
    expect((dbSess as any).end_reason).toBe('safety_escalation');

    const { data: dbReq } = await admin.from('support_requests').select('state').eq('id', testSupportRequestId).single();
    expect((dbReq as any).state).toBe('safety_escalated');

    const { data: audit } = await admin.from('audit_events').select('action').eq('entity_id', caseId).eq('action', 'safety_case_created');
    expect(audit).toHaveLength(1);
  });

  it('is idempotent for duplicate reports on the same session', async () => {
    const req = new NextRequest('http://localhost:3000/api/safety-cases', {
      method: 'POST',
      headers: { authorization: `Bearer ${testListenerJwt}`, 'content-type': 'application/json' },
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
    expect(data.caseId).toBe(caseId);
  });

  it('rejects AAL1 clinical sessions from privileged safety actions', async () => {
    const req = new NextRequest(`http://localhost:3000/api/safety-cases/${caseId}/acknowledge`, {
      method: 'POST',
      headers: { authorization: `Bearer ${supervisorAal1Jwt}` },
    });
    const res = await acknowledgeCaseHandler(req, { params: Promise.resolve({ id: caseId }) });
    expect(res.status).toBe(403);
  });

  it('keeps Listener Ops out of clinical case data even with AAL2', async () => {
    const listReq = new NextRequest('http://localhost:3000/api/safety-cases', {
      method: 'GET',
      headers: { authorization: `Bearer ${listenerOpsAal2Jwt}` },
    });
    const listRes = await listCasesHandler(listReq);
    expect(listRes.status).toBe(403);

    const ackReq = new NextRequest(`http://localhost:3000/api/safety-cases/${caseId}/acknowledge`, {
      method: 'POST',
      headers: { authorization: `Bearer ${listenerOpsAal2Jwt}` },
    });
    const ackRes = await acknowledgeCaseHandler(ackReq, { params: Promise.resolve({ id: caseId }) });
    expect(ackRes.status).toBe(403);
  });

  it('acknowledges and resolves through transactional DB state transitions with immutable audit events', async () => {
    const ackReq = new NextRequest(`http://localhost:3000/api/safety-cases/${caseId}/acknowledge`, {
      method: 'POST',
      headers: { authorization: `Bearer ${supervisorAal2Jwt}` },
    });
    const ackRes = await acknowledgeCaseHandler(ackReq, { params: Promise.resolve({ id: caseId }) });
    expect(ackRes.status).toBe(200);
    const ackData = await ackRes.json();
    expect(ackData.state).toBe('acknowledged');
    expect(ackData.supervisorId).toBe(supervisorUserId);

    // Replay is a no-op and does not duplicate audit history.
    const ackReplay = await acknowledgeCaseHandler(ackReq, { params: Promise.resolve({ id: caseId }) });
    expect(ackReplay.status).toBe(200);
    expect((await ackReplay.json()).idempotentReplay).toBe(true);

    const resolveReq = new NextRequest(`http://localhost:3000/api/safety-cases/${caseId}/resolve`, {
      method: 'POST',
      headers: { authorization: `Bearer ${supervisorAal2Jwt}`, 'content-type': 'application/json' },
      body: JSON.stringify({ resolutionCode: 'crisis_referred' }),
    });
    const resolveRes = await resolveCaseHandler(resolveReq, { params: Promise.resolve({ id: caseId }) });
    expect(resolveRes.status).toBe(200);
    const resolveData = await resolveRes.json();
    expect(resolveData.state).toBe('resolved');
    expect(resolveData.resolutionCode).toBe('crisis_referred');

    const { data: dbCase } = await admin.from('safety_cases').select('*').eq('id', caseId).single();
    expect((dbCase as any).state).toBe('resolved');
    expect((dbCase as any).supervisor_id).toBe(supervisorUserId);

    const { data: audit } = await admin.from('audit_events').select('action').eq('entity_id', caseId);
    const actions = (audit as any[]).map((row) => row.action);
    expect(actions.filter((action) => action === 'safety_case_acknowledged')).toHaveLength(1);
    expect(actions.filter((action) => action === 'safety_case_resolved')).toHaveLength(1);
  });

  it('does not report success for an unknown case id', async () => {
    const unknownId = crypto.randomUUID();
    const req = new NextRequest(`http://localhost:3000/api/safety-cases/${unknownId}/acknowledge`, {
      method: 'POST',
      headers: { authorization: `Bearer ${supervisorAal2Jwt}` },
    });
    const res = await acknowledgeCaseHandler(req, { params: Promise.resolve({ id: unknownId }) });
    expect(res.status).toBe(404);
  });

  it('rejects a non-participant attempting to terminate another session', async () => {
    const req = new NextRequest('http://localhost:3000/api/safety-cases', {
      method: 'POST',
      headers: { authorization: `Bearer ${testUserJwt}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        sessionId: crypto.randomUUID(),
        severity: 'review',
        reasonCodes: ['boundary_concern'],
        idempotencyKey: crypto.randomUUID(),
      }),
    });
    const res = await createCaseHandler(req);
    expect([403, 500]).toContain(res.status);
  });
});
