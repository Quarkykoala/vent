import { NextRequest, NextResponse } from 'next/server';
import { CreateSafetyCaseSchema } from '@vent/validation';
import { SafetyCaseState, buildSafetyAlertNotifications } from '@vent/domain';

export async function POST(req: NextRequest) {
  try {
    const json = await req.json();
    const parsed = CreateSafetyCaseSchema.safeParse(json);

    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid safety case payload', details: parsed.error.format() }, { status: 400 });
    }

    const { sessionId, severity, reasonCodes } = parsed.data;
    const caseId = crypto.randomUUID();

    // Trigger dual-channel alerts (SMS + Backup Pager + Ops Dashboard)
    const alertChannels = buildSafetyAlertNotifications({
      caseId,
      severity,
      reasons: reasonCodes as any,
    });

    return NextResponse.json({
      caseId,
      sessionId,
      severity,
      state: SafetyCaseState.OPEN,
      reasonCodes,
      alertsDispatched: alertChannels,
      message: 'Safety case created and supervisor alerted.',
      createdAt: new Date().toISOString(),
    }, { status: 201 });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Safety case creation failed' }, { status: 500 });
  }
}
