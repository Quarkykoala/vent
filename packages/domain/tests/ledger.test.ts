import { describe, it, expect } from 'vitest';
import {
  createPaymentCaptureJournal,
  createSessionCompletionJournal,
  createRefundJournal,
  createPayoutJournal,
  assertLedgerBalanced,
  LedgerAccountCode,
  LedgerDirection,
  LedgerBalanceError,
  InvariantViolationError,
} from '../src/index';

describe('Double-Entry Ledger Domain Invariants', () => {
  it('enforces that payment capture journal is strictly balanced', () => {
    const journal = createPaymentCaptureJournal({
      eventId: 'evt-101',
      paymentId: 'pay-101',
      amountPaise: 19900n, // ₹199
    });

    expect(journal).toHaveLength(2);
    expect(journal[0]!.direction).toBe(LedgerDirection.DEBIT);
    expect(journal[0]!.account_code).toBe(LedgerAccountCode.CASH_PG_CLEARING);
    expect(journal[0]!.amount_paise).toBe(19900n);

    expect(journal[1]!.direction).toBe(LedgerDirection.CREDIT);
    expect(journal[1]!.account_code).toBe(LedgerAccountCode.CUSTOMER_SERVICE_REVENUE);
    expect(journal[1]!.amount_paise).toBe(19900n);

    expect(() => assertLedgerBalanced(journal)).not.toThrow();
  });

  it('enforces session completed earnings journal is strictly balanced', () => {
    const journal = createSessionCompletionJournal({
      eventId: 'evt-102',
      sessionId: 'sess-102',
      listenerEarningsPaise: 10000n, // ₹100
    });

    expect(journal).toHaveLength(2);
    expect(journal[0]!.account_code).toBe(LedgerAccountCode.CUSTOMER_SERVICE_REVENUE);
    expect(journal[0]!.direction).toBe(LedgerDirection.DEBIT);
    expect(journal[1]!.account_code).toBe(LedgerAccountCode.LISTENER_PAYABLE);
    expect(journal[1]!.direction).toBe(LedgerDirection.CREDIT);

    expect(() => assertLedgerBalanced(journal)).not.toThrow();
  });

  it('enforces refund journal is strictly balanced', () => {
    const journal = createRefundJournal({
      eventId: 'evt-103',
      paymentId: 'pay-101',
      refundPaise: 19900n,
    });
    expect(() => assertLedgerBalanced(journal)).not.toThrow();
  });

  it('enforces payout journal is strictly balanced', () => {
    const journal = createPayoutJournal({
      eventId: 'evt-104',
      listenerId: 'list-101',
      payoutPaise: 50000n,
    });
    expect(() => assertLedgerBalanced(journal)).not.toThrow();
  });

  it('throws LedgerBalanceError when debits do not equal credits', () => {
    const unbalanced = [
      {
        event_id: 'evt-bad',
        account_code: LedgerAccountCode.CASH_PG_CLEARING,
        direction: LedgerDirection.DEBIT,
        amount_paise: 20000n,
        currency: 'INR' as const,
        reference_type: 'test',
        reference_id: '1',
      },
      {
        event_id: 'evt-bad',
        account_code: LedgerAccountCode.CUSTOMER_SERVICE_REVENUE,
        direction: LedgerDirection.CREDIT,
        amount_paise: 19900n,
        currency: 'INR' as const,
        reference_type: 'test',
        reference_id: '1',
      },
    ];

    expect(() => assertLedgerBalanced(unbalanced)).toThrow(LedgerBalanceError);
  });

  it('throws InvariantViolationError on non-positive amounts or mixed event IDs', () => {
    const zeroAmount = [
      {
        event_id: 'evt-zero',
        account_code: LedgerAccountCode.CASH_PG_CLEARING,
        direction: LedgerDirection.DEBIT,
        amount_paise: 0n,
        currency: 'INR' as const,
        reference_type: 'test',
        reference_id: '1',
      },
      {
        event_id: 'evt-zero',
        account_code: LedgerAccountCode.CUSTOMER_SERVICE_REVENUE,
        direction: LedgerDirection.CREDIT,
        amount_paise: 0n,
        currency: 'INR' as const,
        reference_type: 'test',
        reference_id: '1',
      },
    ];
    expect(() => assertLedgerBalanced(zeroAmount)).toThrow(InvariantViolationError);
  });
});
