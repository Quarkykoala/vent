import { NextRequest, NextResponse } from 'next/server';
import {
  DEFAULT_PRICING,
  generateWeeklyPayoutProposal,
  type CompletedSessionSummary,
  UserRole,
} from '@vent/domain';
import { authenticateRequest, requireRole, handleAuthError } from '@/features/auth/auth-guard';
import { getSupabaseAdmin } from '@/lib/supabase-server';

/**
 * Payout proposal.
 *
 * The batch total is COMPUTED from completed sessions — never supplied by the
 * caller. Sessions under dispute or with a safety incident are placed on hold
 * and excluded from the payable total. The batch always lands in
 * `pending_approval`: no automatic money movement exists.
 */
export async function POST(req: NextRequest) {
  try {
    const session = await authenticateRequest(req);
    requireRole(session, [UserRole.FINANCE, UserRole.SUPER_ADMIN]);

    const json = await req.json().catch(() => ({}));
    const periodStart = json.periodStart || new Date(Date.now() - 7 * 86400000).toISOString();
    const periodEnd = json.periodEnd || new Date().toISOString();

    if (typeof json.totalPaise !== 'undefined') {
      // Rejected loudly rather than ignored: a caller-supplied amount would make
      // the batch figure unattributable.
      return NextResponse.json(
        {
          error: 'Payout totals are computed from completed sessions and cannot be supplied by the caller.',
          code: 'TOTAL_NOT_CLIENT_SUPPLIED',
        },
        { status: 400 }
      );
    }

    const adminClient = getSupabaseAdmin();

    // 1. Completed sessions in the period.
    const { data: sessionRows, error: sessionErr } = await adminClient
      .from('sessions')
      .select('id, listener_id, request_id, started_at, state')
      .in('state', ['ended', 'safety_ended'])
      .gte('started_at', periodStart)
      .lte('started_at', periodEnd);
    if (sessionErr) {
      return NextResponse.json({ error: sessionErr.message }, { status: 500 });
    }

    const sessions = (sessionRows ?? []) as Array<{
      id: string;
      listener_id: string;
      request_id: string;
      started_at: string;
      state: string;
    }>;

    if (sessions.length === 0) {
      return NextResponse.json(
        {
          error: 'No completed sessions in this period — nothing to propose for payout.',
          code: 'NO_ELIGIBLE_SESSIONS',
        },
        { status: 400 }
      );
    }

    const requestIds = sessions.map((s) => s.request_id);
    const sessionIds = sessions.map((s) => s.id);

    // 2. Safety incidents for those sessions.
    const { data: safetyRows } = await adminClient
      .from('safety_cases')
      .select('session_id')
      .in('session_id', sessionIds);
    const safetySessionIds = new Set((safetyRows ?? []).map((r: any) => r.session_id as string));

    // 3. Disputes: any refund on the session's payment holds the session.
    const { data: requestRows } = await adminClient
      .from('support_requests')
      .select('id, payment_order_id')
      .in('id', requestIds);
    const paymentIds = (requestRows ?? [])
      .map((r: any) => r.payment_order_id as string | null)
      .filter((v): v is string => Boolean(v));

    let refundPaymentIds = new Set<string>();
    if (paymentIds.length > 0) {
      const { data: refundRows } = await adminClient
        .from('refunds')
        .select('payment_id, state')
        .in('payment_id', paymentIds);
      refundPaymentIds = new Set(
        (refundRows ?? []).map((r: any) => r.payment_id as string)
      );
    }
    const paymentByRequest = new Map(
      (requestRows ?? []).map((r: any) => [r.id as string, r.payment_order_id as string | null])
    );

    // 4. Build the summary set and let the domain engine apply holds + totals.
    const summaries: CompletedSessionSummary[] = sessions.map((s) => {
      const paymentId = paymentByRequest.get(s.request_id) ?? null;
      return {
        sessionId: s.id,
        listenerId: s.listener_id,
        earningsPaise: DEFAULT_PRICING.listenerEarningsPaise,
        completedAtIso: s.started_at,
        isDisputed: Boolean(paymentId && refundPaymentIds.has(paymentId)),
        hasSafetyIncident: safetySessionIds.has(s.id) || s.state === 'safety_ended',
      };
    });

    const proposal = generateWeeklyPayoutProposal({
      sessions: summaries,
      periodStartIso: periodStart,
      periodEndIso: periodEnd,
    });

    if (proposal.totalBatchPaise <= 0n) {
      return NextResponse.json(
        {
          error: 'Every completed session in this period is on dispute or safety hold.',
          code: 'ALL_SESSIONS_ON_HOLD',
          heldSessionsCount: proposal.heldSessionsCount,
        },
        { status: 400 }
      );
    }

    const { data: batch, error } = await (adminClient.from('payout_batches' as any) as any)
      .insert({
        period_start: periodStart,
        period_end: periodEnd,
        total_paise: Number(proposal.totalBatchPaise),
        status: 'pending_approval',
        created_by: session.userId,
        details: {
          listeners: proposal.listeners.map((l) => ({
            listenerId: l.listenerId,
            eligibleSessionsCount: l.eligibleSessionsCount,
            totalPayoutPaise: l.totalPayoutPaise.toString(),
          })),
          heldSessionsCount: proposal.heldSessionsCount,
          computedFrom: 'completed_sessions',
          earningsPerSessionPaise: DEFAULT_PRICING.listenerEarningsPaise.toString(),
        },
      })
      .select()
      .single();

    if (error || !batch) {
      return NextResponse.json({ error: error?.message || 'Failed to create payout proposal' }, { status: 500 });
    }

    return NextResponse.json({
      batchId: (batch as any).id,
      totalPaise: (batch as any).total_paise,
      status: (batch as any).status,
      periodStart: (batch as any).period_start,
      periodEnd: (batch as any).period_end,
      listenerCount: proposal.listeners.length,
      heldSessionsCount: proposal.heldSessionsCount,
      eligibleSessionsCount: proposal.listeners.reduce((acc, l) => acc + l.eligibleSessionsCount, 0),
      earningsPerSessionPaise: Number(DEFAULT_PRICING.listenerEarningsPaise),
      message:
        'Payout proposal computed from completed sessions and created in pending_approval state. Human finance approval required.',
    }, { status: 201 });
  } catch (err: any) {
    if (err.name === 'AuthError') {
      return handleAuthError(err);
    }
    return NextResponse.json({ error: err.message || 'Payout proposal creation failed' }, { status: 500 });
  }
}
