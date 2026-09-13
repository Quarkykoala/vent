import { NextRequest, NextResponse } from 'next/server';
import { SESSION_CAP_SECONDS } from '@vent/domain';
import { livekitService, LiveKitService } from '@/features/sessions/livekit-service';
import { authenticateRequest, handleAuthError } from '@/features/auth/auth-guard';
import { getSupabaseAdmin } from '@/lib/supabase-server';

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await authenticateRequest(req);
    const { id } = await params;
    const adminClient = getSupabaseAdmin();

    // 1. Look up session in database
    const { data: sessionRow, error: sessionErr } = await adminClient
      .from('sessions')
      .select('*')
      .eq('id', id)
      .maybeSingle();

    if (sessionErr || !sessionRow) {
      return NextResponse.json(
        { error: 'Session not found' },
        { status: 404 }
      );
    }

    // 2. Validate session state
    if (['ended', 'failed', 'safety_ended'].includes((sessionRow as any).state)) {
      return NextResponse.json(
        { error: `Session is not active (state: ${(sessionRow as any).state})` },
        { status: 400 }
      );
    }

    // 3. SERVER-DERIVED ROLE: Authorize caller and determine user vs listener role
    // NEVER trust role from request body!
    let derivedRole: 'user' | 'listener' | null = null;

    if ((sessionRow as any).user_id === session.userId) {
      derivedRole = 'user';
    } else {
      const { data: listenerProfile } = await adminClient
        .from('listener_profiles')
        .select('id')
        .eq('user_id', session.userId)
        .maybeSingle();

      if (listenerProfile && (listenerProfile as any).id === (sessionRow as any).listener_id) {
        derivedRole = 'listener';
      }
    }

    if (!derivedRole) {
      return NextResponse.json(
        { error: 'Forbidden: Caller is not a participant in this session' },
        { status: 403 }
      );
    }

    // 4. Server-owned duration cap (RISK-006). A session past the approved cap
    //    is ended by the server here; no token is issued that would extend it.
    const startedAtIso: string | null = (sessionRow as any).started_at ?? null;
    const elapsedSeconds = startedAtIso
      ? Math.floor((Date.now() - new Date(startedAtIso).getTime()) / 1000)
      : 0;

    if (startedAtIso && elapsedSeconds >= SESSION_CAP_SECONDS) {
      await (adminClient as any).rpc('atomic_expire_session_cap', {
        p_session_id: id,
        p_cap_seconds: SESSION_CAP_SECONDS,
        p_end_reason: 'duration_cap',
      });
      return NextResponse.json(
        {
          error: `This session reached the ${Math.round(SESSION_CAP_SECONDS / 60)}-minute limit and has ended.`,
          code: 'SESSION_CAP_REACHED',
        },
        { status: 409 }
      );
    }

    // 5. Fail-closed credential check
    let activeService = livekitService;

    if (process.env.LIVEKIT_TEST_SIMULATOR === 'true') {
      // Test simulation mode for automated test suites
      activeService = new LiveKitService(
        'lk_sim_key_001',
        'lk_sim_secret_001_8888888888888888',
        'wss://sim.livekit.cloud'
      );
    } else if (!livekitService.isConfigured()) {
      return NextResponse.json(
        {
          error: 'LiveKit provider credentials unconfigured (fail-closed invariant).',
          code: 'LIVEKIT_CONFIG_ERROR',
        },
        { status: 503 }
      );
    }

    // 6. Generate token bound to session's exact room_name with short TTL and zero recording grants
    const tokenResult = activeService.generateRoomToken({
      roomName: (sessionRow as any).room_name,
      role: derivedRole,
      sessionAliasId: id,
      ttlSeconds: 600, // 10 minutes maximum
    });

    return NextResponse.json(
      {
        ...tokenResult,
        // Server-authoritative timing so the client timer can never disagree
        // with the cap the server enforces.
        startedAt: startedAtIso ?? new Date().toISOString(),
        maxDurationSeconds: SESSION_CAP_SECONDS,
        remainingSeconds: Math.max(0, SESSION_CAP_SECONDS - elapsedSeconds),
        role: derivedRole,
      },
      { status: 200 }
    );
  } catch (err: any) {
    if (err.name === 'AuthError') {
      return handleAuthError(err);
    }
    return NextResponse.json(
      { error: err.message || 'Token generation failed' },
      { status: 500 }
    );
  }
}
