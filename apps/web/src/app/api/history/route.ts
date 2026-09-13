import { NextRequest, NextResponse } from 'next/server';
import { authenticateRequest, handleAuthError } from '@/features/auth/auth-guard';
import { getSupabaseAdmin } from '@/lib/supabase-server';

/**
 * Owner-scoped history: own support requests, own payments and own sessions
 * with rating presence. No other user's rows, no listener contact details,
 * no payment instrument data.
 */
export async function GET(req: NextRequest) {
  try {
    const session = await authenticateRequest(req);
    const admin = getSupabaseAdmin();

    const { data: requests } = await (admin as any)
      .from('support_requests')
      .select('id, topic, language, service_tier, state, created_at, queued_at')
      .eq('user_id', session.userId)
      .order('created_at', { ascending: false })
      .limit(25);

    const { data: payments } = await (admin as any)
      .from('payments')
      .select('id, provider_order_id, amount_paise, currency, state, created_at, captured_at')
      .eq('user_id', session.userId)
      .order('created_at', { ascending: false })
      .limit(25);

    const { data: sessions } = await (admin as any)
      .from('sessions')
      .select(
        'id, request_id, state, started_at, ended_at, duration_seconds, end_reason, ratings(id, stars)'
      )
      .eq('user_id', session.userId)
      .order('started_at', { ascending: false })
      .limit(25);

    return NextResponse.json({
      requests: requests ?? [],
      payments: payments ?? [],
      sessions: (sessions ?? []).map((s: any) => ({
        id: s.id,
        requestId: s.request_id,
        state: s.state,
        startedAt: s.started_at,
        endedAt: s.ended_at,
        durationSeconds: s.duration_seconds,
        endReason: s.end_reason,
        rated: Array.isArray(s.ratings) && s.ratings.length > 0,
      })),
    });
  } catch (err: any) {
    if (err.name === 'AuthError') {
      return handleAuthError(err);
    }
    return NextResponse.json(
      { error: err.message || 'Internal server error' },
      { status: 500 }
    );
  }
}
