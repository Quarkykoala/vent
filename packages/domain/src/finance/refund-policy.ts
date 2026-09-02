export type RefundFailureReason =
  | 'no_connection'
  | 'technical_interruption'
  | 'user_ended_voluntary'
  | 'safety_ended'
  | 'listener_abuse';

export interface CalculateRefundParams {
  durationSeconds: number;
  targetDurationSeconds?: number; // default 1200s (20 mins)
  failureReason: RefundFailureReason;
  paymentAmountPaise: bigint;
}

export interface RefundProposalResult {
  eligibleRefundPaise: bigint;
  refundPercentage: number;
  requiresSupervisorReview: boolean;
  rationale: string;
}

/**
 * Server-authoritative refund calculation per SOP Part E (Technical Failure Refund Matrix).
 * INVARIANT: Never trust refund amounts submitted by client.
 */
export function calculateRefundProposal(
  params: CalculateRefundParams
): RefundProposalResult {
  const targetSeconds = params.targetDurationSeconds || 1200;
  const ratio = params.durationSeconds / targetSeconds;

  // 1. No connection at all -> 100% refund
  if (params.failureReason === 'no_connection' || params.durationSeconds === 0) {
    return {
      eligibleRefundPaise: params.paymentAmountPaise,
      refundPercentage: 100,
      requiresSupervisorReview: false,
      rationale: 'No audio connection established: 100% full refund.',
    };
  }

  // 2. Severe technical failure (<25% duration completed) -> 100% refund
  if (params.failureReason === 'technical_interruption' && ratio < 0.25) {
    return {
      eligibleRefundPaise: params.paymentAmountPaise,
      refundPercentage: 100,
      requiresSupervisorReview: false,
      rationale: 'Call interrupted by technical failure before 25% duration: 100% full refund.',
    };
  }

  // 3. Partial technical failure (25% - 75% completed) -> 50% pro-rata replacement credit
  if (params.failureReason === 'technical_interruption' && ratio >= 0.25 && ratio <= 0.75) {
    const halfRefund = params.paymentAmountPaise / 2n;
    return {
      eligibleRefundPaise: halfRefund,
      refundPercentage: 50,
      requiresSupervisorReview: false,
      rationale: 'Technical failure during session (25-75% duration): 50% proportional refund.',
    };
  }

  // 4. Safety ended sessions -> Never auto-deny, requires clinical supervisor review
  if (params.failureReason === 'safety_ended') {
    return {
      eligibleRefundPaise: params.paymentAmountPaise,
      refundPercentage: 100,
      requiresSupervisorReview: true,
      rationale: 'Safety-ended session: requires clinical supervisor verification before settlement.',
    };
  }

  // 5. Listener abuse confirmed -> 100% refund
  if (params.failureReason === 'listener_abuse') {
    return {
      eligibleRefundPaise: params.paymentAmountPaise,
      refundPercentage: 100,
      requiresSupervisorReview: true,
      rationale: 'Reported listener conduct violation: 100% refund pending ops audit.',
    };
  }

  // 6. User voluntary departure after successful connection -> 0% default refund
  return {
    eligibleRefundPaise: 0n,
    refundPercentage: 0,
    requiresSupervisorReview: false,
    rationale: 'User voluntarily concluded session normally: no automatic refund.',
  };
}
