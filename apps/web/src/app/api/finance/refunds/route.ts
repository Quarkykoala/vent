import { NextRequest, NextResponse } from 'next/server';
import { calculateRefundProposal, UserRole } from '@vent/domain';
import { authenticateRequest, handleAuthError } from '@/features/auth/auth-guard';
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

    // 5. Execute atomic refund transaction in PostgreSQL
    const rawClient = adminClient as any;
    const { data: refundResult, error: refundErr } = await rawClient.rpc('atomic_execute_refund', {
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
      return NextResponse.json({ error: refundResult?.error || 'Refund failed' }, { status: 400 });
    }

    return NextResponse.json({
      paymentId,
      sessionId,
      refundAmountPaise: Number(proposal.eligibleRefundPaise),
      refundPercentage: proposal.refundPercentage,
      rationale: proposal.rationale,
      state: 'refunded',
      refundedAt: refundResult.refunded_at,
      message: 'Refund successfully executed and double-entry compensating ledger posted.',
    }, { status: 200 });
  } catch (err: any) {
    if (err.name === 'AuthError') {
      return handleAuthError(err);
    }
    return NextResponse.json({ error: err.message || 'Refund failed' }, { status: 500 });
  }
}
