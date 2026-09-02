import { InvariantViolationError } from '../errors';

export interface CompletedSessionSummary {
  sessionId: string;
  listenerId: string;
  earningsPaise: bigint;
  completedAtIso: string;
  isDisputed: boolean;
  hasSafetyIncident: boolean;
}

export interface ListenerPayoutSummary {
  listenerId: string;
  eligibleSessionsCount: number;
  totalPayoutPaise: bigint;
  sessionIds: string[];
}

export interface PayoutProposalBatch {
  batchId: string;
  periodStartIso: string;
  periodEndIso: string;
  totalBatchPaise: bigint;
  listeners: ListenerPayoutSummary[];
  heldSessionsCount: number;
  approvedByFinance: boolean;
  approvedAtIso: string | null;
}

/**
 * Computes weekly payout batch for finance review.
 * INVARIANTS:
 * - NO automated money movement without human finance approval.
 * - Disputed or safety-escalated sessions are placed on DISPUTE HOLD.
 */
export function generateWeeklyPayoutProposal(params: {
  batchId?: string;
  sessions: CompletedSessionSummary[];
  periodStartIso: string;
  periodEndIso: string;
}): PayoutProposalBatch {
  const batchId = params.batchId || crypto.randomUUID();
  const listenerMap = new Map<string, { sessionIds: string[]; totalPaise: bigint }>();
  let heldCount = 0;
  let grandTotalPaise = 0n;

  for (const s of params.sessions) {
    // DISPUTE HOLD CHECK: Exclude disputed sessions and safety incidents
    if (s.isDisputed || s.hasSafetyIncident) {
      heldCount++;
      continue;
    }

    if (s.earningsPaise <= 0n) {
      throw new InvariantViolationError(`Session ${s.sessionId} has non-positive earnings.`);
    }

    const existing = listenerMap.get(s.listenerId) || { sessionIds: [], totalPaise: 0n };
    existing.sessionIds.push(s.sessionId);
    existing.totalPaise += s.earningsPaise;
    listenerMap.set(s.listenerId, existing);

    grandTotalPaise += s.earningsPaise;
  }

  const listeners: ListenerPayoutSummary[] = Array.from(listenerMap.entries()).map(
    ([listenerId, data]) => ({
      listenerId,
      eligibleSessionsCount: data.sessionIds.length,
      totalPayoutPaise: data.totalPaise,
      sessionIds: data.sessionIds,
    })
  );

  return {
    batchId,
    periodStartIso: params.periodStartIso,
    periodEndIso: params.periodEndIso,
    totalBatchPaise: grandTotalPaise,
    listeners,
    heldSessionsCount: heldCount,
    approvedByFinance: false,
    approvedAtIso: null,
  };
}

/**
 * Approves payout batch. Enforces human finance approval requirement.
 */
export function approvePayoutProposal(
  proposal: PayoutProposalBatch,
  financeUserId: string,
  approvalTimeIso: string = new Date().toISOString()
): PayoutProposalBatch {
  if (!financeUserId || financeUserId.trim().length === 0) {
    throw new InvariantViolationError('Payout batch approval requires verified finance reviewer ID.');
  }

  return {
    ...proposal,
    approvedByFinance: true,
    approvedAtIso: approvalTimeIso,
  };
}
