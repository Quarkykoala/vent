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
    const now = new Date().toISOString();

    const { data: updated, error } = await (adminClient.from('payout_batches' as any) as any)
      .update({
        status: 'approved',
        approved_by: session.userId,
        approved_at: now,
      })
      .eq('id', id)
      .select()
      .maybeSingle();

    if (error || !updated) {
      return NextResponse.json({ error: error?.message || 'Payout batch not found' }, { status: 404 });
    }

    // Write audit event
    await (adminClient.from('audit_events') as any).insert({
      actor_id: session.userId,
      actor_role: session.role,
      action: 'payout_batch_approved',
      entity_type: 'payout_batch',
      entity_id: id,
      metadata: { totalPaise: (updated as any).total_paise },
      created_at: now,
    });

    return NextResponse.json({
      batchId: id,
      status: 'approved',
      approvedBy: session.userId,
      approvedAt: now,
      message: 'Payout batch approved by authorized human finance reviewer. Ready for execution.',
    }, { status: 200 });
  } catch (err: any) {
    if (err.name === 'AuthError') {
      return handleAuthError(err);
    }
    return NextResponse.json({ error: err.message || 'Approval failed' }, { status: 500 });
  }
}
