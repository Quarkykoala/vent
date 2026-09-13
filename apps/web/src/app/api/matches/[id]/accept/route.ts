import { NextRequest, NextResponse } from 'next/server';
import {
  MatchReservationState,
  SupportRequestState,
  UserRole,
} from '@vent/domain';
import { MatchingRepository, ListenerRepository } from '@vent/db';
import { authenticateRequest, requireRole, handleAuthError } from '@/features/auth/auth-guard';
import { getSupabaseAdmin } from '@/lib/supabase-server';

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await authenticateRequest(req);
    requireRole(session, [UserRole.LISTENER]);

    const { id } = await params;
    const adminClient = getSupabaseAdmin();
    const listenerRepo = new ListenerRepository(adminClient);
    const profile = await listenerRepo.findByUserId(session.userId);

    if (!profile) {
      return NextResponse.json({ error: 'Listener profile not found' }, { status: 403 });
    }

    const matchingRepo = new MatchingRepository(adminClient);
    // First attempt: accept an offered reservation. When the reservation is
    // already accepted by this listener (e.g. a retry after a lost response),
    // acceptReservation throws INVALID_STATE and we fall through to recovery.
    try {
      await matchingRepo.acceptReservation(id, profile.id);
    } catch (acceptErr: any) {
      const owned = await matchingRepo.getReservation(id);
      const alreadyAccepted =
        owned && owned.listener_id === profile.id && owned.state === MatchReservationState.ACCEPTED;
      if (!alreadyAccepted) {
        throw acceptErr;
      }
    }

    // R2 durable recovery: exactly one session per request. When session
    // creation previously failed or its response was lost, this converges on
    // the same session instead of stranding the request.
    const recovered = await matchingRepo.recoverSession(id, profile.id);

    // A replayed acceptance for a session that already finished is a no-op:
    // report the terminal state instead of resurrecting the reservation,
    // presence or request lifecycle.
    if (recovered.terminal) {
      return NextResponse.json(
        {
          reservationId: id,
          code: 'SESSION_TERMINAL',
          terminalState: recovered.terminalState ?? 'ended',
          sessionId: recovered.sessionId,
          message:
            'This session has already finished. No new session, reservation or availability change was made.',
          timestamp: new Date().toISOString(),
        },
        { status: 409 }
      );
    }

    return NextResponse.json({
      reservationId: id,
      status: MatchReservationState.ACCEPTED,
      sessionId: recovered.sessionId,
      roomName: recovered.roomName,
      requestState: SupportRequestState.CONNECTED,
      recovered: recovered.recovered,
      message: recovered.recovered
        ? 'Match offer accepted. Recovered the existing audio session.'
        : 'Match offer accepted. Audio room ready.',
      timestamp: new Date().toISOString(),
    });
  } catch (err: any) {
    if (err.name === 'AuthError') {
      return handleAuthError(err);
    }
    return NextResponse.json({ error: err.message || 'Accept failed' }, { status: 400 });
  }
}
