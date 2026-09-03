import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import crypto from 'node:crypto';
import { PaymentWebhookProcessor } from '../src/features/payments/payment-processor';
import { PaymentRepository } from '@vent/db';
import { LedgerAccountCode, LedgerDirection, assertLedgerBalanced } from '@vent/domain';
import { getSupabaseAdmin } from '../src/lib/supabase-server';

describe('Package 4 — Real Razorpay Webhook & Ledger Persistence', () => {
  const admin = getSupabaseAdmin();
  const paymentRepo = new PaymentRepository(admin);
  const processor = new PaymentWebhookProcessor();
  const testWebhookSecret = 'test_webhook_secret_key_88888888';

  let testUserId: string;
  let testRequestId: string;
  let testOrderId: string;
  let testPaymentId: string;
  let testPaymentEntityId: string;
  const testAmountPaise = 50000n; // ₹500.00

  beforeAll(async () => {
    // 1. Create test user
    const { data: user, error: userErr } = await admin
      .from('users')
      .insert({
        auth_user_id: crypto.randomUUID(),
        handle: `PaymentTester${Date.now()}${Math.floor(Math.random() * 1000)}`,
        age_verified_at: new Date().toISOString(),
        status: 'active',
      } as any)
      .select()
      .single();

    if (userErr || !user) {
      throw new Error(`Failed to create test user in beforeAll: ${userErr?.message}`);
    }
    testUserId = (user as any).id;

    // 2. Create support request
    const { data: req } = await admin
      .from('support_requests')
      .insert({
        user_id: testUserId,
        topic: 'work_stress',
        language: 'English',
        service_tier: 'listener',
        state: 'created',
        idempotency_key: `pay_test_req_${Date.now()}`,
      } as any)
      .select()
      .single();
    testRequestId = (req as any).id;

    // 3. Create initial payment record in CREATED state
    testOrderId = `order_test_${Date.now()}`;
    const payment = await paymentRepo.createPayment({
      userId: testUserId,
      providerOrderId: testOrderId,
      amountPaise: testAmountPaise,
    });
    testPaymentId = payment.id;
    testPaymentEntityId = `pay_test_${Date.now()}`;
  });

  afterAll(async () => {
    await admin.from('users').delete().eq('id', testUserId);
  });

  function makeWebhookPayload(orderId: string, paymentId: string, amount: number, currency = 'INR') {
    return JSON.stringify({
      event: 'payment.captured',
      account_id: 'acc_rzp_test_001',
      payload: {
        payment: {
          entity: {
            id: paymentId,
            order_id: orderId,
            amount,
            currency,
            status: 'captured',
          },
        },
      },
    });
  }

  function signPayload(body: string, secretKey: string): string {
    return crypto.createHmac('sha256', secretKey).update(body).digest('hex');
  }

  it('authenticates genuine webhook, updates payment to captured, and writes balanced ledger rows in Postgres', async () => {
    const rawBody = makeWebhookPayload(testOrderId, testPaymentEntityId, Number(testAmountPaise));
    const signature = signPayload(rawBody, testWebhookSecret);

    const result = await processor.processWebhook({
      rawBody,
      signature,
      webhookSecret: testWebhookSecret,
    });

    expect(result.success).toBe(true);
    expect(result.status).toBe(200);
    expect(result.paymentId).toBe(testPaymentId);

    // 1. Verify payment record updated in Postgres
    const { data: updatedPay } = await admin
      .from('payments')
      .select('*')
      .eq('id', testPaymentId)
      .single();

    expect((updatedPay as any).state).toBe('captured');
    expect((updatedPay as any).provider_payment_id).toBe(testPaymentEntityId);
    expect((updatedPay as any).captured_at).toBeDefined();

    // 2. Verify ledger entries in Postgres with UUID reference_id
    const { data: entries } = await admin
      .from('ledger_entries')
      .select('*')
      .eq('reference_id', testPaymentId);

    expect(entries).toHaveLength(2);

    const dr = (entries as any).find((e: any) => e.direction === 'debit');
    const cr = (entries as any).find((e: any) => e.direction === 'credit');

    expect(dr.account_code).toBe(LedgerAccountCode.CASH_PG_CLEARING);
    expect(BigInt(dr.amount_paise)).toBe(testAmountPaise);
    expect(dr.currency).toBe('INR');

    expect(cr.account_code).toBe(LedgerAccountCode.CUSTOMER_SERVICE_REVENUE);
    expect(BigInt(cr.amount_paise)).toBe(testAmountPaise);
    expect(cr.currency).toBe('INR');

    // Double-entry invariant in DB
    expect(Number(dr.amount_paise)).toBe(Number(cr.amount_paise));

    // 3. Verify support request transitioned to queued
    const { data: reqAfter } = await admin
      .from('support_requests')
      .select('*')
      .eq('id', testRequestId)
      .single();

    expect((reqAfter as any).state).toBe('queued');
  });

  it('CRITICAL ACCEPTANCE: Duplicate webhook is idempotent and does not double-journal ledger', async () => {
    const rawBody = makeWebhookPayload(testOrderId, testPaymentEntityId, Number(testAmountPaise));
    const signature = signPayload(rawBody, testWebhookSecret);

    // Replay duplicate delivery
    const result = await processor.processWebhook({
      rawBody,
      signature,
      webhookSecret: testWebhookSecret,
    });

    expect(result.success).toBe(true);
    expect(result.idempotentReplay).toBe(true);
    expect(result.paymentId).toBe(testPaymentId);

    // INVARIANT: Ledger still has EXACTLY two entries, not four!
    const { data: entries } = await admin
      .from('ledger_entries')
      .select('*')
      .eq('reference_id', testPaymentId);

    expect(entries).toHaveLength(2);
  });

  it('CRITICAL ACCEPTANCE: Rejects forged webhook with invalid signature with 400', async () => {
    const rawBody = makeWebhookPayload(testOrderId, 'pay_forged_999', Number(testAmountPaise));
    const badSignature = '0000000000000000000000000000000000000000000000000000000000000000';

    const result = await processor.processWebhook({
      rawBody,
      signature: badSignature,
      webhookSecret: testWebhookSecret,
    });

    expect(result.success).toBe(false);
    expect(result.status).toBe(400);
    expect(result.message).toMatch(/Invalid webhook signature/i);
  });

  it('rejects webhook when amount does not match expected order amount in database', async () => {
    // Create new order for amount test
    const newOrderId = `order_amount_mismatch_${Date.now()}`;
    await paymentRepo.createPayment({
      userId: testUserId,
      providerOrderId: newOrderId,
      amountPaise: 50000n,
    });

    // Webhook claims only 1000 paise
    const rawBody = makeWebhookPayload(newOrderId, 'pay_mismatch_001', 1000);
    const signature = signPayload(rawBody, testWebhookSecret);

    const result = await processor.processWebhook({
      rawBody,
      signature,
      webhookSecret: testWebhookSecret,
    });

    expect(result.success).toBe(false);
    expect(result.status).toBe(400);
    expect(result.message).toMatch(/Amount mismatch/i);
  });

  it('rejects webhook when currency is not INR', async () => {
    const newOrderId = `order_curr_mismatch_${Date.now()}`;
    await paymentRepo.createPayment({
      userId: testUserId,
      providerOrderId: newOrderId,
      amountPaise: 50000n,
    });

    const rawBody = makeWebhookPayload(newOrderId, 'pay_curr_001', 50000, 'USD');
    const signature = signPayload(rawBody, testWebhookSecret);

    const result = await processor.processWebhook({
      rawBody,
      signature,
      webhookSecret: testWebhookSecret,
    });

    expect(result.success).toBe(false);
    expect(result.status).toBe(400);
    expect(result.message).toMatch(/Unsupported currency/i);
  });

  it('FAIL CLOSED: Rejects processing when webhook secret is missing/unconfigured', async () => {
    const rawBody = makeWebhookPayload(testOrderId, 'pay_test_fail_closed', Number(testAmountPaise));
    const signature = 'some_sig';

    const oldEnv = process.env.RAZORPAY_WEBHOOK_SECRET;
    delete process.env.RAZORPAY_WEBHOOK_SECRET;

    const result = await processor.processWebhook({
      rawBody,
      signature,
      webhookSecret: '',
    });

    expect(result.success).toBe(false);
    expect(result.status).toBe(503);
    expect(result.message).toMatch(/unconfigured/i);

    process.env.RAZORPAY_WEBHOOK_SECRET = oldEnv;
  });
});
