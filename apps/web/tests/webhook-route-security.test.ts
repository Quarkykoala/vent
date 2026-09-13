import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import crypto from 'node:crypto';
import { NextRequest } from 'next/server';

const boundary = vi.hoisted(() => ({
  capturePaymentWebhook: vi.fn(),
  PaymentRepository: vi.fn(),
  getSupabaseAdmin: vi.fn(),
}));

vi.mock('@/lib/supabase-server', () => ({
  getSupabaseAdmin: boundary.getSupabaseAdmin,
}));

vi.mock('@vent/db', () => ({
  PaymentRepository: boundary.PaymentRepository,
}));

import { POST as razorpayWebhookPost } from '../src/app/api/webhooks/razorpay/route';
import { POST as paymentsWebhookPost } from '../src/app/api/payments/webhook/route';

type WebhookRouteHandler = (req: NextRequest) => Promise<Response>;

const routeHandlers: Array<{
  name: string;
  url: string;
  handler: WebhookRouteHandler;
}> = [
  {
    name: 'POST /api/webhooks/razorpay',
    url: 'http://localhost:3000/api/webhooks/razorpay',
    handler: razorpayWebhookPost,
  },
  {
    name: 'POST /api/payments/webhook',
    url: 'http://localhost:3000/api/payments/webhook',
    handler: paymentsWebhookPost,
  },
];

const SYNTHETIC_SECRET = 'synthetic_webhook_secret_0123456789abcdef';
const LEGACY_PLACEHOLDER_SECRET = 'placeholder_webhook_secret';
const WHITESPACE_SECRET = '   \t  ';
const ADMIN_CLIENT_SENTINEL = { boundary: 'supabase-admin-mock' };

function sign(rawBody: string, secret: string): string {
  return crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
}

function buildCaptureBody(paymentId: string, amount = 50000): string {
  return JSON.stringify({
    event: 'payment.captured',
    account_id: 'acc_synthetic_000000',
    payload: {
      payment: {
        entity: {
          id: paymentId,
          order_id: 'order_synthetic_000001',
          amount,
          currency: 'INR',
          status: 'captured',
        },
      },
    },
  });
}

function buildAuthorizedBody(): string {
  return JSON.stringify({
    event: 'payment.authorized',
    account_id: 'acc_synthetic_000000',
    payload: {
      payment: {
        entity: {
          id: 'pay_synthetic_authorized',
          order_id: 'order_synthetic_000001',
          amount: 50000,
          currency: 'INR',
          status: 'authorized',
        },
      },
    },
  });
}

function buildWebhookRequest(
  url: string,
  rawBody: string,
  signatureHeader?: string
): NextRequest {
  const headers: Record<string, string> = {
    'content-type': 'application/json',
  };
  if (signatureHeader !== undefined) {
    headers['x-razorpay-signature'] = signatureHeader;
  }
  return new NextRequest(url, {
    method: 'POST',
    headers,
    body: rawBody,
  });
}

function expectBoundaryUntouched(): void {
  expect(boundary.getSupabaseAdmin).not.toHaveBeenCalled();
  expect(boundary.PaymentRepository).not.toHaveBeenCalled();
  expect(boundary.capturePaymentWebhook).not.toHaveBeenCalled();
}

