import { NextRequest, NextResponse } from 'next/server';
import { authenticateRequest, handleAuthError } from '@/features/auth/auth-guard';
import { getSupabaseAdmin } from '@/lib/supabase-server';

/**
 * Owner-scoped queue status read for one support request.
 * Exposes the request state, the active offered/accepted reservation's
 * expiry, and the session id when one exists — no listener contact details,
 * no payment instrument data. Polling this never advances matching; only the
 * match endpoint (or the listener/ops paths) changes state.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await authenticateRequest(req);
    const { id } = await params;
    const admin = getSupabaseAdmin();

    const { data: requestRow, error: reqErr } = await (admin as any)
      .from('support_requests')
      .select('id, user_id, topic, language, state, queued_at, expires_at')
      .eq('id', id)
      .maybeSingle();

    if (reqErr || !requestRow) {
      return NextResponse.json({ error: 'Support request not found' }, { status: 404 });
    }
    if ((requestRow as any).user_id !== session.userId) {
      return NextResponse.json(
        { error: 'Forbidden: Not the owner of this support request' },
        { status: 403 }
      );
    }

    const { data: reservation } = await (admin as any)
      .from('match_reservations')
      .select('id, state, offered_at, expires_at')
      .eq('request_id', id)
      .in('state', ['offered', 'accepted'])
      .order('offered_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    const { data: sessionRow } = await (admin as any)
      .from('sessions')
      .select('id, state')
      .eq('request_id', id)
      .maybeSingle();

    return NextResponse.json({
      requestId: id,
      topic: (requestRow as any).topic,
      language: (requestRow as any).language,
      state: (requestRow as any).state,
      queuedAt: (requestRow as any).queued_at,
      expiresAt: (requestRow as any).expires_at,
      reservation: reservation
        ? {
            id: (reservation as any).id,
            state: (reservation as any).state,
            offeredAt: (reservation as any).offered_at,
            expiresAt: (reservation as any).expires_at,
          }
        : null,
      session: sessionRow
        ? { id: (sessionRow as any).id, state: (sessionRow as any).state }
        : null,
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
