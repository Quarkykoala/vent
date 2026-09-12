import { NextRequest, NextResponse } from 'next/server';
import { ResolveSafetyCaseSchema } from '@vent/validation';
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
    const json = await req.json().catch(() => ({}));
    const parsed = ResolveSafetyCaseSchema.safeParse({ ...json, caseId: id });

    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid resolution payload', details: parsed.error.format() },
        { status: 400 }
      );
    }

    const adminClient = getSupabaseAdmin();
    const safetyRepo = new SafetyRepository(adminClient);

    await safetyRepo.resolveCase({
      caseId: id,
      supervisorId: session.userId,
      resolutionCode: parsed.data.resolutionCode,
      actorRole: session.role,
    });

    return NextResponse.json({
      caseId: id,
      state: SafetyCaseState.RESOLVED,
      supervisorId: session.userId,
      resolutionCode: parsed.data.resolutionCode,
      resolvedAt: new Date().toISOString(),
      message: 'Safety case resolved with clinical disposition.',
    }, { status: 200 });
  } catch (err: any) {
    if (err.name === 'AuthError') {
      return handleAuthError(err);
    }
    return NextResponse.json(
      { error: err.message || 'Resolution failed' },
      { status: 500 }
    );
  }
}
