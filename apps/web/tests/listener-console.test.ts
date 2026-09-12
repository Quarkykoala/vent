import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { NextRequest } from 'next/server';
import { UserRole } from '@vent/domain';
import { getSupabaseAdmin, getSupabaseServerUrl, getSupabaseAnonKey } from '../src/lib/supabase-server';
import { createSupabaseClient, ListenerRepository } from '@vent/db';
import { GET as consoleHandler } from '../src/app/api/listeners/console/route';
import { GET as queueStatusHandler } from '../src/app/api/support-requests/[id]/queue-status/route';

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
      handle: `Console_${nonce}_${phone.slice(-4)}`,
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
  return { userId: (row as any).id, authId: created.user.id, token: signIn.session.access_token };
}

describe('Listener console + queue status reads', () => {
  const nonce = `${Date.now()}${Math.floor(Math.random() * 10000)}`;
  let listenerUserId: string;
  let listenerAuthId: string;
  let listenerToken: string;
  let listenerProfileId: string;
  let ownerUserId: string;
  let ownerAuthId: string;
  let ownerToken: string;
  let requestId: string;

  beforeAll(async () => {
    const listener = await provision(`+919${nonce.slice(-6)}${Math.floor(100 + Math.random() * 900)}`, UserRole.LISTENER);
    listenerUserId = listener.userId;
    listenerAuthId = listener.authId;
    listenerToken = listener.token;

    const listenerRepo = new ListenerRepository(admin);
    const profile = await listenerRepo.createProfile({
      userId: listenerUserId,
      displayName: `ConsoleListener ${nonce}`,
      languages: ['English'],
      topics: ['Work & Career Stress'],
    });
    listenerProfileId = profile.id;
    await (admin.from('listener_profiles') as any)
      .update({
        status: 'active',
        training_expires_at: new Date(Date.now() + 90 * 24 * 3600 * 1000).toISOString(),
      })
      .eq('id', listenerProfileId);

    const owner = await provision(`+918${nonce.slice(-6)}${Math.floor(100 + Math.random() * 900)}`, UserRole.USER);
    ownerUserId = owner.userId;
    ownerAuthId = owner.authId;
    ownerToken = owner.token;

    const { data: req } = await (admin.from('support_requests') as any)
      .insert({
        user_id: ownerUserId,
        topic: 'Work & Career Stress',
        language: 'English',
        service_tier: 'listener',
        state: 'created',
        idempotency_key: `console_req_${nonce}`,
      })
      .select()
      .single();
    requestId = (req as any).id;
  });

  afterAll(async () => {
    await admin.from('support_requests').delete().eq('id', requestId);
    await (admin.from('listener_presence') as any).delete().eq('listener_id', listenerProfileId);
    await admin.from('listener_profiles').delete().eq('id', listenerProfileId);
    await admin.from('users').delete().eq('id', listenerUserId);
    await admin.from('users').delete().eq('id', ownerUserId);
    if (listenerAuthId) await admin.auth.admin.deleteUser(listenerAuthId);
    if (ownerAuthId) await admin.auth.admin.deleteUser(ownerAuthId);
  });

  it('DENY: console rejects anonymous callers with 401', async () => {
    const res = await consoleHandler(new NextRequest('http://localhost:3000/api/listeners/console'));
    expect(res.status).toBe(401);
  });

  it('DENY: console rejects a non-listener role with 403', async () => {
    const res = await consoleHandler(
      new NextRequest('http://localhost:3000/api/listeners/console', {
        headers: { authorization: `Bearer ${ownerToken}` },
      })
    );
    expect(res.status).toBe(403);
  });

  it('ALLOW: listener sees own profile, presence and empty offers without user PII', async () => {
    const res = await consoleHandler(
      new NextRequest('http://localhost:3000/api/listeners/console', {
        headers: { authorization: `Bearer ${listenerToken}` },
      })
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.profile.id).toBe(listenerProfileId);
    expect(body.presence.state).toBeDefined();
    expect(Array.isArray(body.offers)).toBe(true);
    expect(JSON.stringify(body)).not.toContain('+91');
  });

  it('DENY: queue status rejects anonymous reads with 401', async () => {
    const res = await queueStatusHandler(
      new NextRequest(`http://localhost:3000/api/support-requests/${requestId}/queue-status`),
      { params: Promise.resolve({ id: requestId }) }
    );
    expect(res.status).toBe(401);
  });

  it('DENY: queue status rejects a non-owner with 403', async () => {
    const res = await queueStatusHandler(
      new NextRequest(`http://localhost:3000/api/support-requests/${requestId}/queue-status`, {
        headers: { authorization: `Bearer ${listenerToken}` },
      }),
      { params: Promise.resolve({ id: requestId }) }
    );
    expect(res.status).toBe(403);
  });

  it('ALLOW: owner sees topic/language/state with no listener contact details', async () => {
    const res = await queueStatusHandler(
      new NextRequest(`http://localhost:3000/api/support-requests/${requestId}/queue-status`, {
        headers: { authorization: `Bearer ${ownerToken}` },
      }),
      { params: Promise.resolve({ id: requestId }) }
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.requestId).toBe(requestId);
    expect(body.state).toBe('created');
    expect(body.topic).toBe('Work & Career Stress');
    expect(body.reservation).toBeNull();
    expect(body.session).toBeNull();
  });
});
