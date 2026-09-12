import { NextRequest, NextResponse } from 'next/server';
import { UserRole } from '@vent/domain';
import { ListenerRepository } from '@vent/db';
import {
  authenticateRequest,
  requireRole,
  handleAuthError,
} from '@/features/auth/auth-guard';
import { getSupabaseAdmin } from '@/lib/supabase-server';

/**
 * Listener console reads: own profile + presence, own offered reservations
 * (with request topic/language/service tier only — never user contact
 * details), and own recent sessions metadata. All rows are scoped to the
 * caller's own listener profile.
 */
export async function GET(req: NextRequest) {
  try {
    const session = await authenticateRequest(req);
    requireRole(session, [UserRole.LISTENER]);

    const admin = getSupabaseAdmin();
    const listenerRepo = new ListenerRepository(admin);
    const profile = await listenerRepo.findByUserId(session.userId);
    if (!profile) {
      return NextResponse.json(
        { error: 'Forbidden: No listener profile for caller' },
        { status: 403 }
      );
    }

    const { data: presence } = await (admin as any)
      .from('listener_presence')
      .select('state, heartbeat_at, available_since, current_reservation_id')
      .eq('listener_id', profile.id)
      .maybeSingle();

    const { data: offers } = await (admin as any)
      .from('match_reservations')
      .select(
        'id, state, score, score_components, offered_at, expires_at, support_requests!inner(topic, language, service_tier, state)'
      )
      .eq('listener_id', profile.id)
      .eq('state', 'offered')
      .order('offered_at', { ascending: true });

    const { data: recentSessions } = await (admin as any)
      .from('sessions')
      .select('id, state, started_at, ended_at, duration_seconds, end_reason')
      .eq('listener_id', profile.id)
      .order('started_at', { ascending: false })
      .limit(10);

    return NextResponse.json({
      profile: {
        id: profile.id,
        displayName: (profile as any).display_name,
        status: (profile as any).status,
        tier: (profile as any).tier,
        languages: (profile as any).languages,
        topics: (profile as any).topics,
      },
      presence: presence ?? { state: 'offline' },
      offers: (offers ?? []).map((o: any) => ({
        reservationId: o.id,
        state: o.state,
        offeredAt: o.offered_at,
        expiresAt: o.expires_at,
        topic: o.support_requests?.topic,
        language: o.support_requests?.language,
        serviceTier: o.support_requests?.service_tier,
        requestState: o.support_requests?.state,
      })),
      recentSessions: recentSessions ?? [],
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
