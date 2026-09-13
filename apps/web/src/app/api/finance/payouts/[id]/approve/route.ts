import { NextRequest, NextResponse } from 'next/server';
import { authenticateRequest, requirePermission, handleAuthError } from '@/features/auth/auth-guard';
import { getSupabaseAdmin } from '@/lib/supabase-server';

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await authenticateRequest(req);
    requirePermission(session, 'canApprovePayouts');

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

    if (!data?.success) {
      const status = data?.code === 'BATCH_NOT_FOUND'
        ? 404
        : ['ALREADY_APPROVED', 'INVALID_BATCH_STATE', 'SEPARATION_OF_DUTIES_REQUIRED'].includes(data?.code)
          ? 409
          : 400;
      return NextResponse.json({ error: data?.error || 'Approval failed', code: data?.code }, { status });
    }

    return NextResponse.json({
      batchId: data.batch_id,
      status: data.status,
      totalPaise: data.total_paise,
      approvedBy: data.approved_by,
      approvedAt: data.approved_at,
      idempotentReplay: Boolean(data.idempotent_replay),
      message: 'Payout batch independently approved. External settlement evidence is still required before liability is cleared.',
    }, { status: 200 });
  } catch (err: any) {
    if (err.name === 'AuthError') {
      return handleAuthError(err);
    }
    return NextResponse.json({ error: err.message || 'Approval failed' }, { status: 500 });
  }
}
