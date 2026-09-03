import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { NextRequest } from 'next/server';
import crypto from 'node:crypto';
import { POST as createOrderHandler } from '../src/app/api/payments/orders/route';
import { getSupabaseAdmin } from '../src/lib/supabase-server';

describe('Package 4 — Payment Order API Route & Fail-Closed Behavior', () => {
  const admin = getSupabaseAdmin();
  let testUserId: string;
  let testAuthUserId: string;
  let testJwt: string;
  let testRequestId: string;

  beforeAll(async () => {
    // Clean up prior test user if exists
    const { data: listData } = await admin.auth.admin.listUsers();
    const oldAuth = listData?.users?.find(u => u.phone === '+919999944444');
    if (oldAuth) {
      await admin.from('users').delete().eq('auth_user_id', oldAuth.id);
      await admin.auth.admin.deleteUser(oldAuth.id);
    }

    const { data: authUser, error: authErr } = await admin.auth.admin.createUser({
      phone: '+919999944444',
      phone_confirm: true,
      password: 'Password123!',
    });

    if (authErr || !authUser.user) {
      throw new Error(`Failed to create auth user: ${authErr?.message}`);
    }
    testAuthUserId = authUser.user.id;

    const { data: user, error: userErr } = await admin
      .from('users')
      .insert({
        auth_user_id: testAuthUserId,
        handle: `OrderTester${Date.now()}${Math.floor(Math.random() * 1000)}`,
        age_verified_at: new Date().toISOString(),
        status: 'active',
      } as any)
      .select()
      .single();

    if (userErr || !user) {
      throw new Error(`Failed to create public user in payment-order.test.ts: ${userErr?.message}`);
    }
    testUserId = (user as any).id;

    const client = admin;
    const { data: signIn, error: signInErr } = await client.auth.signInWithPassword({
      phone: '+919999944444',
      password: 'Password123!',
    });

    if (signInErr || !signIn.session) {
      throw new Error(`Failed to sign in: ${signInErr?.message}`);
    }
    testJwt = signIn.session.access_token;

    // Create support request
    const { data: req } = await admin
      .from('support_requests')
      .insert({
        user_id: testUserId,
        topic: 'work_stress',
        language: 'English',
        service_tier: 'listener',
        state: 'created',
        idempotency_key: `order_test_req_${Date.now()}`,
      } as any)
      .select()
      .single();
    testRequestId = (req as any).id;
  });

  afterAll(async () => {
    await admin.from('users').delete().eq('id', testUserId);
    await admin.auth.admin.deleteUser(testAuthUserId);
  });

  it('unauthenticated order creation is rejected with 401', async () => {
    const req = new NextRequest('http://localhost:3000/api/payments/orders', {
      method: 'POST',
      body: JSON.stringify({ requestId: testRequestId }),
    });

    const res = await createOrderHandler(req);
    expect(res.status).toBe(401);
  });

  it('FAIL CLOSED: when Razorpay credentials missing, returns 503 configuration error', async () => {
    const oldKey = process.env.RAZORPAY_KEY_ID;
    const oldSecret = process.env.RAZORPAY_KEY_SECRET;
    const oldSim = process.env.RAZORPAY_TEST_SIMULATOR;

    delete process.env.RAZORPAY_KEY_ID;
    delete process.env.RAZORPAY_KEY_SECRET;
    delete process.env.RAZORPAY_TEST_SIMULATOR;

    const req = new NextRequest('http://localhost:3000/api/payments/orders', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${testJwt}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ requestId: testRequestId }),
    });

    const res = await createOrderHandler(req);
    expect(res.status).toBe(503);
    const data = await res.json();
    expect(data.code).toBe('PAYMENT_CONFIG_ERROR');

    // Restore
    if (oldKey) process.env.RAZORPAY_KEY_ID = oldKey;
    if (oldSecret) process.env.RAZORPAY_KEY_SECRET = oldSecret;
    if (oldSim) process.env.RAZORPAY_TEST_SIMULATOR = oldSim;
  });

  it('creates order and persists payment in PostgreSQL in created state', async () => {
    process.env.RAZORPAY_TEST_SIMULATOR = 'true';

    const req = new NextRequest('http://localhost:3000/api/payments/orders', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${testJwt}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ requestId: testRequestId }),
    });

    const res = await createOrderHandler(req);
    expect(res.status).toBe(201);
    const data = await res.json();

    expect(data.orderId).toMatch(/^order_/);
    expect(data.paymentId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
    expect(data.state).toBe('created');
    expect(data.currency).toBe('INR');

    // Verify persisted in PostgreSQL
    const { data: dbPayment } = await admin
      .from('payments')
      .select('*')
      .eq('id', data.paymentId)
      .single();

    expect(dbPayment).toBeDefined();
    expect((dbPayment as any).provider_order_id).toBe(data.orderId);
    expect((dbPayment as any).state).toBe('created');

    delete process.env.RAZORPAY_TEST_SIMULATOR;
  });
});
