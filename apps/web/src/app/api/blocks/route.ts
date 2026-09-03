import { NextRequest, NextResponse } from 'next/server';
import { authenticateRequest, handleAuthError } from '@/features/auth/auth-guard';
import { getSupabaseAdmin } from '@/lib/supabase-server';

export async function POST(req: NextRequest) {
  try {
    const session = await authenticateRequest(req);
    const json = await req.json().catch(() => ({}));
    const { blockedId, reasonCode } = json;

    if (!blockedId) {
      return NextResponse.json({ error: 'blockedId is required' }, { status: 400 });
    }

    // INVARIANT: Blocker is strictly the authenticated caller!
    const blockerId = session.userId;

    if (blockerId === blockedId) {
      return NextResponse.json({ error: 'User cannot block themselves' }, { status: 400 });
    }

    const adminClient = getSupabaseAdmin();

    // Verify target blocked user exists
    const { data: targetUser } = await adminClient
      .from('users')
      .select('id')
      .eq('id', blockedId)
      .maybeSingle();

    if (!targetUser) {
      return NextResponse.json({ error: 'Target user to block not found' }, { status: 404 });
    }

    // Insert block record (idempotent if already blocked)
    const { data: blockRow, error: blockErr } = await adminClient
      .from('blocks')
      .upsert(
        {
          blocker_id: blockerId,
          blocked_id: blockedId,
          reason_code: reasonCode || null,
        } as any,
        { onConflict: 'blocker_id,blocked_id' }
      )
      .select()
      .single();

    if (blockErr) {
      return NextResponse.json({ error: blockErr.message || 'Block failed' }, { status: 500 });
    }

    return NextResponse.json({
      blockerId,
      blockedId,
      reasonCode: (blockRow as any)?.reason_code || null,
      message: 'Block successfully created. Future matching excluded.',
      createdAt: (blockRow as any)?.created_at || new Date().toISOString(),
    }, { status: 201 });
  } catch (err: any) {
    if (err.name === 'AuthError') {
      return handleAuthError(err);
    }
    return NextResponse.json({ error: err.message || 'Block failed' }, { status: 500 });
  }
}
