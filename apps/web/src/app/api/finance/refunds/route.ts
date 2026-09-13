import { NextRequest, NextResponse } from 'next/server';
import { calculateRefundProposal, type RefundFailureReason } from '@vent/domain';
import { authenticateRequest, requirePermission, handleAuthError } from '@/features/auth/auth-guard';
import {
  createProviderRefund,
  type ProviderRefundResult,
} from '@/features/payments/razorpay-refunds';
import { getSupabaseAdmin } from '@/lib/supabase-server';

function deriveRefundFacts(
  requestState: string,
  session: { state: string; duration_seconds: number | null; end_reason: string | null } | null
): { durationSeconds: number; failureReason: RefundFailureReason } | null {
  if (!session) {
    if (['technical_failed', 'expired', 'cancelled'].includes(requestState)) {
      return { durationSeconds: 0, failureReason: 'no_connection' };
    }
    return null;
  }

  const durationSeconds = Math.max(0, session.duration_seconds ?? 0);
  if (session.state === 'safety_ended' || session.end_reason === 'safety_escalation') {
    return { durationSeconds, failureReason: 'safety_ended' };
  }
  if (session.end_reason === 'technical_failure' || session.end_reason === 'listener_left') {
    return { durationSeconds, failureReason: 'technical_interruption' };
  }
  if (session.end_reason === 'user_left' || session.end_reason === 'normal_completion') {
    return { durationSeconds, failureReason: 'user_ended_voluntary' };
  }
  if (session.state === 'failed') {
    return { durationSeconds, failureReason: durationSeconds === 0 ? 'no_connection' : 'technical_interruption' };
  }
  return null;
}

