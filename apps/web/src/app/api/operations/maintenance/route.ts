import { NextRequest, NextResponse } from 'next/server';
import { ListenerRepository } from '@vent/db';
import {
  authenticateRequest,
  requirePermission,
  handleAuthError,
} from '@/features/auth/auth-guard';
import { getSupabaseAdmin } from '@/lib/supabase-server';

/**
 * Operational entrypoint that actually executes the stale-presence sweep.
 * Invoked by staff; schedulers should use the secret-protected operations cron
 * endpoint. Sweeping only moves stale `available` listeners to `offline` —
 * active sessions are never terminated by this path.
 */
export async function POST(req: NextRequest) {
  try {
    const session = await authenticateRequest(req);
    requirePermission(session, 'canManageListeners');

    const json = await req.json().catch(() => ({}));
    const staleSeconds = (json as { staleSeconds?: unknown }).staleSeconds;
    if (
      staleSeconds !== undefined &&
      (typeof staleSeconds !== 'number' ||
        !Number.isInteger(staleSeconds) ||
        staleSeconds < 5 ||
        staleSeconds > 3600)
    ) {
      return NextResponse.json({ error: 'Invalid maintenance payload' }, { status: 400 });
    }

    const repo = new ListenerRepository(getSupabaseAdmin());
    const swept = await repo.sweepStalePresence(
      typeof staleSeconds === 'number' ? staleSeconds : 30
    );

    return NextResponse.json({ swept, sweptAt: new Date().toISOString() });
  } catch (err: any) {
    if (err.name === 'AuthError') {
      return handleAuthError(err);
    }
    return NextResponse.json({ error: err.message || 'Maintenance failed' }, { status: 500 });
  }
}
