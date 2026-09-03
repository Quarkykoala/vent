import { NextRequest, NextResponse } from 'next/server';
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

    // 4. Fail-closed credential check
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

    // 5. Generate token bound to session's exact room_name with short TTL and zero recording grants
    const tokenResult = activeService.generateRoomToken({
      roomName: (sessionRow as any).room_name,
      role: derivedRole,
      sessionAliasId: id,
      ttlSeconds: 600, // 10 minutes maximum
    });

    return NextResponse.json(tokenResult, { status: 200 });
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
