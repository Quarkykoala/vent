import {
  LedgerAccountCode,
  LedgerDirection,
  type LedgerAccountCodeType,
  type LedgerDirectionType,
} from '../enums';
import { LedgerBalanceError, InvariantViolationError } from '../errors';

export interface UnpersistedLedgerEntry {
  event_id: string;
  account_code: LedgerAccountCodeType;
  direction: LedgerDirectionType;
  amount_paise: bigint;
  currency: 'INR';
  reference_type: string;
  reference_id: string;
}

/**
 * Validates that an array of ledger entries for a single event is strictly balanced.
 * Sum(Debits) must equal Sum(Credits), and all amounts must be positive integers.
 */
export function assertLedgerBalanced(entries: UnpersistedLedgerEntry[]): void {
  if (entries.length === 0) {
    throw new InvariantViolationError('Ledger event cannot have zero entries');
  }

  const eventId = entries[0]!.event_id;
  let totalDebit = 0n;
  let totalCredit = 0n;

  for (const entry of entries) {
    if (entry.event_id !== eventId) {
      throw new InvariantViolationError(
        `All ledger entries in a journal batch must share the same event_id. Expected ${eventId}, got ${entry.event_id}`
      );
    }
    if (entry.amount_paise <= 0n) {
      throw new InvariantViolationError(
        `Ledger entry amount must be a positive integer in paise, received: ${entry.amount_paise}`
      );
    }

    if (entry.direction === LedgerDirection.DEBIT) {
      totalDebit += entry.amount_paise;
    } else if (entry.direction === LedgerDirection.CREDIT) {
      totalCredit += entry.amount_paise;
    } else {
      throw new InvariantViolationError(`Invalid ledger direction: ${entry.direction}`);
    }
  }

  if (totalDebit !== totalCredit) {
    throw new LedgerBalanceError({
      eventId,
      totalDebitPaise: totalDebit,
      totalCreditPaise: totalCredit,
    });
  }
}

/**
 * Creates balanced journal entries for capturing a customer payment.
 * DR: cash_pg_clearing
 * CR: customer_service_revenue
 */
export function createPaymentCaptureJournal(params: {
  eventId: string;
  paymentId: string;
  amountPaise: bigint;
}): UnpersistedLedgerEntry[] {
  const entries: UnpersistedLedgerEntry[] = [
    {
      event_id: params.eventId,
      account_code: LedgerAccountCode.CASH_PG_CLEARING,
      direction: LedgerDirection.DEBIT,
      amount_paise: params.amountPaise,
      currency: 'INR',
      reference_type: 'payment',
      reference_id: params.paymentId,
    },
    {
      event_id: params.eventId,
      account_code: LedgerAccountCode.CUSTOMER_SERVICE_REVENUE,
      direction: LedgerDirection.CREDIT,
      amount_paise: params.amountPaise,
      currency: 'INR',
      reference_type: 'payment',
      reference_id: params.paymentId,
    },
  ];
  assertLedgerBalanced(entries);
  return entries;
}

/**
 * Creates balanced journal entries for allocating listener earnings upon completed session.
 * DR: customer_service_revenue
 * CR: listener_payable
 */
export function createSessionCompletionJournal(params: {
  eventId: string;
  sessionId: string;
  listenerEarningsPaise: bigint;
}): UnpersistedLedgerEntry[] {
  const entries: UnpersistedLedgerEntry[] = [
    {
      event_id: params.eventId,
      account_code: LedgerAccountCode.CUSTOMER_SERVICE_REVENUE,
      direction: LedgerDirection.DEBIT,
      amount_paise: params.listenerEarningsPaise,
      currency: 'INR',
      reference_type: 'session',
      reference_id: params.sessionId,
    },
    {
      event_id: params.eventId,
      account_code: LedgerAccountCode.LISTENER_PAYABLE,
      direction: LedgerDirection.CREDIT,
      amount_paise: params.listenerEarningsPaise,
      currency: 'INR',
      reference_type: 'session',
      reference_id: params.sessionId,
    },
  ];
  assertLedgerBalanced(entries);
  return entries;
}

/**
 * Creates balanced journal entries for processing a refund.
 * DR: customer_service_revenue
 * CR: cash_pg_clearing
 */
export function createRefundJournal(params: {
  eventId: string;
  paymentId: string;
  refundPaise: bigint;
}): UnpersistedLedgerEntry[] {
  const entries: UnpersistedLedgerEntry[] = [
    {
      event_id: params.eventId,
      account_code: LedgerAccountCode.CUSTOMER_SERVICE_REVENUE,
      direction: LedgerDirection.DEBIT,
      amount_paise: params.refundPaise,
      currency: 'INR',
      reference_type: 'payment_refund',
      reference_id: params.paymentId,
    },
    {
      event_id: params.eventId,
      account_code: LedgerAccountCode.CASH_PG_CLEARING,
      direction: LedgerDirection.CREDIT,
      amount_paise: params.refundPaise,
      currency: 'INR',
      reference_type: 'payment_refund',
      reference_id: params.paymentId,
    },
  ];
  assertLedgerBalanced(entries);
  return entries;
}

/**
 * Creates balanced journal entries for approving and executing a listener payout.
 * DR: listener_payable
 * CR: cash_pg_clearing
 */
export function createPayoutJournal(params: {
  eventId: string;
  listenerId: string;
  payoutPaise: bigint;
}): UnpersistedLedgerEntry[] {
  const entries: UnpersistedLedgerEntry[] = [
    {
      event_id: params.eventId,
      account_code: LedgerAccountCode.LISTENER_PAYABLE,
      direction: LedgerDirection.DEBIT,
      amount_paise: params.payoutPaise,
      currency: 'INR',
      reference_type: 'listener_payout',
      reference_id: params.listenerId,
    },
    {
      event_id: params.eventId,
      account_code: LedgerAccountCode.CASH_PG_CLEARING,
      direction: LedgerDirection.CREDIT,
      amount_paise: params.payoutPaise,
      currency: 'INR',
      reference_type: 'listener_payout',
      reference_id: params.listenerId,
    },
  ];
  assertLedgerBalanced(entries);
  return entries;
}
