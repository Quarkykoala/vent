import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { NextRequest } from 'next/server';
import { UserRole } from '@vent/domain';
import { getSupabaseAdmin, getSupabaseServerUrl, getSupabaseAnonKey } from '../src/lib/supabase-server';
import { createSupabaseClient, ListenerRepository } from '@vent/db';
import { POST as reviewHandler } from '../src/app/api/listeners/review/route';
import { GET as opsQueueHandler } from '../src/app/api/operations/queue/route';
import { GET as safetyListHandler } from '../src/app/api/safety-cases/route';
import { elevateTestSessionToAal2 } from './helpers/mfa';

const admin = getSupabaseAdmin();

async function provision(phone: string, role: string) {
  const { data: created, error } = await admin.auth.admin.createUser({
    phone,
    phone_confirm: true,
    password: 'Password123!',
    app_metadata: { role },
  });
  if (error || !created.user) throw new Error(`provision: ${error?.message}`);
  const nonce = `${Date.now()}${Math.floor(Math.random() * 10000)}`;
  const { data: row, error: rowErr } = await (admin.from('users') as any)
    .insert({
      auth_user_id: created.user.id,
      handle: `Ops_${nonce}_${phone.slice(-4)}`,
      age_verified_at: new Date().toISOString(),
      status: 'active',
    })
    .select()
    .single();
  if (rowErr || !row) throw new Error(`users row: ${rowErr?.message}`);
  const loginClient = createSupabaseClient({
    supabaseUrl: getSupabaseServerUrl(),
    supabaseAnonKey: getSupabaseAnonKey(),
  });
  const { data: signIn, error: signInErr } = await loginClient.auth.signInWithPassword({
    phone,
    password: 'Password123!',
  });
  if (signInErr || !signIn.session) throw new Error(`login: ${signInErr?.message}`);

  const aal1Token = signIn.session.access_token;
  const token = role === UserRole.LISTENER_OPS
    ? await elevateTestSessionToAal2(loginClient)
    : aal1Token;

  return {
    userId: (row as any).id,
    authId: created.user.id,
    token,
    aal1Token,
  };
}

