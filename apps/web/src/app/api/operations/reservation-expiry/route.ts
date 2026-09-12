import { NextRequest, NextResponse } from 'next/server';
import { UserRole } from '@vent/domain';
import { MatchingCoordinator } from '@/features/matching/coordinator';
import {
  authenticateRequest,
  requireRole,
  handleAuthError,
} from '@/features/auth/auth-guard';
import { getSupabaseAdmin } from '@/lib/supabase-server';

/**
 * Operations entrypoint for the reservation-expiry job. Staff or a scheduler
 * may call it with any reservation id; execution is idempotent — an offered
 * reservation past its TTL is expired exactly once, anything else is a no-op.
 */
export async function POST(req: NextRequest) {
  try {
    const session = await authenticateRequest(req);
    requireRole(session, [UserRole.LISTENER_OPS, UserRole.SUPER_ADMIN]);

    const json = await req.json().catch(() => ({}));
    const reservationId = (json as { reservationId?: unknown }).reservationId;
    if (typeof reservationId !== 'string' || reservationId.length === 0) {
      return NextResponse.json({ error: 'reservationId is required' }, { status: 400 });
    }

    const coordinator = new MatchingCoordinator(getSupabaseAdmin());
    const result = await coordinator.expireIfDue(reservationId);

    return NextResponse.json({ reservationId, ...result });
  } catch (err: any) {
    if (err.name === 'AuthError') {
      return handleAuthError(err);
    }
    return NextResponse.json({ error: err.message || 'Expiry job failed' }, { status: 500 });
  }
}
