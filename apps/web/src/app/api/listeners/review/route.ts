import { NextRequest, NextResponse } from 'next/server';
import { UpdateListenerStatusSchema } from '@vent/validation';
import { ListenerRepository } from '@vent/db';
import {
  authenticateRequest,
  requirePermission,
  handleAuthError,
} from '@/features/auth/auth-guard';
import { getSupabaseAdmin } from '@/lib/supabase-server';

/**
 * Staff listener review: activate, pause, suspend, reject or retrain a
 * listener profile. Human-controlled; every change writes an audit event.
 */
export async function POST(req: NextRequest) {
  try {
    const session = await authenticateRequest(req);
    requirePermission(session, 'canManageListeners');

    const json = await req.json().catch(() => ({}));
    const parsed = UpdateListenerStatusSchema.safeParse(json);
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid listener status payload', details: parsed.error.format() },
        { status: 400 }
      );
    }

    const admin = getSupabaseAdmin();
    const repo = new ListenerRepository(admin);
    const before = await repo.getProfile(parsed.data.listenerId);
    if (!before) {
      return NextResponse.json({ error: 'Listener profile not found' }, { status: 404 });
    }

    const updated = await repo.updateStatus(
      parsed.data.listenerId,
      parsed.data.status,
      parsed.data.trainingExpiresAt ?? null
    );

    const now = new Date().toISOString();
    await (admin.from('audit_events') as any).insert({
      actor_id: session.userId,
      actor_role: session.role,
      action: 'listener_status_changed',
      entity_type: 'listener_profile',
      entity_id: parsed.data.listenerId,
      metadata: {
        from: (before as any).status,
        to: parsed.data.status,
        reason: parsed.data.reason ?? null,
      },
      created_at: now,
    });

    return NextResponse.json({
      listenerId: (updated as any).id,
      status: (updated as any).status,
      updatedAt: now,
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
