import { NextRequest, NextResponse } from 'next/server';
import { DeclineMatchSchema } from '@vent/validation';
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
    const json = await req.json().catch(() => ({}));
    const parsed = DeclineMatchSchema.safeParse({ reservationId: id, reason: json.reason || 'break' });

    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid decline input', details: parsed.error.format() },
        { status: 400 }
      );
    }

    const adminClient = getSupabaseAdmin();
    const listenerRepo = new ListenerRepository(adminClient);
    const profile = await listenerRepo.findByUserId(session.userId);

    if (!profile) {
      return NextResponse.json({ error: 'Listener profile not found' }, { status: 403 });
    }

    const matchingRepo = new MatchingRepository(adminClient);
    await matchingRepo.declineReservation(id, profile.id);

    return NextResponse.json({
      reservationId: id,
      status: MatchReservationState.DECLINED,
      reason: parsed.data.reason,
      message: 'Match declined. User returned to queue.',
      timestamp: new Date().toISOString(),
    });
  } catch (err: any) {
    if (err.name === 'AuthError') {
      return handleAuthError(err);
    }
    return NextResponse.json({ error: err.message || 'Decline failed' }, { status: 400 });
  }
}
