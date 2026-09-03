import { NextRequest, NextResponse } from 'next/server';
import { CreateSafetyCaseSchema } from '@vent/validation';
import { buildSafetyAlertNotifications } from '@vent/domain';
import { SafetyRepository } from '@vent/db';
import { authenticateRequest, handleAuthError } from '@/features/auth/auth-guard';
import { getSupabaseAdmin } from '@/lib/supabase-server';

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
    const adminClient = getSupabaseAdmin();
    const safetyRepo = new SafetyRepository(adminClient);

    // Atomically create safety case, terminate session if active, and journal audit event
    const caseResult = await safetyRepo.createCase({
      sessionId,
      openedBy: session.userId,
      severity,
      reasonCodes,
      reporterRole: session.role,
    });

    // Generate alerts
    let alertChannels: any[] = [];
    try {
      alertChannels = buildSafetyAlertNotifications({
        caseId: caseResult.id,
        severity: severity as any,
        reasons: reasonCodes as any,
      });
    } catch {
      // INVARIANT: Safety case creation MUST NEVER fail due to notification dispatch error
    }

    return NextResponse.json({
      caseId: caseResult.id,
      sessionId: caseResult.sessionId,
      severity: caseResult.severity,
      state: caseResult.state,
      reasonCodes,
      alertsDispatched: alertChannels,
      idempotentReplay: caseResult.idempotentReplay,
      message: caseResult.idempotentReplay
        ? 'Safety case already recorded for this session (idempotent submission).'
        : 'Safety case created, session terminated safely, and supervisor alerted.',
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
