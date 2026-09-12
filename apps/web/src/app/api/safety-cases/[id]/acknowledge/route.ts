import { NextRequest, NextResponse } from 'next/server';
import { SafetyCaseState, UserRole } from '@vent/domain';
import { SafetyRepository } from '@vent/db';
import { authenticateRequest, requireRole, handleAuthError } from '@/features/auth/auth-guard';
import { getSupabaseAdmin } from '@/lib/supabase-server';

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await authenticateRequest(req);
    requireRole(session, [
      UserRole.CLINICAL_SUPERVISOR,
      UserRole.SUPER_ADMIN,
      UserRole.LISTENER_OPS,
    ]);

    const { id } = await params;
    const adminClient = getSupabaseAdmin();
    const safetyRepo = new SafetyRepository(adminClient);

    await safetyRepo.acknowledgeCase(id, session.userId, session.role);

    return NextResponse.json({
      caseId: id,
      state: SafetyCaseState.ACKNOWLEDGED,
      supervisorId: session.userId,
      acknowledgedAt: new Date().toISOString(),
      message: 'Safety case acknowledged by clinical supervisor.',
    }, { status: 200 });
  } catch (err: any) {
    if (err.name === 'AuthError') {
      return handleAuthError(err);
    }
    return NextResponse.json(
      { error: err.message || 'Acknowledgement failed' },
      { status: 500 }
    );
  }
}
