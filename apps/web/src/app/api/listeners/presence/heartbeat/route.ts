import { NextRequest, NextResponse } from 'next/server';
import { UserRole } from '@vent/domain';
import { ListenerRepository } from '@vent/db';
import {
  authenticateRequest,
  requireRole,
  handleAuthError,
} from '@/features/auth/auth-guard';
import { getSupabaseAdmin } from '@/lib/supabase-server';

export async function POST(req: NextRequest) {
  try {
    const session = await authenticateRequest(req);
    requireRole(session, [UserRole.LISTENER]);

    const repo = new ListenerRepository(getSupabaseAdmin());
    const profile = await repo.findByUserId(session.userId);
    if (!profile) {
      return NextResponse.json(
        { error: 'Forbidden: No listener profile for caller' },
        { status: 403 }
      );
    }

    await repo.updateHeartbeat(profile.id);

    return NextResponse.json({
      received: true,
      listenerId: profile.id,
      timestamp: new Date().toISOString(),
    });
  } catch (err: any) {
    if (err.name === 'AuthError') {
      return handleAuthError(err);
    }
    return NextResponse.json({ error: err.message || 'Heartbeat failed' }, { status: 500 });
  }
}
