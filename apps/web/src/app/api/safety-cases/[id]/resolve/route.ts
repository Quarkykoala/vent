import { NextRequest, NextResponse } from 'next/server';
import { ResolveSafetyCaseSchema } from '@vent/validation';
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

    const result = await safetyRepo.resolveCase({
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
      resolvedAt: result.resolvedAt,
      idempotentReplay: result.idempotentReplay,
      message: result.idempotentReplay
        ? 'Safety case was already resolved with this disposition.'
        : 'Safety case resolved with clinical disposition.',
    }, { status: 200 });
  } catch (err: any) {
    if (err.name === 'AuthError') {
      return handleAuthError(err);
    }
    const status = /not found/i.test(err.message ?? '') ? 404 : /invalid state|another supervisor/i.test(err.message ?? '') ? 409 : 500;
    return NextResponse.json(
      { error: err.message || 'Resolution failed' },
      { status }
    );
  }
}
