import { NextRequest, NextResponse } from 'next/server';
import { calculateRefundProposal, UserRole } from '@vent/domain';
import { authenticateRequest, handleAuthError } from '@/features/auth/auth-guard';
import {
  createProviderRefund,
  type ProviderRefundResult,
} from '@/features/payments/razorpay-refunds';
import { getSupabaseAdmin } from '@/lib/supabase-server';

export async function POST(req: NextRequest) {
  try {
    const session = await authenticateRequest(req);
    const json = await req.json().catch(() => ({}));
    const { paymentId, sessionId, failureReason, durationSeconds = 0 } = json;

    if (!paymentId || !failureReason) {
      return NextResponse.json({ error: 'paymentId and failureReason required' }, { status: 400 });
    }

    const adminClient = getSupabaseAdmin();

    // 1. Look up payment in PostgreSQL
    const { data: paymentRow, error: payErr } = await adminClient
      .from('payments')
      .select('*')
      .eq('id', paymentId)
      .maybeSingle();

    if (payErr || !paymentRow) {
      return NextResponse.json({ error: 'Payment not found' }, { status: 404 });
    }

    // 2. Authorize caller: must be payment owner or finance/super_admin
    const isOwner = (paymentRow as any).user_id === session.userId;
    const isStaff = [UserRole.FINANCE, UserRole.SUPER_ADMIN].includes(session.role as any);

    if (!isOwner && !isStaff) {
      return NextResponse.json({ error: 'Forbidden: Unauthorized to refund this payment' }, { status: 403 });
    }

    // 3. State check
    if ((paymentRow as any).state === 'refunded') {
      return NextResponse.json({ error: 'Payment has already been refunded' }, { status: 409 });
    }

    if ((paymentRow as any).state !== 'captured') {
      return NextResponse.json({ error: `Cannot refund payment in state '${(paymentRow as any).state}'` }, { status: 400 });
    }

    // 4. Calculate eligible refund amount based on domain rules
    const proposal = calculateRefundProposal({
      durationSeconds,
      failureReason,
      paymentAmountPaise: BigInt((paymentRow as any).amount_paise),
    });

    if (proposal.eligibleRefundPaise <= 0n) {
      return NextResponse.json({
        error: 'Session not eligible for refund according to policy',
        rationale: proposal.rationale,
      }, { status: 400 });
    }

    // 5. Record the refund request. No money has moved and no ledger entry is
    //    posted until the provider (or a finance owner) confirms settlement.
    const rawClient = adminClient as any;
    const { data: refundResult, error: refundErr } = await rawClient.rpc('atomic_request_refund', {
      p_payment_id: paymentId,
      p_refund_amount_paise: Number(proposal.eligibleRefundPaise),
      p_reason: failureReason,
      p_actor_id: session.userId,
      p_actor_role: session.role,
    });

    if (refundErr) {
      return NextResponse.json({ error: refundErr.message }, { status: 500 });
    }

    if (!refundResult || !refundResult.success) {
      const code = refundResult?.code;
      const status = code === 'ALREADY_REFUNDED' || code === 'REFUND_IN_FLIGHT' ? 409 : 400;
      return NextResponse.json({ error: refundResult?.error || 'Refund failed', code }, { status });
    }

    // 6. Attempt the provider refund and record what actually happened.
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
        reason: failureReason,
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
        sessionId,
        refundId: refundResult.refund_id,
        refundAmountPaise: Number(proposal.eligibleRefundPaise),
        refundPercentage: proposal.refundPercentage,
        rationale: proposal.rationale,
        // Truthful reporting: `state` describes the provider outcome, and money
        // is only described as returned when the provider settled it.
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
