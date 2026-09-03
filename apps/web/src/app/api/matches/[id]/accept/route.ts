import { NextRequest, NextResponse } from 'next/server';
import { MatchReservationState, UserRole } from '@vent/domain';
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
    await matchingRepo.acceptReservation(id, profile.id);

    return NextResponse.json({
      reservationId: id,
      status: MatchReservationState.ACCEPTED,
      message: 'Match offer accepted. Ready for audio connection.',
      timestamp: new Date().toISOString(),
    });
  } catch (err: any) {
    if (err.name === 'AuthError') {
      return handleAuthError(err);
    }
    return NextResponse.json({ error: err.message || 'Accept failed' }, { status: 400 });
  }
}
