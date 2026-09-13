import { NextRequest, NextResponse } from 'next/server';
import { SafetyCaseState } from '@vent/domain';
import { SafetyRepository } from '@vent/db';
import { authenticateRequest, requirePermission, handleAuthError } from '@/features/auth/auth-guard';
import { getSupabaseAdmin } from '@/lib/supabase-server';

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await authenticateRequest(req);
    requirePermission(session, 'canResolveSafetyCases');

    const { id } = await params;
    const adminClient = getSupabaseAdmin();
    const safetyRepo = new SafetyRepository(adminClient);

    const result = await safetyRepo.acknowledgeCase(id, session.userId, session.role);

    return NextResponse.json({
      caseId: id,
      state: SafetyCaseState.ACKNOWLEDGED,
      supervisorId: session.userId,
      acknowledgedAt: result.acknowledgedAt,
      idempotentReplay: result.idempotentReplay,
      message: result.idempotentReplay
        ? 'Safety case was already acknowledged by this supervisor.'
        : 'Safety case acknowledged by clinical supervisor.',
    }, { status: 200 });
  } catch (err: any) {
    if (err.name === 'AuthError') {
      return handleAuthError(err);
    }
    const status = /not found/i.test(err.message ?? '') ? 404 : /invalid state|another supervisor/i.test(err.message ?? '') ? 409 : 500;
    return NextResponse.json(
      { error: err.message || 'Acknowledgement failed' },
      { status }
    );
  }
}
