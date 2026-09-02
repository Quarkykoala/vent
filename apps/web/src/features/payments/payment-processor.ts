import crypto from 'node:crypto';
import {
  createPaymentCaptureJournal,
  assertLedgerBalanced,
  PaymentState,
  type PaymentStateType,
  type UnpersistedLedgerEntry,
} from '@vent/domain';

export interface ProcessWebhookInput {
  rawBody: string;
  signature: string;
  webhookSecret: string;
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
  account_id: string;
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
  journalEntries?: UnpersistedLedgerEntry[];
  idempotentReplay?: boolean;
}

export class PaymentWebhookProcessor {
  // In-memory idempotency store for unit/integration testing
  private processedEvents = new Map<string, WebhookProcessingResult>();

  verifySignature(rawBody: string, signature: string, secret: string): boolean {
    const expected = crypto
      .createHmac('sha256', secret)
      .update(rawBody)
      .digest('hex');

    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
  }

  async processWebhook(
    input: ProcessWebhookInput,
    mockExistingPaymentState: PaymentStateType = PaymentState.CREATED
  ): Promise<WebhookProcessingResult> {
    const { rawBody, signature, webhookSecret } = input;

    // 1. Signature check with timing-safe comparison
    try {
      if (!this.verifySignature(rawBody, signature, webhookSecret)) {
        return {
          success: false,
          status: 401,
          message: 'Invalid webhook signature',
        };
      }
    } catch {
      return {
        success: false,
        status: 401,
        message: 'Webhook signature validation failed',
      };
    }

    const payload: WebhookPayload = JSON.parse(rawBody);
    const payment = payload.payload.payment.entity;
    const eventKey = `${payload.event}_${payment.id}`;

    // 2. Idempotency Check: Replay protection
    const existing = this.processedEvents.get(eventKey);
    if (existing) {
      return {
        ...existing,
        idempotentReplay: true,
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

      const eventId = crypto.randomUUID();
      const journal = createPaymentCaptureJournal({
        eventId,
        paymentId: payment.id,
        amountPaise,
      });

      // Assert balance invariant
      assertLedgerBalanced(journal);

      const result: WebhookProcessingResult = {
        success: true,
        status: 200,
        message: 'Payment captured and balanced ledger entries posted',
        paymentId: payment.id,
        journalEntries: journal,
      };

      // Store in idempotency registry
      this.processedEvents.set(eventKey, result);
      return result;
    }

    return {
      success: true,
      status: 200,
      message: `Ignored unhandled payment status: ${payment.status}`,
    };
  }
}

export const paymentWebhookProcessor = new PaymentWebhookProcessor();
