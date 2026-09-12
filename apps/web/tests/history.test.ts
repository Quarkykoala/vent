import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { NextRequest } from 'next/server';
import { UserRole } from '@vent/domain';
import { getSupabaseAdmin, getSupabaseServerUrl, getSupabaseAnonKey } from '../src/lib/supabase-server';
import { createSupabaseClient } from '@vent/db';
import { GET as historyHandler } from '../src/app/api/history/route';

const admin = getSupabaseAdmin();

async function provision(phone: string) {
  const { data: created, error } = await admin.auth.admin.createUser({
    phone,
    phone_confirm: true,
    password: 'Password123!',
    app_metadata: { role: UserRole.USER },
  });
  if (error || !created.user) throw new Error(`provision: ${error?.message}`);
  const nonce = `${Date.now()}${Math.floor(Math.random() * 10000)}`;
  const { data: row, error: rowErr } = await (admin.from('users') as any)
    .insert({
      auth_user_id: created.user.id,
      handle: `Hist_${nonce}_${phone.slice(-4)}`,
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

describe('History read — owner-scoped, no cross-user leakage', () => {
  const nonce = `${Date.now()}${Math.floor(Math.random() * 10000)}`;
  let ownerUserId: string;
  let ownerAuthId: string;
  let ownerToken: string;
  let otherToken: string;
  let otherAuthId: string;
  let otherUserId: string;
  let requestId: string;

  beforeAll(async () => {
    const owner = await provision(`+919${nonce.slice(-6)}${Math.floor(100 + Math.random() * 900)}`);
    ownerUserId = owner.userId;
    ownerAuthId = owner.authId;
    ownerToken = owner.token;
    const other = await provision(`+918${nonce.slice(-6)}${Math.floor(100 + Math.random() * 900)}`);
    otherToken = other.token;
    otherAuthId = other.authId;
    otherUserId = other.userId;

    const { data: req } = await (admin.from('support_requests') as any)
      .insert({
        user_id: ownerUserId,
        topic: 'Work & Career Stress',
        language: 'English',
        service_tier: 'listener',
        state: 'created',
        idempotency_key: `hist_req_${nonce}`,
      })
      .select()
      .single();
    requestId = (req as any).id;
  });

  afterAll(async () => {
    await admin.from('support_requests').delete().eq('id', requestId);
    await admin.from('users').delete().eq('id', ownerUserId);
    await admin.from('users').delete().eq('id', otherUserId);
    if (ownerAuthId) await admin.auth.admin.deleteUser(ownerAuthId);
    if (otherAuthId) await admin.auth.admin.deleteUser(otherAuthId);
  });

  it('DENY: rejects anonymous reads with 401', async () => {
    const res = await historyHandler(new NextRequest('http://localhost:3000/api/history'));
    expect(res.status).toBe(401);
  });

  it('ALLOW: owner sees only their own rows', async () => {
    const res = await historyHandler(
      new NextRequest('http://localhost:3000/api/history', {
        headers: { authorization: `Bearer ${ownerToken}` },
      })
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.requests.map((r: any) => r.id)).toContain(requestId);
    expect(JSON.stringify(body)).not.toContain(otherUserId);
  });

  it('DENY: another user sees none of the owner rows', async () => {
    const res = await historyHandler(
      new NextRequest('http://localhost:3000/api/history', {
        headers: { authorization: `Bearer ${otherToken}` },
      })
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.requests.map((r: any) => r.id)).not.toContain(requestId);
    expect(JSON.stringify(body)).not.toContain(ownerUserId);
  });
});
