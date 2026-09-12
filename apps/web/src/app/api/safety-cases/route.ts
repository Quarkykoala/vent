import { NextRequest, NextResponse } from 'next/server';
import { CreateSafetyCaseSchema } from '@vent/validation';
import { summarizeSafetyAlertDelivery, UserRole } from '@vent/domain';
import { SafetyRepository } from '@vent/db';
import { authenticateRequest, requireRole, handleAuthError } from '@/features/auth/auth-guard';
import { SafetyAlertDispatcher } from '@/features/safety/alert-channels';
import { livekitService } from '@/features/sessions/livekit-service';
import { consumeRateLimit } from '@/lib/rate-limit';
import { getSupabaseAdmin } from '@/lib/supabase-server';

/**
 * Safety-case console read for supervisors/ops. Returns structured case
 * fields only (severity, state, reason codes, timestamps) — never free-text
 * notes beyond reason codes.
 */
export async function GET(req: NextRequest) {
  try {
    const session = await authenticateRequest(req);
    requireRole(session, [
      UserRole.CLINICAL_SUPERVISOR,
      UserRole.LISTENER_OPS,
      UserRole.SUPER_ADMIN,
    ]);

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

    // Abuse control: a distressed user may legitimately raise several concerns,
    // but the control must not become a way to spam the supervisor queue or
    // repeatedly force-terminate sessions.
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

    // Atomically create safety case, terminate session if active, and journal audit event
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
      // A reporter who is not a participant of this session must not be able to
      // terminate it. The database enforces this; surface it as a denial.
      if (/UNAUTHORIZED_REPORTER|not a participant/i.test(caseErr?.message ?? '')) {
        return NextResponse.json(
          { error: 'Forbidden: you are not a participant in this session', code: 'UNAUTHORIZED_REPORTER' },
          { status: 403 }
        );
      }
      throw caseErr;
    }

    // Dispatch alerts through the real channel adapters. This reports what the
    // channels actually acknowledged — an unconfigured transport is reported as
    // not_configured, never as delivered. The safety flow never fails here.
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
      // INVARIANT: Safety case creation MUST NEVER fail due to notification dispatch error
    }

    // A safety escalation terminates the session, so the media room is closed
    // too: the participant must not be able to rejoin a session the server has
    // ended. Best-effort — the safety case itself is already recorded.
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
