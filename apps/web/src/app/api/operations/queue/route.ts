import { NextRequest, NextResponse } from 'next/server';
import { UserRole } from '@vent/domain';
import {
  authenticateRequest,
  requireRole,
  handleAuthError,
} from '@/features/auth/auth-guard';
import { getSupabaseAdmin } from '@/lib/supabase-server';

/**
 * Live queue/session metadata for operations staff. Small counts plus the
 * newest open requests and active sessions — actual records only.
 */
export async function GET(req: NextRequest) {
  try {
    const session = await authenticateRequest(req);
    requireRole(session, [
      UserRole.LISTENER_OPS,
      UserRole.SUPER_ADMIN,
      UserRole.SUPPORT_AGENT,
    ]);

    const admin = getSupabaseAdmin();

    const { count: queuedCount } = await admin
      .from('support_requests')
      .select('*', { count: 'exact', head: true })
      .eq('state', 'queued');

    const { count: reservedCount } = await admin
      .from('support_requests')
      .select('*', { count: 'exact', head: true })
      .eq('state', 'reserved');

    const { count: availableListeners } = await admin
      .from('listener_presence')
      .select('*', { count: 'exact', head: true })
      .eq('state', 'available');

    const { data: openRequests } = await (admin as any)
      .from('support_requests')
      .select('id, topic, language, state, queued_at')
      .in('state', ['queued', 'reserved', 'accepted'])
      .order('queued_at', { ascending: true })
      .limit(10);

    const { data: activeSessions } = await (admin as any)
      .from('sessions')
      .select('id, state, started_at')
      .in('state', ['created', 'connecting', 'active'])
      .order('started_at', { ascending: false })
      .limit(10);

    return NextResponse.json({
      queuedCount: queuedCount ?? 0,
      reservedCount: reservedCount ?? 0,
      availableListeners: availableListeners ?? 0,
      openRequests: openRequests ?? [],
      activeSessions: activeSessions ?? [],
    });
  } catch (err: any) {
    if (err.name === 'AuthError') {
      return handleAuthError(err);
    }
    return NextResponse.json(
      { error: err.message || 'Internal server error' },
      { status: 500 }
    );
  }
}
