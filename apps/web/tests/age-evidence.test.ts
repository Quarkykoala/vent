import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { NextRequest } from 'next/server';
import { UserRole } from '@vent/domain';
import {
  getSupabaseAdmin,
  getSupabaseServerUrl,
  getSupabaseAnonKey,
} from '../src/lib/supabase-server';
import { createSupabaseClient } from '@vent/db';
import { authService } from '../src/features/auth/auth-service';
import { POST as createRequestHandler } from '../src/app/api/support-requests/route';

/**
 * F08 (P1.1c): token-based provisioning must not fabricate an 18+ confirmation
 * timestamp, and support-request creation must be gated on that evidence.
 */

function makePost(body: unknown, token: string): NextRequest {
  return new NextRequest('http://localhost:3000/api/support-requests', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });
}

describe('F08 — Age confirmation evidence is never fabricated', () => {
  const admin = getSupabaseAdmin();
  const url = getSupabaseServerUrl();
  const anonKey = getSupabaseAnonKey();

  let authUserId: string;
  let userId: string;
  let token: string;
  const phone = `+919${Date.now().toString().slice(-6)}${Math.floor(100 + Math.random() * 900)}`;

  beforeAll(async () => {
    const { data: existing } = await admin.auth.admin.listUsers({ perPage: 200 });
    for (const u of existing?.users || []) {
      if (u.phone === phone) {
        await admin.from('users').delete().eq('auth_user_id', u.id);
        await admin.auth.admin.deleteUser(u.id);
      }
    }

    const { data: created, error } = await admin.auth.admin.createUser({
      phone,
      phone_confirm: true,
      password: 'Password123!',
      app_metadata: { role: UserRole.USER },
    });
    if (error || !created.user) throw new Error(`provision: ${error?.message}`);
    authUserId = created.user.id;

    const loginClient = createSupabaseClient({ supabaseUrl: url, supabaseAnonKey: anonKey });
    const { data: signIn, error: signInErr } = await loginClient.auth.signInWithPassword({
      phone,
      password: 'Password123!',
    });
    if (signInErr || !signIn.session) throw new Error(`login: ${signInErr?.message}`);
    token = signIn.session.access_token;
  });

  afterAll(async () => {
    if (userId) await admin.from('users').delete().eq('id', userId);
    if (authUserId) await admin.auth.admin.deleteUser(authUserId);
  });

  it('provisions via token WITHOUT writing an age confirmation timestamp', async () => {
    const session = await authService.getUserFromToken(token);
    expect(session).not.toBeNull();
    userId = session!.userId;

    const { data: row } = await admin
      .from('users')
      .select('age_verified_at')
      .eq('id', userId)
      .single();
    expect((row as any).age_verified_at).toBeNull();
  });

  it('rejects support-request creation while age evidence is missing (403)', async () => {
    const res = await createRequestHandler(
      makePost(
        {
          topic: 'Work & Career Stress',
          language: 'English',
          ageConfirmed: true,
          idempotencyKey: crypto.randomUUID(),
        },
        token
      )
    );
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toMatch(/age confirmation/i);
  });

  it('allows request creation once genuine age evidence exists', async () => {
    await (admin.from('users') as any)
      .update({ age_verified_at: new Date().toISOString() })
      .eq('id', userId);

    const res = await createRequestHandler(
      makePost(
        {
          topic: 'Work & Career Stress',
          language: 'English',
          ageConfirmed: true,
          idempotencyKey: crypto.randomUUID(),
        },
        token
      )
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.state).toBe('created');
  });
});
