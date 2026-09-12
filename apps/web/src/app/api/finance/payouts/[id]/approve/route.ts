import { NextRequest, NextResponse } from 'next/server';
import { UserRole } from '@vent/domain';
import { authenticateRequest, requireRole, handleAuthError } from '@/features/auth/auth-guard';
import { getSupabaseAdmin } from '@/lib/supabase-server';

/**
 * Approve a payout batch.
 *
 * The decision is made inside `atomic_approve_payout_batch`, which locks the
 * row and refuses anything that is not `pending_approval` — an executed or
 * rejected batch can never be silently re-approved. The human approval is what
 * unlocks execution (enforced separately in `atomic_execute_payout_batch`).
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await authenticateRequest(req);
    requireRole(session, [UserRole.FINANCE, UserRole.SUPER_ADMIN]);

    const { id } = await params;
    const adminClient = getSupabaseAdmin();

    const { data, error } = await (adminClient as any).rpc('atomic_approve_payout_batch', {
      p_batch_id: id,
      p_approver_id: session.userId,
      p_approver_role: session.role,
    });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    if (!data || !data.success) {
      const code = data?.code;
      const status =
        code === 'BATCH_NOT_FOUND' ? 404 : code === 'ALREADY_APPROVED' || code === 'INVALID_BATCH_STATE' ? 409 : 400;
      return NextResponse.json({ error: data?.error || 'Approval failed', code }, { status });
    }

    return NextResponse.json({
      batchId: data.batch_id,
      status: data.status,
      totalPaise: data.total_paise,
      approvedBy: data.approved_by,
      approvedAt: data.approved_at,
      message: 'Payout batch approved by authorized human finance reviewer. Ready for execution.',
    }, { status: 200 });
  } catch (err: any) {
    if (err.name === 'AuthError') {
      return handleAuthError(err);
    }
    return NextResponse.json({ error: err.message || 'Approval failed' }, { status: 500 });
  }
}
