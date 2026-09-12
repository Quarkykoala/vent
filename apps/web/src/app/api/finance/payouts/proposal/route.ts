import { NextRequest, NextResponse } from 'next/server';
import { authenticateRequest, requirePermission, handleAuthError } from '@/features/auth/auth-guard';
import { getSupabaseAdmin } from '@/lib/supabase-server';

/**
 * Creates a payout proposal by atomically claiming immutable, unpaid
 * `listener_earnings`. Historical entitlement is therefore the amount that was
 * snapshotted when the session became payable, not today's pricing config.
 */
export async function POST(req: NextRequest) {
  try {
    const session = await authenticateRequest(req);
    requirePermission(session, 'canApprovePayouts');

    const json = await req.json().catch(() => ({}));
    if (typeof json.totalPaise !== 'undefined') {
      return NextResponse.json(
        {
          error: 'Payout totals are computed from immutable listener earnings and cannot be supplied by the caller.',
          code: 'TOTAL_NOT_CLIENT_SUPPLIED',
        },
        { status: 400 }
      );
    }

    const periodStart = json.periodStart || new Date(Date.now() - 7 * 86400000).toISOString();
    const periodEnd = json.periodEnd || new Date().toISOString();
    const startMs = Date.parse(periodStart);
    const endMs = Date.parse(periodEnd);
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) {
      return NextResponse.json(
        { error: 'Invalid payout period', code: 'INVALID_PERIOD' },
        { status: 400 }
      );
    }

    const adminClient = getSupabaseAdmin();
    const { data: result, error } = await (adminClient as any).rpc('atomic_create_payout_batch', {
      p_period_start: new Date(startMs).toISOString(),
      p_period_end: new Date(endMs).toISOString(),
      p_creator_id: session.userId,
      p_creator_role: session.role,
    });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    if (!result?.success) {
      const status = result?.code === 'NO_ELIGIBLE_EARNINGS' ? 400 : result?.code === 'INVALID_PERIOD' ? 400 : 409;
      return NextResponse.json(
        { error: result?.error || 'Payout proposal creation failed', code: result?.code },
        { status }
      );
    }

    return NextResponse.json({
      batchId: result.batch_id,
      totalPaise: Number(result.total_paise),
      status: result.status,
      periodStart: new Date(startMs).toISOString(),
      periodEnd: new Date(endMs).toISOString(),
      listenerCount: result.listener_count,
      eligibleEarningsCount: result.eligible_earnings_count,
      message: 'Payout proposal claimed immutable unpaid listener earnings. Independent human approval is required.',
    }, { status: 201 });
  } catch (err: any) {
    if (err.name === 'AuthError') {
      return handleAuthError(err);
    }
    return NextResponse.json({ error: err.message || 'Payout proposal creation failed' }, { status: 500 });
  }
}
