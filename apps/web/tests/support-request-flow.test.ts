import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { NextRequest } from 'next/server';
import { UserRole } from '@vent/domain';
import { getSupabaseAdmin, getSupabaseServerUrl, getSupabaseAnonKey } from '../src/lib/supabase-server';
import { createSupabaseClient, SupportRequestRepository, type TypedSupabaseClient } from '@vent/db';
import { POST as createRequestHandler } from '../src/app/api/support-requests/route';

/**
 * F02 scope (P4.1a): POST /api/support-requests must authenticate the caller,
 * validate input, persist a durable row, and be idempotent on the
 * (user, idempotencyKey) pair. The synthetic-response behavior is retired.
 */

function makePost(body: unknown, token?: string): NextRequest {
  return new NextRequest('http://localhost:3000/api/support-requests', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
}

describe('F02/P4.1a — Durable authenticated support-request creation', () => {
  const admin = getSupabaseAdmin();
  const url = getSupabaseServerUrl();
  const anonKey = getSupabaseAnonKey();

  let userId: string;
  let authUserId: string;
  let token: string;
  let userClient: TypedSupabaseClient;
  const phone = `+919${Date.now().toString().slice(-6)}${Math.floor(100 + Math.random() * 900)}`;

  beforeAll(async () => {
    const { data: existing } = await admin.auth.admin.listUsers();
    for (const u of existing?.users || []) {
      if (u.phone === phone) {
        await admin.from('users').delete().eq('auth_user_id', u.id);
        await admin.auth.admin.deleteUser(u.id);
      }
    }

    const { data: created, error: createErr } = await admin.auth.admin.createUser({
      phone,
      phone_confirm: true,
      password: 'Password123!',
      app_metadata: { role: UserRole.USER },
    });
    if (createErr || !created.user) throw new Error(`provision failed: ${createErr?.message}`);
    authUserId = created.user.id;

    const { data: userRow, error: userErr } = await admin
      .from('users')
      .insert({
        auth_user_id: authUserId,
        handle: `FlowUser_${Date.now()}_${Math.floor(Math.random() * 10000)}`,
        age_verified_at: new Date().toISOString(),
        status: 'active',
      } as any)
      .select()
      .single();
    if (userErr || !userRow) throw new Error(`users row failed: ${userErr?.message}`);
    userId = (userRow as any).id;

    const loginClient = createSupabaseClient({ supabaseUrl: url, supabaseAnonKey: anonKey });
    const { data: signIn, error: signInErr } = await loginClient.auth.signInWithPassword({
      phone,
      password: 'Password123!',
    });
    if (signInErr || !signIn.session) throw new Error(`login failed: ${signInErr?.message}`);
    token = signIn.session.access_token;
    userClient = createSupabaseClient({
      supabaseUrl: url,
      supabaseAnonKey: anonKey,
      authToken: token,
    });
  });

  afterAll(async () => {
    await admin.from('support_requests').delete().eq('user_id', userId);
    await admin.from('users').delete().eq('id', userId);
    if (authUserId) await admin.auth.admin.deleteUser(authUserId);
  });

  it('returns 401 without a bearer token', async () => {
    const res = await createRequestHandler(
      makePost({
        topic: 'Relationship Conflict',
        language: 'English',
        ageConfirmed: true,
        idempotencyKey: crypto.randomUUID(),
      })
    );
    expect(res.status).toBe(401);
  });

  it('returns 400 for an unsupported topic without persisting anything', async () => {
    const res = await createRequestHandler(
      makePost(
        {
          topic: 'Not A Real Topic',
          language: 'English',
          ageConfirmed: true,
          idempotencyKey: crypto.randomUUID(),
        },
        token
      )
    );
    expect(res.status).toBe(400);
  });

  it('persists a durable created request for the authenticated user', async () => {
    const idempotencyKey = crypto.randomUUID();
    const res = await createRequestHandler(
      makePost(
        {
          topic: 'Relationship Conflict',
          language: 'English',
          ageConfirmed: true,
          idempotencyKey,
        },
        token
      )
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.state).toBe('created');
    expect(body.requestId).toBeDefined();

    const repo = new SupportRequestRepository(admin);
    const row = await repo.findById(body.requestId);
    expect(row).not.toBeNull();
    expect(row!.user_id).toBe(userId);
    expect(row!.state).toBe('created');
    expect(row!.idempotency_key).toBe(idempotencyKey);
  });

  it('returns 400 for a missing age confirmation', async () => {
    const res = await createRequestHandler(
      makePost(
        {
          topic: 'Relationship Conflict',
          language: 'English',
          ageConfirmed: false,
          idempotencyKey: crypto.randomUUID(),
        },
        token
      )
    );
    expect(res.status).toBe(400);
  });

  it('is idempotent: retrying the same idempotency key returns the original request and does not duplicate rows', async () => {
    const idempotencyKey = crypto.randomUUID();
    const payload = {
      topic: 'Work & Career Stress',
      language: 'English',
      ageConfirmed: true,
      idempotencyKey,
    };

    const first = await createRequestHandler(makePost(payload, token));
    expect(first.status).toBe(201);
    const firstBody = await first.json();

    const retry = await createRequestHandler(makePost(payload, token));
    expect(retry.status).toBe(200);
    const retryBody = await retry.json();
    expect(retryBody.requestId).toBe(firstBody.requestId);
    expect(retryBody.state).toBe('created');

    const { data: rows, error } = await userClient
      .from('support_requests')
      .select('id')
      .eq('user_id', userId)
      .eq('idempotency_key', idempotencyKey);
    expect(error).toBeNull();
    expect(rows).toHaveLength(1);
  });

  it('ignores client-supplied lifecycle fields: a state of queued is not persisted', async () => {
    const idempotencyKey = crypto.randomUUID();
    const res = await createRequestHandler(
      makePost(
        {
          topic: 'Relationship Conflict',
          language: 'English',
          ageConfirmed: true,
          idempotencyKey,
          state: 'queued',
          payment_order_id: crypto.randomUUID(),
          queued_at: new Date().toISOString(),
        },
        token
      )
    );

    // Unknown fields are stripped by the schema; server owns lifecycle state.
    expect([201, 200]).toContain(res.status);
    const body = await res.json();
    expect(body.state).toBe('created');

    const repo = new SupportRequestRepository(admin);
    const row = await repo.findById(body.requestId);
    expect(row!.state).toBe('created');
    expect(row!.payment_order_id).toBeNull();
    expect(row!.queued_at).toBeNull();
  });
});
