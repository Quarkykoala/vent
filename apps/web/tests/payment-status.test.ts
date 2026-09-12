import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { NextRequest } from 'next/server';
import { UserRole } from '@vent/domain';
import { getSupabaseAdmin, getSupabaseServerUrl, getSupabaseAnonKey } from '../src/lib/supabase-server';
import { createSupabaseClient } from '@vent/db';
import { GET as paymentStatusHandler } from '../src/app/api/support-requests/[id]/payment-status/route';

function makeGet(requestId: string, token?: string): NextRequest {
  return new NextRequest(`http://localhost:3000/api/support-requests/${requestId}/payment-status`, {
    method: 'GET',
    headers: token ? { authorization: `Bearer ${token}` } : {},
  });
}

describe('Payment status read — owner-scoped, never grants entitlement', () => {
  const admin = getSupabaseAdmin();
  const url = getSupabaseServerUrl();
  const anonKey = getSupabaseAnonKey();

  let ownerUserId: string;
  let ownerAuthId: string;
  let ownerToken: string;
  let otherToken: string;
  let otherAuthId: string;
  let requestId: string;
  let paymentId: string;
  const nonce = `${Date.now()}${Math.floor(Math.random() * 1000)}`;

  beforeAll(async () => {
    async function provision(phone: string, role: string) {
      const { data: created, error } = await admin.auth.admin.createUser({
        phone,
        phone_confirm: true,
        password: 'Password123!',
        app_metadata: { role },
      });
      if (error || !created.user) throw new Error(`provision: ${error?.message}`);
      const { data: row, error: rowErr } = await admin
        .from('users')
        .insert({
          auth_user_id: created.user.id,
          handle: `PayStatus_${nonce}_${phone.slice(-4)}`,
          age_verified_at: new Date().toISOString(),
          status: 'active',
        } as any)
        .select()
        .single();
      if (rowErr || !row) throw new Error(`users row: ${rowErr?.message}`);
      const loginClient = createSupabaseClient({ supabaseUrl: url, supabaseAnonKey: anonKey });
      const { data: signIn, error: signInErr } = await loginClient.auth.signInWithPassword({
        phone,
        password: 'Password123!',
      });
      if (signInErr || !signIn.session) throw new Error(`login: ${signInErr?.message}`);
      return { userId: (row as any).id, authId: created.user.id, token: signIn.session.access_token };
    }

    const owner = await provision(`+919${nonce.slice(-6)}${Math.floor(100 + Math.random() * 900)}`, UserRole.USER);
    ownerUserId = owner.userId;
    ownerAuthId = owner.authId;
    ownerToken = owner.token;
    const other = await provision(`+918${nonce.slice(-6)}${Math.floor(100 + Math.random() * 900)}`, UserRole.USER);
    otherToken = other.token;
    otherAuthId = other.authId;

    const { data: payment } = await (admin.from('payments') as any)
      .insert({
        user_id: ownerUserId,
        provider: 'razorpay',
        provider_order_id: `order_paystatus_${nonce}`,
        amount_paise: 19900,
        currency: 'INR',
        state: 'created',
      })
      .select()
      .single();
    paymentId = (payment as any).id;

    const { data: req } = await (admin.from('support_requests') as any)
      .insert({
        user_id: ownerUserId,
        topic: 'Work & Career Stress',
        language: 'English',
        service_tier: 'listener',
        state: 'created',
        payment_order_id: paymentId,
        idempotency_key: `paystatus_req_${nonce}`,
      } as any)
      .select()
      .single();
    requestId = (req as any).id;
  });

  afterAll(async () => {
    await admin.from('support_requests').delete().eq('id', requestId);
    await admin.from('payments').delete().eq('id', paymentId);
    await admin.from('users').delete().eq('id', ownerUserId);
    if (ownerAuthId) await admin.auth.admin.deleteUser(ownerAuthId);
    if (otherAuthId) await admin.auth.admin.deleteUser(otherAuthId);
  });

  it('DENY: rejects anonymous reads with 401', async () => {
    const res = await paymentStatusHandler(makeGet(requestId), {
      params: Promise.resolve({ id: requestId }),
    });
    expect(res.status).toBe(401);
  });

  it('DENY: rejects a non-owner with 403', async () => {
    const res = await paymentStatusHandler(makeGet(requestId, otherToken), {
      params: Promise.resolve({ id: requestId }),
    });
    expect(res.status).toBe(403);
  });

  it('ALLOW: owner sees created payment state and created request state', async () => {
    const res = await paymentStatusHandler(makeGet(requestId, ownerToken), {
      params: Promise.resolve({ id: requestId }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.requestState).toBe('created');
    expect(body.paymentState).toBe('created');
    expect(body.amountPaise).toBe(19900);
  });
});
