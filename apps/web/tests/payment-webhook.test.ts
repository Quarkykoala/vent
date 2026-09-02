import { describe, it, expect } from 'vitest';
import crypto from 'node:crypto';
import { PaymentWebhookProcessor } from '../src/features/payments/payment-processor';
import { LedgerAccountCode, LedgerDirection, assertLedgerBalanced } from '@vent/domain';

describe('Phase 3 — Payment Webhooks & Ledger Property Tests', () => {
  const secret = 'webhook_secret_key_12345';
  const processor = new PaymentWebhookProcessor();

  function makePayload(paymentId: string, amount: number) {
    return JSON.stringify({
      event: 'payment.captured',
      account_id: 'acc_rzp_test',
      payload: {
        payment: {
          entity: {
            id: paymentId,
            order_id: `order_${paymentId}`,
            amount,
            currency: 'INR',
            status: 'captured',
          },
        },
      },
    });
  }

  function signPayload(body: string, secretKey: string) {
    return crypto.createHmac('sha256', secretKey).update(body).digest('hex');
  }

  it('authenticates genuine webhook and posts balanced double-entry ledger entries', async () => {
    const rawBody = makePayload('pay_genuine_001', 19900);
    const signature = signPayload(rawBody, secret);

    const result = await processor.processWebhook({
      rawBody,
      signature,
      webhookSecret: secret,
    });

    expect(result.success).toBe(true);
    expect(result.status).toBe(200);
    expect(result.paymentId).toBe('pay_genuine_001');
    expect(result.journalEntries).toBeDefined();
    expect(result.journalEntries).toHaveLength(2);

    // Verify DR cash, CR revenue
    const [dr, cr] = result.journalEntries!;
    expect(dr?.account_code).toBe(LedgerAccountCode.CASH_PG_CLEARING);
    expect(dr?.direction).toBe(LedgerDirection.DEBIT);
    expect(dr?.amount_paise).toBe(19900n);

    expect(cr?.account_code).toBe(LedgerAccountCode.CUSTOMER_SERVICE_REVENUE);
    expect(cr?.direction).toBe(LedgerDirection.CREDIT);
    expect(cr?.amount_paise).toBe(19900n);

    // Ledger invariant test
    expect(() => assertLedgerBalanced(result.journalEntries!)).not.toThrow();
  });

  it('CRITICAL ACCEPTANCE: Duplicate webhook replay produces exactly ONE capture and idempotent response', async () => {
    const rawBody = makePayload('pay_duplicate_002', 19900);
    const signature = signPayload(rawBody, secret);

    // First delivery
    const firstResult = await processor.processWebhook({
      rawBody,
      signature,
      webhookSecret: secret,
    });
    expect(firstResult.success).toBe(true);
    expect(firstResult.idempotentReplay).toBeFalsy();

    // Duplicate delivery
    const secondResult = await processor.processWebhook({
      rawBody,
      signature,
      webhookSecret: secret,
    });
    expect(secondResult.success).toBe(true);
    expect(secondResult.idempotentReplay).toBe(true);
    expect(secondResult.paymentId).toBe('pay_duplicate_002');
  });

  it('CRITICAL ACCEPTANCE: Rejects forged webhook with invalid signature', async () => {
    const rawBody = makePayload('pay_forged_003', 19900);
    const forgedSignature = 'abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789';

    const result = await processor.processWebhook({
      rawBody,
      signature: forgedSignature,
      webhookSecret: secret,
    });

    expect(result.success).toBe(false);
    expect(result.status).toBe(401);
    expect(result.message).toMatch(/Invalid webhook signature/i);
  });

  describe('Ledger Property Balance Invariant', () => {
    it('always balances across 50 random positive rupee amounts in paise', () => {
      for (let i = 0; i < 50; i++) {
        // Random amount between ₹10 and ₹1,000 in paise
        const randomPaise = BigInt(Math.floor(1000 + Math.random() * 99000));
        const journal = [
          {
            event_id: `evt_prop_${i}`,
            account_code: LedgerAccountCode.CASH_PG_CLEARING,
            direction: LedgerDirection.DEBIT,
            amount_paise: randomPaise,
            currency: 'INR' as const,
            reference_type: 'payment',
            reference_id: `pay_${i}`,
          },
          {
            event_id: `evt_prop_${i}`,
            account_code: LedgerAccountCode.CUSTOMER_SERVICE_REVENUE,
            direction: LedgerDirection.CREDIT,
            amount_paise: randomPaise,
            currency: 'INR' as const,
            reference_type: 'payment',
            reference_id: `pay_${i}`,
          },
        ];

        expect(() => assertLedgerBalanced(journal)).not.toThrow();
      }
    });
  });
});
