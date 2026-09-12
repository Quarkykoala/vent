import { NextRequest, NextResponse } from 'next/server';
import { authenticateRequest, requirePermission, handleAuthError } from '@/features/auth/auth-guard';
import { getSupabaseAdmin } from '@/lib/supabase-server';

/**
 * Compatibility endpoint for the MVP's manual payout flow. "Execute" no longer
 * means that an internal RPC moved money: an external bank/provider settlement
 * reference is mandatory before listener_payable is cleared.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await authenticateRequest(req);
    requirePermission(session, 'canApprovePayouts');

    const { id } = await params;
    const json = await req.json().catch(() => ({}));
    const settlementReference = typeof json.settlementReference === 'string'
      ? json.settlementReference.trim()
      : '';

    if (settlementReference.length < 4) {
      return NextResponse.json(
        {
          error: 'External settlement reference is required before a payout can be marked settled.',
          code: 'SETTLEMENT_EVIDENCE_REQUIRED',
        },
        { status: 400 }
      );
    }

    const adminClient = getSupabaseAdmin();
    const { data: result, error } = await (adminClient as any).rpc('atomic_execute_payout_batch', {
      p_batch_id: id,
      p_executor_id: session.userId,
      p_executor_role: session.role,
      p_settlement_reference: settlementReference,
    });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    if (!result?.success) {
      const status = result?.code === 'BATCH_NOT_FOUND' ? 404 : 409;
      return NextResponse.json({
        error: result?.error || 'Payout settlement failed',
        code: result?.code,
      }, { status });
    }

    return NextResponse.json({
      batchId: id,
      status: result.status,
      totalPaise: result.total_paise,
      settledAt: result.settled_at,
      settlementReference: result.settlement_reference ?? settlementReference,
      idempotentReplay: Boolean(result.idempotent_replay),
      message: 'External settlement evidence recorded; listener liability has been cleared in the ledger.',
    }, { status: 200 });
  } catch (err: any) {
    if (err.name === 'AuthError') {
      return handleAuthError(err);
    }
    return NextResponse.json({ error: err.message || 'Settlement failed' }, { status: 500 });
  }
}
