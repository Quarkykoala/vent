import { NextRequest, NextResponse } from 'next/server';
import { ToggleListenerPresenceSchema } from '@vent/validation';
import { UserRole, transitionListenerPresence } from '@vent/domain';
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

    const json = await req.json().catch(() => ({}));
    const parsed = ToggleListenerPresenceSchema.safeParse(json);

    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid presence toggle payload' }, { status: 400 });
    }
    const { desiredState } = parsed.data;

    const repo = new ListenerRepository(getSupabaseAdmin());
    const profile = await repo.findByUserId(session.userId);
    if (!profile) {
      return NextResponse.json(
        { error: 'Forbidden: No listener profile for caller' },
        { status: 403 }
      );
    }
    if (parsed.data.listenerId !== profile.id) {
      return NextResponse.json(
        { error: 'Forbidden: Listener ID does not belong to caller' },
        { status: 403 }
      );
    }
    if (profile.status !== 'active') {
      return NextResponse.json(
        { error: 'Forbidden: Listener profile is not active' },
        { status: 403 }
      );
    }

    const presence = await repo.getPresence(profile.id);
    if (!presence) {
      return NextResponse.json(
        { error: 'Conflict: Presence record missing for listener' },
        { status: 409 }
      );
    }

    // Enforce the domain presence state machine before any write.
    transitionListenerPresence({
      listenerId: profile.id,
      currentState: presence.state as never,
      nextState: desiredState as never,
    });

    // CAS write: a concurrent reservation/in_session transition wins over a
    // stale toggle and surfaces as a conflict instead of being clobbered.
    const moved = await repo.transitionPresence(profile.id, presence.state, desiredState);
    if (!moved) {
      return NextResponse.json(
        { error: 'Conflict: Presence state changed concurrently. Retry.' },
        { status: 409 }
      );
    }

    const now = new Date().toISOString();
    return NextResponse.json(
      {
        listenerId: profile.id,
        state: desiredState,
        availableSince: desiredState === 'available' ? now : null,
        updatedAt: now,
      },
      { status: 200 }
    );
  } catch (err: any) {
    if (err.name === 'AuthError') {
      return handleAuthError(err);
    }
    if (err.name === 'DomainTransitionError') {
      return NextResponse.json(
        { error: `Invalid presence transition: ${err.message}` },
        { status: 409 }
      );
    }
    return NextResponse.json(
      { error: err.message || 'Presence update failed' },
      { status: 500 }
    );
  }
}
