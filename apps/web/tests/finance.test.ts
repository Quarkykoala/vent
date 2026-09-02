import { describe, it, expect } from 'vitest';
import { calculateRefundProposal, createRefundJournal, assertLedgerBalanced } from '@vent/domain';

describe('Phase 8 — Finance & Refund Integration Tests', () => {
  it('generates balanced compensating journal entries when refunding technical failure', () => {
    const proposal = calculateRefundProposal({
      durationSeconds: 0,
      failureReason: 'no_connection',
      paymentAmountPaise: 19900n,
    });

    const eventId = 'evt-refund-test-1';
    const journal = createRefundJournal({
      eventId,
      paymentId: 'pay-orig-1',
      refundPaise: proposal.eligibleRefundPaise,
    });

    expect(journal).toHaveLength(2);
    expect(() => assertLedgerBalanced(journal)).not.toThrow();
  });
});
