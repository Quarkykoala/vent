import { NextRequest, NextResponse } from 'next/server';
import { authenticateRequest, handleAuthError } from '@/features/auth/auth-guard';
import { livekitService } from '@/features/sessions/livekit-service';
import { getSupabaseAdmin } from '@/lib/supabase-server';

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const json = await req.json().catch(() => ({}));

    // Only approved end reasons are persisted; a client cannot invent lifecycle
    // vocabulary that reporting and safety review would then have to interpret.
    // Validated before authentication: it is a pure input check and it keeps a
    // malformed request away from the database entirely.
    const ALLOWED_END_REASONS = [
      'normal_completion',
      'user_disconnected',
      'technical_failure',
      'safety_escalation',
      'duration_cap',
    ];
    const requestedReason = typeof json.reason === 'string' ? json.reason : 'normal_completion';
    if (!ALLOWED_END_REASONS.includes(requestedReason)) {
      return NextResponse.json(
        {
          error: `Unsupported end reason: ${requestedReason}`,
          code: 'INVALID_END_REASON',
          allowed: ALLOWED_END_REASONS,
        },
        { status: 400 }
      );
    }
    const endReason = requestedReason;

    const session = await authenticateRequest(req);

    const adminClient = getSupabaseAdmin();
    const rawClient = adminClient as any;

    const { data: roomRow } = await adminClient
      .from('sessions')
      .select('room_name')
      .eq('id', id)
      .maybeSingle();

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

    // Close the media room so a participant holding a still-valid token cannot
    // rejoin after the terminal state. Best-effort: the database state is the
    // authority and the token route already refuses terminal sessions, so a
    // provider outage must not fail the end itself.
    const roomName = (roomRow as any)?.room_name;
    let roomClosed = false;
    if (roomName) {
      roomClosed = await livekitService.deleteRoom(roomName).catch(() => false);
    }

    return NextResponse.json({
      sessionId: data.session_id,
      state: data.state,
      endReason: data.end_reason,
      durationSeconds: data.duration_seconds,
      endedAt: data.ended_at,
      roomClosed,
      message: 'Session completed normally. Listener presence released.',
    }, { status: 200 });
  } catch (err: any) {
    if (err.name === 'AuthError') {
      return handleAuthError(err);
    }
    return NextResponse.json({ error: err.message || 'Failed to end session' }, { status: 500 });
  }
}