export async function POST(req: NextRequest) {
  try {
    const session = await authenticateRequest(req);
    const json = await req.json().catch(() => ({}));
    const paymentId = typeof json.paymentId === 'string' ? json.paymentId : '';
    const requestedReason = typeof json.requestedReason === 'string'
      ? json.requestedReason.slice(0, 250)
      : typeof json.failureReason === 'string'
        ? json.failureReason.slice(0, 250)
        : null;

    if (!paymentId) {
      return NextResponse.json({ error: 'paymentId required' }, { status: 400 });
    }

    const adminClient = getSupabaseAdmin();
    const { data: paymentRow, error: payErr } = await adminClient
      .from('payments')
      .select('*')
      .eq('id', paymentId)
      .maybeSingle();

    if (payErr || !paymentRow) {
      return NextResponse.json({ error: 'Payment not found' }, { status: 404 });
    }

    const isOwner = (paymentRow as any).user_id === session.userId;
    if (!isOwner) {
      // Staff access comes from the canonical permission matrix and therefore
      // also enforces current-session AAL2.
      requirePermission(session, 'canInitiateRefunds');
    }

    if ((paymentRow as any).state === 'refunded') {
      return NextResponse.json({ error: 'Payment has already been refunded' }, { status: 409 });
    }
    if ((paymentRow as any).state !== 'captured') {
      return NextResponse.json({ error: `Cannot refund payment in state '${(paymentRow as any).state}'` }, { status: 400 });
    }

    // Authoritative binding: payment -> support request -> session. No caller
    // supplied duration/end reason participates in the policy decision.
    const { data: supportRequest, error: supportErr } = await adminClient
      .from('support_requests')
      .select('id, state')
      .eq('payment_order_id', paymentId)
      .maybeSingle();
    if (supportErr || !supportRequest) {
      return NextResponse.json(
        { error: 'Refund cannot be evaluated because the payment is not bound to a support request.', code: 'REFUND_EVIDENCE_MISSING' },
        { status: 409 }
      );
    }

    const { data: sessionRow, error: sessionErr } = await adminClient
      .from('sessions')
      .select('id, state, duration_seconds, end_reason')
      .eq('request_id', (supportRequest as any).id)
      .maybeSingle();
    if (sessionErr) {
      return NextResponse.json({ error: sessionErr.message }, { status: 500 });
    }

    const canonicalFacts = deriveRefundFacts(
      (supportRequest as any).state,
      sessionRow as any
    );
    if (!canonicalFacts) {
      return NextResponse.json(
        {
          error: 'There is not enough server-owned evidence to automatically determine refund eligibility.',
          code: 'REFUND_EVIDENCE_INCOMPLETE',
        },
        { status: 409 }
      );
    }

    const proposal = calculateRefundProposal({
      durationSeconds: canonicalFacts.durationSeconds,
      failureReason: canonicalFacts.failureReason,
      paymentAmountPaise: BigInt((paymentRow as any).amount_paise),
    });

    if (proposal.eligibleRefundPaise <= 0n) {
      return NextResponse.json({
        error: 'Session not eligible for automatic refund according to policy',
        rationale: proposal.rationale,
        canonicalFailureReason: canonicalFacts.failureReason,
      }, { status: 400 });
    }

    // Safety/conduct outcomes require a human with refund permission + AAL2.
    if (proposal.requiresSupervisorReview && isOwner) {
      return NextResponse.json(
        {
          error: 'This refund requires human review before money can move.',
          code: 'SUPERVISOR_REVIEW_REQUIRED',
          rationale: proposal.rationale,
        },
        { status: 409 }
      );
    }

    const rawClient = adminClient as any;
    const { data: refundResult, error: refundErr } = await rawClient.rpc('atomic_request_refund', {
      p_payment_id: paymentId,
      p_refund_amount_paise: Number(proposal.eligibleRefundPaise),
      p_reason: canonicalFacts.failureReason,
      p_actor_id: session.userId,
      p_actor_role: session.role,
    });

    if (refundErr) {
      return NextResponse.json({ error: refundErr.message }, { status: 500 });
    }
    if (!refundResult?.success) {
      const code = refundResult?.code;
      const status = code === 'ALREADY_REFUNDED' || code === 'REFUND_IN_FLIGHT' ? 409 : 400;
      return NextResponse.json({ error: refundResult?.error || 'Refund failed', code }, { status });
    }

    const providerPaymentId = (paymentRow as any).provider_payment_id;
    let provider: ProviderRefundResult = {
      outcome: 'not_configured',
      providerRefundId: null,
      detail: 'No provider payment reference is stored for this payment.',
    };

    if (providerPaymentId) {
      provider = await createProviderRefund({
        providerPaymentId,
        amountPaise: Number(proposal.eligibleRefundPaise),
        reason: canonicalFacts.failureReason,
      });
    }

    let providerState = refundResult.state;
    let paymentState = 'refund_pending';

    if (provider.outcome !== 'not_configured') {
      const { data: markResult, error: markErr } = await rawClient.rpc('atomic_mark_refund_state', {
        p_refund_id: refundResult.refund_id,
        p_state: provider.outcome,
        p_provider_refund_id: provider.providerRefundId,
        p_detail: provider.detail,
        p_actor_id: session.userId,
        p_actor_role: session.role,
      });
      if (markErr) {
        return NextResponse.json(
          {
            error: `Refund recorded locally but the provider result could not be stored: ${markErr.message}`,
            code: 'REFUND_STATE_NOT_RECORDED',
            refundId: refundResult.refund_id,
            providerOutcome: provider.outcome,
          },
          { status: 500 }
        );
      }
      providerState = markResult?.state ?? provider.outcome;
      paymentState = markResult?.payment_state ?? paymentState;
    }

    const settled = providerState === 'settled';

    return NextResponse.json(
      {
        paymentId,
        sessionId: (sessionRow as any)?.id ?? null,
        refundId: refundResult.refund_id,
        refundAmountPaise: Number(proposal.eligibleRefundPaise),
        refundPercentage: proposal.refundPercentage,
        rationale: proposal.rationale,
        canonicalFailureReason: canonicalFacts.failureReason,
        canonicalDurationSeconds: canonicalFacts.durationSeconds,
        requestedReason,
        state: providerState,
        paymentState,
        providerOutcome: provider.outcome,
        providerRefundId: provider.providerRefundId,
        providerDetail: provider.detail,
        ledgerPosted: settled,
        message: settled
          ? 'Refund settled by the provider and compensating ledger entries posted.'
          : provider.outcome === 'not_configured'
          ? 'Refund recorded as pending. No provider call was made — finance must complete the refund with the payment provider and mark it settled.'
          : `Refund recorded with provider outcome '${provider.outcome}'. ${provider.detail}`,
      },
      { status: 200 }
    );
  } catch (err: any) {
    if (err.name === 'AuthError') {
      return handleAuthError(err);
    }
    return NextResponse.json({ error: err.message || 'Refund failed' }, { status: 500 });
  }
}