describe('Operator review, queue and safety reads', () => {
  const nonce = `${Date.now()}${Math.floor(Math.random() * 10000)}`;
  let opsToken: string;
  let opsAal1Token: string;
  let opsUserId: string;
  let opsAuthId: string;
  let userToken: string;
  let userAuthId: string;
  let userUserId: string;
  let listenerProfileId: string;
  let listenerUserId: string;
  let listenerAuthId: string;

  beforeAll(async () => {
    const ops = await provision(`+919${nonce.slice(-6)}${Math.floor(100 + Math.random() * 900)}`, UserRole.LISTENER_OPS);
    opsToken = ops.token;
    opsAal1Token = ops.aal1Token;
    opsUserId = ops.userId;
    opsAuthId = ops.authId;
    const user = await provision(`+918${nonce.slice(-6)}${Math.floor(100 + Math.random() * 900)}`, UserRole.USER);
    userToken = user.token;
    userAuthId = user.authId;
    userUserId = user.userId;

    const listener = await provision(`+917${nonce.slice(-6)}${Math.floor(100 + Math.random() * 900)}`, UserRole.LISTENER);
    listenerUserId = listener.userId;
    listenerAuthId = listener.authId;
    const repo = new ListenerRepository(admin);
    const profile = await repo.createProfile({
      userId: listenerUserId,
      displayName: `OpsReview ${nonce}`,
      languages: ['English'],
      topics: ['Work & Career Stress'],
    });
    listenerProfileId = profile.id;
  });

  afterAll(async () => {
    await (admin.from('listener_presence') as any).delete().eq('listener_id', listenerProfileId);
    await admin.from('listener_profiles').delete().eq('id', listenerProfileId);
    await admin.from('users').delete().eq('id', listenerUserId);
    await admin.from('users').delete().eq('id', userUserId);
    await admin.from('users').delete().eq('id', opsUserId);
    if (listenerAuthId) await admin.auth.admin.deleteUser(listenerAuthId);
    if (userAuthId) await admin.auth.admin.deleteUser(userAuthId);
    if (opsAuthId) await admin.auth.admin.deleteUser(opsAuthId);
  });

  function post(path: string, token: string | undefined, body: unknown): NextRequest {
    return new NextRequest(`http://localhost:3000${path}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(body),
    });
  }

  function get(path: string, token: string | undefined): NextRequest {
    return new NextRequest(`http://localhost:3000${path}`, {
      headers: token ? { authorization: `Bearer ${token}` } : {},
    });
  }

  it('DENY: listener review rejects anonymous, non-staff and AAL1 staff callers', async () => {
    const anon = await reviewHandler(
      post('/api/listeners/review', undefined, { listenerId: listenerProfileId, status: 'active' })
    );
    expect(anon.status).toBe(401);

    const user = await reviewHandler(
      post('/api/listeners/review', userToken, { listenerId: listenerProfileId, status: 'active' })
    );
    expect(user.status).toBe(403);

    const aal1Ops = await reviewHandler(
      post('/api/listeners/review', opsAal1Token, { listenerId: listenerProfileId, status: 'active' })
    );
    expect(aal1Ops.status).toBe(403);
  });

  it('ALLOW: AAL2 ops activates a listener and writes an audit event', async () => {
    const res = await reviewHandler(
      post('/api/listeners/review', opsToken, {
        listenerId: listenerProfileId,
        status: 'active',
        reason: 'ops test activation',
      })
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe('active');

    const { data: profile } = await admin
      .from('listener_profiles')
      .select('status')
      .eq('id', listenerProfileId)
      .single();
    expect((profile as any).status).toBe('active');

    const { data: audit } = await (admin.from('audit_events') as any)
      .select('action, entity_id')
      .eq('entity_id', listenerProfileId)
      .eq('action', 'listener_status_changed')
      .order('created_at', { ascending: false })
      .limit(1);
    expect(audit).toHaveLength(1);
  });

  it('DENY: ops queue rejects anonymous, plain users and AAL1 staff; ALLOW for AAL2 ops', async () => {
    const anon = await opsQueueHandler(get('/api/operations/queue', undefined));
    expect(anon.status).toBe(401);

    const user = await opsQueueHandler(get('/api/operations/queue', userToken));
    expect(user.status).toBe(403);

    const aal1Ops = await opsQueueHandler(get('/api/operations/queue', opsAal1Token));
    expect(aal1Ops.status).toBe(403);

    const ops = await opsQueueHandler(get('/api/operations/queue', opsToken));
    expect(ops.status).toBe(200);
    const body = await ops.json();
    expect(body).toHaveProperty('queuedCount');
    expect(body).toHaveProperty('availableListeners');
  });

  it('DENY: safety list rejects plain users', async () => {
    const user = await safetyListHandler(get('/api/safety-cases', userToken));
    expect(user.status).toBe(403);
  });

  it('sweeper only moves rows still stale at write time', async () => {
    const repo = new ListenerRepository(admin);

    // Control: a genuinely stale row is swept offline.
    await (admin.from('listener_presence') as any)
      .update({
        state: 'available',
        heartbeat_at: new Date(Date.now() - 120_000).toISOString(),
        available_since: new Date(Date.now() - 120_000).toISOString(),
      })
      .eq('listener_id', listenerProfileId);
    expect(await repo.sweepStalePresence(30)).toBe(1);
    const { data: sweptRow } = await admin
      .from('listener_presence')
      .select('state')
      .eq('listener_id', listenerProfileId)
      .single();
    expect((sweptRow as any).state).toBe('offline');

    // Guard: a row whose heartbeat refreshed is left available.
    await (admin.from('listener_presence') as any)
      .update({
        state: 'available',
        heartbeat_at: new Date().toISOString(),
        available_since: new Date().toISOString(),
      })
      .eq('listener_id', listenerProfileId);
    expect(await repo.sweepStalePresence(30)).toBe(0);
    const { data: keptRow } = await admin
      .from('listener_presence')
      .select('state')
      .eq('listener_id', listenerProfileId)
      .single();
    expect((keptRow as any).state).toBe('available');
  });
});