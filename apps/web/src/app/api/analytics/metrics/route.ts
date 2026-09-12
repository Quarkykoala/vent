import { NextRequest, NextResponse } from 'next/server';
import { UserRole } from '@vent/domain';
import { authenticateRequest, requireRole, requirePermission, handleAuthError } from '@/features/auth/auth-guard';
import { getSupabaseAdmin } from '@/lib/supabase-server';

const K_ANONYMITY_THRESHOLD = 5;

export async function GET(req: NextRequest) {
  try {
    const session = await authenticateRequest(req);
    requireRole(session, [
      UserRole.SUPER_ADMIN,
      UserRole.FINANCE,
      UserRole.LISTENER_OPS,
      UserRole.CLINICAL_SUPERVISOR,
      UserRole.PRIVACY_ADMIN,
    ]);
    // Preserve the existing role scope, but enforce the canonical staff MFA
    // requirement as well. A staff role on an AAL1 token is not sufficient.
    requirePermission(session, 'canAccessAdminConsole');

    const adminClient = getSupabaseAdmin();

    const { count: completedSessionsCount } = await adminClient
      .from('sessions')
      .select('*', { count: 'exact', head: true })
      .in('state', ['ended', 'safety_ended']);

    const { data: durationRows } = await adminClient
      .from('sessions')
      .select('duration_seconds');

    let avgDurationSeconds = 0;
    const durations = (durationRows || []) as { duration_seconds: number | null }[];
    if (durations.length > 0) {
      const valid = durations.filter(d => d.duration_seconds !== null);
      if (valid.length > 0) {
        const sum = valid.reduce((acc: number, row) => acc + (row.duration_seconds || 0), 0);
        avgDurationSeconds = Math.round(sum / valid.length);
      }
    }

    const { count: ratingsCount } = await adminClient
      .from('ratings')
      .select('*', { count: 'exact', head: true });

    const { data: ratingRows } = await adminClient
      .from('ratings')
      .select('stars');

    let avgRating = 0;
    if (ratingRows && ratingRows.length > 0) {
      const sum = ratingRows.reduce((acc, row: any) => acc + (row.stars || 0), 0);
      avgRating = Number((sum / ratingRows.length).toFixed(2));
    }

    const { count: safetyCasesCount } = await adminClient
      .from('safety_cases')
      .select('*', { count: 'exact', head: true });

    const totalSessions = completedSessionsCount || 0;
    const isSuppressedDueToKAnonymity = totalSessions < K_ANONYMITY_THRESHOLD;

    return NextResponse.json({
      metrics: {
        totalCompletedSessions: isSuppressedDueToKAnonymity ? `< ${K_ANONYMITY_THRESHOLD}` : totalSessions,
        avgDurationSeconds: isSuppressedDueToKAnonymity ? null : avgDurationSeconds,
        totalRatings: (ratingsCount || 0) < K_ANONYMITY_THRESHOLD ? `< ${K_ANONYMITY_THRESHOLD}` : ratingsCount,
        avgRating: (ratingsCount || 0) < K_ANONYMITY_THRESHOLD ? null : avgRating,
        safetyEscalationCount: safetyCasesCount || 0,
      },
      kAnonymity: {
        threshold: K_ANONYMITY_THRESHOLD,
        suppressed: isSuppressedDueToKAnonymity,
        notice: 'Aggregated metrics with k-anonymity suppression.',
      },
      timestamp: new Date().toISOString(),
    }, { status: 200 });
  } catch (err: any) {
    if (err.name === 'AuthError') {
      return handleAuthError(err);
    }
    return NextResponse.json({ error: err.message || 'Metrics computation failed' }, { status: 500 });
  }
}
