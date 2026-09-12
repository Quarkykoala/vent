import { NextRequest, NextResponse } from 'next/server';
import { MatchingCoordinator } from '@/features/matching/coordinator';
import { authenticateRequest, handleAuthError, AuthError } from '@/features/auth/auth-guard';
import { getSupabaseAdmin } from '@/lib/supabase-server';
import { consumeRateLimit } from '@/lib/rate-limit';
import { SupportRequestRepository, type SupportRequestRow } from '@vent/db';

/**
 * Queue polling endpoint for the requester: runs the coordinator for one owned
 * request. Lazy expiry inside the coordinator makes rematch deterministic.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await authenticateRequest(req);
    const { id } = await params;

    const rate = consumeRateLimit(`match:${session.userId}`, 30, 60_000);
    if (!rate.allowed) {
      return NextResponse.json(
        { error: 'Too many requests. Please retry shortly.' },
        { status: 429, headers: { 'retry-after': String(rate.retryAfterSeconds) } }
      );
    }

    const admin = getSupabaseAdmin();
    const supportRepo = new SupportRequestRepository(admin);

    let requestRow: SupportRequestRow | null;
    try {
      requestRow = await supportRepo.findById(id);
    } catch {
      return NextResponse.json(
        { error: 'Failed to verify request ownership' },
        { status: 500 }
      );
    }

    if (!requestRow) {
      return NextResponse.json({ error: 'Support request not found' }, { status: 404 });
    }

    // Ownership: only the requester may poll/advance their own request.
    if (requestRow.user_id !== session.userId) {
      return NextResponse.json(
        { error: 'Forbidden: Not the owner of this support request' },
        { status: 403 }
      );
    }

    const coordinator = new MatchingCoordinator(admin);
    const result = await coordinator.attemptMatch(id);

    if (result.message === 'Support request not found') {
      return NextResponse.json({ error: 'Support request not found' }, { status: 404 });
    }

    switch (result.status) {
      case 'reserved':
        return NextResponse.json(result, { status: 201 });
      case 'offer_pending':
      case 'no_candidates':
        return NextResponse.json(result, { status: 200 });
      case 'not_entitled':
        return NextResponse.json(
          { error: result.message, code: 'NOT_ENTITLED' },
          { status: 402 }
        );
      default:
        return NextResponse.json({ error: result.message }, { status: 409 });
    }
  } catch (err: unknown) {
    if (
      err instanceof AuthError ||
      (err && typeof err === 'object' && (err as { name?: string }).name === 'AuthError')
    ) {
      return handleAuthError(err);
    }
    return NextResponse.json({ error: 'Matching failed' }, { status: 500 });
  }
}

