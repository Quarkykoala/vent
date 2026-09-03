import { NextRequest, NextResponse } from 'next/server';
import { authenticateRequest, handleAuthError } from '@/features/auth/auth-guard';
import { getSupabaseAdmin } from '@/lib/supabase-server';

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await authenticateRequest(req);
    const { id } = await params;
    const json = await req.json().catch(() => ({}));
    const endReason = json.reason || 'normal_completion';

    const adminClient = getSupabaseAdmin();
    const rawClient = adminClient as any;

    const { data, error } = await rawClient.rpc('atomic_end_session', {
      p_session_id: id,
      p_caller_user_id: session.userId,
      p_end_reason: endReason,
    });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    if (!data || !data.success) {
      const status = data?.code === 'SESSION_NOT_FOUND' ? 404 : data?.code === 'UNAUTHORIZED_CALLER' ? 403 : 400;
      return NextResponse.json({ error: data?.error || 'Failed to end session' }, { status });
    }

    return NextResponse.json({
      sessionId: data.session_id,
      state: data.state,
      endReason: data.end_reason,
      durationSeconds: data.duration_seconds,
      endedAt: data.ended_at,
      message: 'Session completed normally. Listener presence released.',
    }, { status: 200 });
  } catch (err: any) {
    if (err.name === 'AuthError') {
      return handleAuthError(err);
    }
    return NextResponse.json({ error: err.message || 'Failed to end session' }, { status: 500 });
  }
}
