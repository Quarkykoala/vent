import { NextRequest, NextResponse } from 'next/server';
import { CreateSafetyCaseSchema } from '@vent/validation';
import { summarizeSafetyAlertDelivery } from '@vent/domain';
import { SafetyRepository } from '@vent/db';
import { authenticateRequest, requirePermission, handleAuthError } from '@/features/auth/auth-guard';
import { SafetyAlertDispatcher } from '@/features/safety/alert-channels';
import { livekitService } from '@/features/sessions/livekit-service';
import { consumeRateLimit } from '@/lib/rate-limit';
import { getSupabaseAdmin } from '@/lib/supabase-server';

/**
 * Safety-case console read. The canonical permission model deliberately keeps
 * Listener Ops and Finance out of clinical/safety records.
 */
export async function GET(req: NextRequest) {
  try {
    const session = await authenticateRequest(req);
    requirePermission(session, 'canViewSafetyCases');

    const adminClient = getSupabaseAdmin();
    const { data: cases, error } = await (adminClient as any)
      .from('safety_cases')
      .select(
        'id, session_id, severity, state, reason_codes, opened_by, supervisor_id, opened_at, acknowledged_at, resolved_at, resolution_code'
      )
      .order('opened_at', { ascending: false })
      .limit(25);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ cases: cases ?? [] });
  } catch (err: any) {
    if (err.name === 'AuthError') {
      return handleAuthError(err);
    }
    return NextResponse.json(
      { error: err.message || 'Safety console load failed' },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await authenticateRequest(req);
    const json = await req.json().catch(() => ({}));
    const parsed = CreateSafetyCaseSchema.safeParse(json);

    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid safety case payload', details: parsed.error.format() },
        { status: 400 }
      );
    }

    const { sessionId, severity, reasonCodes } = parsed.data;

    const limit = consumeRateLimit(`safety_case:${session.userId}`, 6, 60_000);
    if (!limit.allowed) {
      return NextResponse.json(
        {
          error: 'Too many safety reports. A supervisor has your earlier report; please use the crisis numbers for immediate help.',
          code: 'RATE_LIMITED',
          retryAfterSeconds: limit.retryAfterSeconds,
        },
        { status: 429, headers: { 'Retry-After': String(limit.retryAfterSeconds) } }
      );
    }

    const adminClient = getSupabaseAdmin();
    const safetyRepo = new SafetyRepository(adminClient);

    let caseResult;
    try {
      caseResult = await safetyRepo.createCase({
        sessionId,
        openedBy: session.userId,
        severity,
        reasonCodes,
        reporterRole: session.role,
      });
    } catch (caseErr: any) {
      if (/UNAUTHORIZED_REPORTER|not a participant/i.test(caseErr?.message ?? '')) {
        return NextResponse.json(
          { error: 'Forbidden: you are not a participant in this session', code: 'UNAUTHORIZED_REPORTER' },
          { status: 403 }
        );
      }
      throw caseErr;
    }

    let alerts: Awaited<ReturnType<SafetyAlertDispatcher['dispatch']>> = [];
    try {
      const dispatcher = new SafetyAlertDispatcher(adminClient);
      alerts = await dispatcher.dispatch({
        caseId: caseResult.id,
        sessionId: caseResult.sessionId,
        severity,
        reasonCodes,
      });
    } catch {
      // Safety case creation must never fail because a notification channel did.
    }

    let roomClosed = false;
    try {
      const { data: roomRow } = await adminClient
        .from('sessions')
        .select('room_name')
        .eq('id', caseResult.sessionId)
        .maybeSingle();
      const roomName = (roomRow as any)?.room_name;
      if (roomName) {
        roomClosed = await livekitService.deleteRoom(roomName);
      }
    } catch {
      roomClosed = false;
    }

    const delivery = summarizeSafetyAlertDelivery(alerts);

    return NextResponse.json({
      caseId: caseResult.id,
      sessionId: caseResult.sessionId,
      severity: caseResult.severity,
      state: caseResult.state,
      reasonCodes,
      alerts,
      alertsDispatched: alerts,
      delivery,
      roomClosed,
      idempotentReplay: caseResult.idempotentReplay,
      message: caseResult.idempotentReplay
        ? 'Safety case already recorded for this session (idempotent submission).'
        : delivery.followUpRequired
        ? 'Safety case created and the session was ended safely. Some alert channels did not confirm delivery — the supervisor queue holds the case and requires human follow-up.'
        : 'Safety case created, session ended safely, and the supervisor queue holds the case.',
      createdAt: new Date().toISOString(),
    }, { status: 201 });
  } catch (err: any) {
    if (err.name === 'AuthError') {
      return handleAuthError(err);
    }
    return NextResponse.json(
      { error: err.message || 'Safety case creation failed' },
      { status: 500 }
    );
  }
}
