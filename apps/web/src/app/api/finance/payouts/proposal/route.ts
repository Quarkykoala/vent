import { NextRequest, NextResponse } from 'next/server';
import { UserRole } from '@vent/domain';
import { authenticateRequest, requireRole, handleAuthError } from '@/features/auth/auth-guard';
import { getSupabaseAdmin } from '@/lib/supabase-server';

export async function POST(req: NextRequest) {
  try {
    const session = await authenticateRequest(req);
    requireRole(session, [UserRole.FINANCE, UserRole.SUPER_ADMIN]);

    const json = await req.json().catch(() => ({}));
    const totalPaise = BigInt(json.totalPaise || 10000); // default ₹100
    const periodStart = json.periodStart || new Date(Date.now() - 7 * 86400000).toISOString();
    const periodEnd = json.periodEnd || new Date().toISOString();

    const adminClient = getSupabaseAdmin();
    const { data: batch, error } = await (adminClient.from('payout_batches' as any) as any)
      .insert({
        period_start: periodStart,
        period_end: periodEnd,
        total_paise: Number(totalPaise),
        status: 'pending_approval',
        created_by: session.userId,
        details: json.details || {},
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
      message: 'Payout proposal batch created in pending_approval state. Human finance approval required.',
    }, { status: 201 });
  } catch (err: any) {
    if (err.name === 'AuthError') {
      return handleAuthError(err);
    }
    return NextResponse.json({ error: err.message || 'Payout proposal creation failed' }, { status: 500 });
  }
}
