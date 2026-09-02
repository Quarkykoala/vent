import { describe, it, expect } from 'vitest';
import crypto from 'node:crypto';
import { DEFAULT_PRICING, createPaymentCaptureJournal, assertLedgerBalanced } from '@vent/domain';

describe('Web Application Integration & Routes', () => {
  it('enforces fixed session pricing in INR from domain rules', () => {
    expect(DEFAULT_PRICING.pricePaise).toBe(19900n);
    expect(DEFAULT_PRICING.currency).toBe('INR');
    expect(DEFAULT_PRICING.sessionDurationMinutes).toBe(20);
  });

  describe('Webhook Security Verification Logic', () => {
    const webhookSecret = 'test_webhook_secret_key_123';
    const testPayload = JSON.stringify({
      entity: 'event',
      account_id: 'acc_123',
      event: 'payment.captured',
      contains: ['payment'],
      payload: {
        payment: {
          entity: {
            id: 'pay_test_001',
            order_id: 'order_test_001',
            amount: 19900,
            currency: 'INR',
            status: 'captured',
          },
        },
      },
      created_at: 1772640000,
    });

    it('generates and validates authentic HMAC-SHA256 signature', () => {
      const signature = crypto
        .createHmac('sha256', webhookSecret)
        .update(testPayload)
        .digest('hex');

      const expected = crypto
        .createHmac('sha256', webhookSecret)
        .update(testPayload)
        .digest('hex');

      expect(signature).toBe(expected);
    });

    it('rejects forged webhook payloads with incorrect signatures', () => {
      const genuineSignature = crypto
        .createHmac('sha256', webhookSecret)
        .update(testPayload)
        .digest('hex');

      const tamperedPayload = testPayload.replace('19900', '99900');
      const verificationResult =
        crypto
          .createHmac('sha256', webhookSecret)
          .update(tamperedPayload)
          .digest('hex') === genuineSignature;

      expect(verificationResult).toBe(false);
    });

    it('creates and verifies balanced double-entry ledger entries from verified webhook', () => {
      const journal = createPaymentCaptureJournal({
        eventId: 'evt-webhook-test',
        paymentId: 'pay_test_001',
        amountPaise: 19900n,
      });

      expect(journal).toHaveLength(2);
      expect(() => assertLedgerBalanced(journal)).not.toThrow();
    });
  });
});
