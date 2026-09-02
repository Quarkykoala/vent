import { describe, it, expect } from 'vitest';
import {
  calculateRefundProposal,
  generateWeeklyPayoutProposal,
  approvePayoutProposal,
  generateReconciliationReport,
  DEFAULT_PRICING,
} from '../src/index';

describe('Phase 8 — Refunds, Payouts & Financial Invariants', () => {
  const fullAmount = DEFAULT_PRICING.pricePaise; // 19900n

  describe('Technical Failure Refund Matrix (SOP Part E)', () => {
    it('proposes 100% refund for no connection established', () => {
      const proposal = calculateRefundProposal({
        durationSeconds: 0,
        failureReason: 'no_connection',
        paymentAmountPaise: fullAmount,
      });

      expect(proposal.refundPercentage).toBe(100);
      expect(proposal.eligibleRefundPaise).toBe(fullAmount);
      expect(proposal.requiresSupervisorReview).toBe(false);
    });

    it('proposes 100% refund for technical failure interrupted before 25% duration (< 300s of 1200s)', () => {
      const proposal = calculateRefundProposal({
        durationSeconds: 150, // 2.5 minutes
        targetDurationSeconds: 1200,
        failureReason: 'technical_interruption',
        paymentAmountPaise: fullAmount,
      });

      expect(proposal.refundPercentage).toBe(100);
      expect(proposal.eligibleRefundPaise).toBe(fullAmount);
    });

    it('proposes 50% refund for technical failure between 25% and 75% duration (300s - 900s)', () => {
      const proposal = calculateRefundProposal({
        durationSeconds: 600, // 10 minutes (50%)
        targetDurationSeconds: 1200,
        failureReason: 'technical_interruption',
        paymentAmountPaise: fullAmount,
      });

      expect(proposal.refundPercentage).toBe(50);
      expect(proposal.eligibleRefundPaise).toBe(fullAmount / 2n);
    });

    it('proposes 0% automatic refund when user voluntarily departs normally', () => {
      const proposal = calculateRefundProposal({
        durationSeconds: 1000,
        targetDurationSeconds: 1200,
        failureReason: 'user_ended_voluntary',
        paymentAmountPaise: fullAmount,
      });

      expect(proposal.refundPercentage).toBe(0);
      expect(proposal.eligibleRefundPaise).toBe(0n);
    });

    it('flags safety-ended sessions for supervisor review without auto-denial', () => {
      const proposal = calculateRefundProposal({
        durationSeconds: 300,
        failureReason: 'safety_ended',
        paymentAmountPaise: fullAmount,
      });

      expect(proposal.requiresSupervisorReview).toBe(true);
      expect(proposal.eligibleRefundPaise).toBe(fullAmount);
    });
  });

  describe('Payout Proposal & Dispute Hold Invariant (SOP Part F)', () => {
    it('excludes disputed sessions and safety incident sessions from eligible payout batch', () => {
      const sessions = [
        {
          sessionId: 'sess-ok-1',
          listenerId: 'list-1',
          earningsPaise: 10000n,
          completedAtIso: '2026-09-01T10:00:00Z',
          isDisputed: false,
          hasSafetyIncident: false,
        },
        {
          sessionId: 'sess-ok-2',
          listenerId: 'list-1',
          earningsPaise: 10000n,
          completedAtIso: '2026-09-01T11:00:00Z',
          isDisputed: false,
          hasSafetyIncident: false,
        },
        {
          sessionId: 'sess-held-dispute',
          listenerId: 'list-2',
          earningsPaise: 10000n,
          completedAtIso: '2026-09-01T12:00:00Z',
          isDisputed: true, // DISPUTE HOLD
          hasSafetyIncident: false,
        },
        {
          sessionId: 'sess-held-safety',
          listenerId: 'list-3',
          earningsPaise: 10000n,
          completedAtIso: '2026-09-01T13:00:00Z',
          isDisputed: false,
          hasSafetyIncident: true, // SAFETY HOLD
        },
      ];

      const proposal = generateWeeklyPayoutProposal({
        sessions,
        periodStartIso: '2026-08-25T00:00:00Z',
        periodEndIso: '2026-09-01T23:59:59Z',
      });

      expect(proposal.heldSessionsCount).toBe(2);
      expect(proposal.totalBatchPaise).toBe(20000n); // Only 2 eligible sessions of 10000n
      expect(proposal.listeners).toHaveLength(1); // Only list-1 has eligible payout
      expect(proposal.listeners[0]?.listenerId).toBe('list-1');
      expect(proposal.listeners[0]?.totalPayoutPaise).toBe(20000n);

      // Must NOT be auto-approved
      expect(proposal.approvedByFinance).toBe(false);
    });

    it('requires human finance reviewer approval to mark batch approved', () => {
      const proposal = generateWeeklyPayoutProposal({
        sessions: [
          {
            sessionId: 'sess-ok',
            listenerId: 'list-1',
            earningsPaise: 10000n,
            completedAtIso: '2026-09-01T10:00:00Z',
            isDisputed: false,
            hasSafetyIncident: false,
          },
        ],
        periodStartIso: '2026-08-25T00:00:00Z',
        periodEndIso: '2026-09-01T23:59:59Z',
      });

      const approved = approvePayoutProposal(proposal, 'finance-reviewer-uuid-123');
      expect(approved.approvedByFinance).toBe(true);
      expect(approved.approvedAtIso).not.toBeNull();
    });
  });

  describe('Reconciliation Discrepancy Detection', () => {
    it('detects missing transactions and status mismatches', () => {
      const providerTxns = [
        { providerPaymentId: 'pay_matched', amountPaise: 19900n, status: 'captured' as const },
        { providerPaymentId: 'pay_missing_local', amountPaise: 19900n, status: 'captured' as const },
      ];

      const localTxns = [
        { providerPaymentId: 'pay_matched', amountPaise: 19900n, status: 'captured' as const },
      ];

      const report = generateReconciliationReport(providerTxns, localTxns);
      expect(report.matchedCount).toBe(1);
      expect(report.discrepanciesCount).toBe(1);
      expect(report.discrepancies[0]?.type).toBe('missing_in_local');
    });
  });
});
