// Independent review probes. This file is outside the application's normal test suite.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import crypto from 'node:crypto';
import { NextRequest } from 'next/server';

const boundary = vi.hoisted(() => ({
  capture: vi.fn(),
  repository: vi.fn(),
  admin: vi.fn(),
}));
vi.mock('@/lib/supabase-server', () => ({ getSupabaseAdmin: boundary.admin }));
vi.mock('@vent/db', () => ({ PaymentRepository: boundary.repository }));

import { POST as razorpayPost } from '../../../apps/web/src/app/api/webhooks/razorpay/route';
import { POST as paymentsPost } from '../../../apps/web/src/app/api/payments/webhook/route';

const secret = 'synthetic_review_secret_no_real_credentials';
const payload = {
  event: 'payment.captured',
  payload: { payment: { entity: {
    id: 'pay_review_synthetic',
    order_id: 'order_review_synthetic',
    amount: 50000,
    currency: 'INR',
    status: 'captured',
  } } },
};
const body = JSON.stringify(payload);
const sign = (text: string) => crypto.createHmac('sha256', secret).update(text).digest('hex');

function request(text: string, signature?: string) {
  return new NextRequest('http://localhost:3000/api/review-only', {
    method: 'POST',
    body: text,
    headers: {
      'content-type': 'application/json',
      ...(signature === undefined ? {} : { 'x-razorpay-signature': signature }),
    },
  });
}

describe.each([
  ['razorpay route', razorpayPost],
  ['payments route', paymentsPost],
] as const)('%s independent review', (name, handler) => {
  beforeEach(() => {
    vi.stubEnv('RAZORPAY_WEBHOOK_SECRET', secret);
    boundary.capture.mockReset().mockResolvedValue({ paymentId: 'pay_review_synthetic', idempotentReplay: false });
    boundary.repository.mockReset().mockImplementation(() => ({ capturePaymentWebhook: boundary.capture }));
    boundary.admin.mockReset().mockReturnValue({ reviewBoundary: true });
  });
  afterEach(() => vi.unstubAllEnvs());

  it.each([
    ['non-hex suffix', 'zz'],
    ['extra half byte', 'f'],
    ['extra full byte', 'ff'],
  ])('rejects a correct digest with %s', async (label, suffix) => {
    const response = await handler(request(body, sign(body) + suffix));
    console.info(JSON.stringify({ route: name, case: label, status: response.status, persistenceCalls: boundary.capture.mock.calls.length }));
    expect(response.status).toBe(400);
    expect(boundary.admin).not.toHaveBeenCalled();
    expect(boundary.capture).not.toHaveBeenCalled();
  });

  it('accepts exact signed JSON whitespace without reserialization', async () => {
    const prettyBody = JSON.stringify(payload, null, 2) + '\n';
    const response = await handler(request(prettyBody, sign(prettyBody)));
    expect(response.status).toBe(200);
    expect(boundary.capture).toHaveBeenCalledTimes(1);
  });

  it('rejects whitespace-only body tampering', async () => {
    const response = await handler(request(body + '\n', sign(body)));
    expect(response.status).toBe(400);
    expect(boundary.admin).not.toHaveBeenCalled();
    expect(boundary.capture).not.toHaveBeenCalled();
  });

  it('returns 503 when both secret and signature are absent', async () => {
    vi.stubEnv('RAZORPAY_WEBHOOK_SECRET', undefined);
    const response = await handler(request(body));
    expect(response.status).toBe(503);
    expect(boundary.admin).not.toHaveBeenCalled();
    expect(boundary.capture).not.toHaveBeenCalled();
  });
});
