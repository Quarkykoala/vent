import { NextRequest, NextResponse } from 'next/server';
import { UserRole } from '@vent/domain';
import { authenticateRequest, requireRole, handleAuthError } from '@/features/auth/auth-guard';
import { getSupabaseAdmin } from '@/lib/supabase-server';

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await authenticateRequest(req);
    requireRole(session, [UserRole.FINANCE, UserRole.SUPER_ADMIN]);

    const { id } = await params;
    const adminClient = getSupabaseAdmin();
    const rawClient = adminClient as any;

    const { data: result, error } = await rawClient.rpc('atomic_execute_payout_batch', {
      p_batch_id: id,
      p_executor_id: session.userId,
      p_executor_role: session.role,
    });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    if (!result || !result.success) {
      const status = result?.code === 'BATCH_NOT_FOUND' ? 404 : 400;
      return NextResponse.json({
        error: result?.error || 'Payout execution failed',
        code: result?.code,
      }, { status });
    }

    return NextResponse.json({
      batchId: id,
      status: 'executed',
      totalPaise: result.total_paise,
      executedAt: result.executed_at,
      message: 'Payout batch successfully executed and balanced ledger settled.',
    }, { status: 200 });
  } catch (err: any) {
    if (err.name === 'AuthError') {
      return handleAuthError(err);
    }
    return NextResponse.json({ error: err.message || 'Execution failed' }, { status: 500 });
  }
}