describe.each(routeHandlers)('$name fail-closed behavior', ({ url, handler }) => {
  let originalSecret: string | undefined;

  beforeEach(() => {
    originalSecret = process.env.RAZORPAY_WEBHOOK_SECRET;
    delete process.env.RAZORPAY_WEBHOOK_SECRET;

    boundary.capturePaymentWebhook.mockReset().mockResolvedValue({
      paymentId: 'pay_synthetic_default',
      idempotentReplay: false,
    });
    boundary.PaymentRepository.mockReset().mockImplementation(() => ({
      capturePaymentWebhook: boundary.capturePaymentWebhook,
    }));
    boundary.getSupabaseAdmin.mockReset().mockReturnValue(ADMIN_CLIENT_SENTINEL);
  });

  afterEach(() => {
    if (originalSecret === undefined) {
      delete process.env.RAZORPAY_WEBHOOK_SECRET;
    } else {
      process.env.RAZORPAY_WEBHOOK_SECRET = originalSecret;
    }
  });

  describe('missing or invalid configuration', () => {
    it('returns 503 and never reaches persistence when the secret is undefined', async () => {
      const rawBody = buildCaptureBody('pay_synthetic_cfg_001');
      const res = await handler(
        buildWebhookRequest(url, rawBody, sign(rawBody, SYNTHETIC_SECRET))
      );

      expect(res.status).toBe(503);
      const data = await res.json();
      expect(data.message).toMatch(/unconfigured/i);
      expectBoundaryUntouched();
    });

    it('returns 503 when the secret is an empty string', async () => {
      process.env.RAZORPAY_WEBHOOK_SECRET = '';
      const rawBody = buildCaptureBody('pay_synthetic_cfg_002');
      const res = await handler(
        buildWebhookRequest(url, rawBody, sign(rawBody, SYNTHETIC_SECRET))
      );

      expect(res.status).toBe(503);
      expectBoundaryUntouched();
    });

    it('returns 503 for a whitespace-only secret and does not leak the configured value', async () => {
      process.env.RAZORPAY_WEBHOOK_SECRET = WHITESPACE_SECRET;
      const rawBody = buildCaptureBody('pay_synthetic_cfg_003');
      const res = await handler(
        buildWebhookRequest(url, rawBody, sign(rawBody, SYNTHETIC_SECRET))
      );

      expect(res.status).toBe(503);
      const serialized = JSON.stringify(await res.json());
      expect(serialized).not.toContain(WHITESPACE_SECRET);
      expect(serialized).not.toContain(SYNTHETIC_SECRET);
      expectBoundaryUntouched();
    });

    it('rejects a capture event signed with the legacy placeholder while configuration is absent (F03)', async () => {
      const rawBody = buildCaptureBody('pay_synthetic_forged_f03');
      const res = await handler(
        buildWebhookRequest(
          url,
          rawBody,
          sign(rawBody, LEGACY_PLACEHOLDER_SECRET)
        )
      );

      expect(res.status).toBe(503);
      expectBoundaryUntouched();
    });
  });

  describe('configured secret with bad signatures', () => {
    beforeEach(() => {
      process.env.RAZORPAY_WEBHOOK_SECRET = SYNTHETIC_SECRET;
    });

    it('returns 400 when the signature header is missing', async () => {
      const rawBody = buildCaptureBody('pay_synthetic_nosig');
      const res = await handler(buildWebhookRequest(url, rawBody));

      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.message).toMatch(/invalid webhook signature/i);
      expectBoundaryUntouched();
    });

    it('returns 400 for a blank signature header', async () => {
      const rawBody = buildCaptureBody('pay_synthetic_blanksig');
      const res = await handler(
        buildWebhookRequest(url, rawBody, WHITESPACE_SECRET)
      );

      expect(res.status).toBe(400);
      expectBoundaryUntouched();
    });

    it('returns 400 for a well-formed but incorrect signature', async () => {
      const rawBody = buildCaptureBody('pay_synthetic_wrongsig');
      const res = await handler(
        buildWebhookRequest(url, rawBody, '0'.repeat(64))
      );

      expect(res.status).toBe(400);
      expectBoundaryUntouched();
    });

    it('returns 400 (not an unhandled 500) for a malformed non-hex signature', async () => {
      const rawBody = buildCaptureBody('pay_synthetic_malformed');
      const res = await handler(
        buildWebhookRequest(
          url,
          rawBody,
          'forged_invalid_hex_signature_deadbeef'
        )
      );

      expect(res.status).toBe(400);
      expectBoundaryUntouched();
    });

    it('returns 400 for a hex signature of incorrect length', async () => {
      const rawBody = buildCaptureBody('pay_synthetic_shortsig');
      const res = await handler(
        buildWebhookRequest(url, rawBody, 'deadbeef')
      );

      expect(res.status).toBe(400);
      expectBoundaryUntouched();
    });

    it('returns 400 for a valid digest followed by a non-hex suffix (zz)', async () => {
      const rawBody = buildCaptureBody('pay_synthetic_suffix');
      const res = await handler(
        buildWebhookRequest(
          url,
          rawBody,
          `${sign(rawBody, SYNTHETIC_SECRET)}zz`
        )
      );

      expect(res.status).toBe(400);
      expectBoundaryUntouched();
    });

    it('returns 400 for a valid digest followed by one extra hex digit', async () => {
      const rawBody = buildCaptureBody('pay_synthetic_extrahex');
      const res = await handler(
        buildWebhookRequest(
          url,
          rawBody,
          `${sign(rawBody, SYNTHETIC_SECRET)}f`
        )
      );

      expect(res.status).toBe(400);
      expectBoundaryUntouched();
    });

    it('rejects a body modified after its signature was generated', async () => {
      const originalBody = buildCaptureBody('pay_synthetic_tamper', 50000);
      const signature = sign(originalBody, SYNTHETIC_SECRET);
      const tamperedBody = buildCaptureBody('pay_synthetic_tamper', 999999);

      const res = await handler(
        buildWebhookRequest(url, tamperedBody, signature)
      );

      expect(res.status).toBe(400);
      expectBoundaryUntouched();
    });
  });

  describe('validly signed requests', () => {
    beforeEach(() => {
      process.env.RAZORPAY_WEBHOOK_SECRET = SYNTHETIC_SECRET;
    });

    it('processes a valid non-capture event as an ignored event without persistence', async () => {
      const rawBody = buildAuthorizedBody();
      const res = await handler(
        buildWebhookRequest(url, rawBody, sign(rawBody, SYNTHETIC_SECRET))
      );

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.success).toBe(true);
      expect(data.message).toMatch(/ignored/i);
      expectBoundaryUntouched();
    });

    it('reaches the repository boundary exactly once for a valid capture event', async () => {
      boundary.capturePaymentWebhook.mockResolvedValue({
        paymentId: 'pay_synthetic_captured',
        idempotentReplay: false,
      });

      const rawBody = buildCaptureBody('pay_synthetic_captured');
      const res = await handler(
        buildWebhookRequest(url, rawBody, sign(rawBody, SYNTHETIC_SECRET))
      );

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.success).toBe(true);
      expect(data.paymentId).toBe('pay_synthetic_captured');
      expect(data.idempotentReplay).toBe(false);

      expect(boundary.getSupabaseAdmin).toHaveBeenCalledTimes(1);
      expect(boundary.PaymentRepository).toHaveBeenCalledWith(ADMIN_CLIENT_SENTINEL);
      expect(boundary.capturePaymentWebhook).toHaveBeenCalledTimes(1);
      expect(boundary.capturePaymentWebhook).toHaveBeenCalledWith({
        providerOrderId: 'order_synthetic_000001',
        providerPaymentId: 'pay_synthetic_captured',
        amountPaise: 50000n,
        currency: 'INR',
        idempotencyKey: 'razorpay_webhook_payment.captured_pay_synthetic_captured',
        idempotencyResponse: {
          success: true,
          orderId: 'order_synthetic_000001',
          providerPaymentId: 'pay_synthetic_captured',
          captured: true,
        },
      });
    });
  });
});
