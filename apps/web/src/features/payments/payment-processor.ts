import crypto from 'node:crypto';
import { PaymentRepository } from '@vent/db';
import { getSupabaseAdmin } from '@/lib/supabase-server';

export interface ProcessWebhookInput {
  rawBody: string;
  signature: string;
  webhookSecret?: string;
}

export interface WebhookPaymentEntity {
  id: string;
  order_id: string;
  amount: number;
  currency: string;
  status: string;
}

export interface WebhookPayload {
  event: string;
  account_id?: string;
  payload: {
    payment: {
      entity: WebhookPaymentEntity;
    };
  };
}

export interface WebhookProcessingResult {
  success: boolean;
  status: number;
  message: string;
  paymentId?: string;
  idempotentReplay?: boolean;
}

export class PaymentWebhookProcessor {
  /**
   * Timing-safe cryptographic HMAC-SHA256 verification of Razorpay webhook signature.
   * STRICT INVARIANT: Fails closed. Never uses hardcoded fallback secrets in production.
   */
  verifySignature(rawBody: string, signature: string, secret: string): boolean {
    if (!secret || secret.trim() === '') {
      throw new Error('Razorpay webhook secret is unconfigured (fail-closed security invariant).');
    }

    if (!signature || signature.trim() === '') {
      return false;
    }

    const expected = crypto
      .createHmac('sha256', secret)
      .update(rawBody)
      .digest('hex');

    try {
      return crypto.timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(signature, 'hex'));
    } catch {
      return false;
    }
  }

  async processWebhook(input: ProcessWebhookInput): Promise<WebhookProcessingResult> {
    const { rawBody, signature } = input;
    const webhookSecret = input.webhookSecret || process.env.RAZORPAY_WEBHOOK_SECRET;

    if (!webhookSecret || webhookSecret.trim() === '') {
      return {
        success: false,
        status: 503,
        message: 'Payment processor webhook secret unconfigured',
      };
    }

    // 1. Validate signature
    if (!this.verifySignature(rawBody, signature, webhookSecret)) {
      return {
        success: false,
        status: 400,
        message: 'Invalid webhook signature',
      };
    }

    // 2. Parse payload safely
    let payload: WebhookPayload;
    try {
      payload = JSON.parse(rawBody);
    } catch {
      return {
        success: false,
        status: 400,
        message: 'Invalid JSON payload',
      };
    }

    const payment = payload?.payload?.payment?.entity;
    if (!payment || !payment.order_id || !payment.id) {
      return {
        success: false,
        status: 400,
        message: 'Malformed payment entity in webhook payload',
      };
    }

    // 3. Process captured payment
    if (payment.status === 'captured') {
      const amountPaise = BigInt(payment.amount);
      if (amountPaise <= 0n) {
        return {
          success: false,
          status: 400,
          message: 'Payment amount must be greater than zero',
        };
      }

      if (payment.currency !== 'INR') {
        return {
          success: false,
          status: 400,
          message: `Unsupported currency: ${payment.currency}. Only INR is supported.`,
        };
      }

      const idempotencyKey = `razorpay_webhook_${payload.event}_${payment.id}`;
      const idempotencyResponse = {
        success: true,
        orderId: payment.order_id,
        providerPaymentId: payment.id,
        captured: true,
      };

      const adminClient = getSupabaseAdmin();
      const paymentRepo = new PaymentRepository(adminClient);

      try {
        const result = await paymentRepo.capturePaymentWebhook({
          providerOrderId: payment.order_id,
          providerPaymentId: payment.id,
          amountPaise,
          currency: payment.currency,
          idempotencyKey,
          idempotencyResponse,
        });

        return {
          success: true,
          status: 200,
          message: result.idempotentReplay
            ? 'Webhook event already processed (idempotent replay)'
            : 'Payment captured and balanced double-entry ledger entries posted',
          paymentId: result.paymentId,
          idempotentReplay: result.idempotentReplay,
        };
      } catch (err: any) {
        return {
          success: false,
          status: 400,
          message: err.message || 'Payment capture failed',
        };
      }
    }

    return {
      success: true,
      status: 200,
      message: `Ignored unhandled payment status: ${payment.status}`,
    };
  }
}

export const paymentWebhookProcessor = new PaymentWebhookProcessor();
