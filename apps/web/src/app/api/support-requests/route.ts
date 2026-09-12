import { NextRequest, NextResponse } from 'next/server';
import { CreateSupportRequestSchema } from '@vent/validation';
import { SupportRequestRepository } from '@vent/db';
import { authenticateRequest, handleAuthError } from '@/features/auth/auth-guard';
import { getSupabaseAdmin } from '@/lib/supabase-server';
import { consumeRateLimit } from '@/lib/rate-limit';

export async function POST(req: NextRequest) {
  try {
    const session = await authenticateRequest(req);

    // Durable 18+ evidence gate: request creation requires a recorded age
    // confirmation from the OTP age-gate interaction.
    const { data: userRow, error: userErr } = await (getSupabaseAdmin() as any)
      .from('users')
      .select('age_verified_at')
      .eq('id', session.userId)
      .maybeSingle();
    if (userErr || !userRow) {
      return NextResponse.json({ error: 'Authenticated user record not found' }, { status: 403 });
    }
    if (!(userRow as any).age_verified_at) {
      return NextResponse.json(
        { error: 'Forbidden: Age confirmation (18+) evidence missing. Complete the age-gated sign-in flow.' },
        { status: 403 }
      );
    }

    const json = await req.json().catch(() => ({}));
    const parsed = CreateSupportRequestSchema.safeParse(json);

    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid request input', details: parsed.error.format() },
        { status: 400 }
      );
    }

    const rate = consumeRateLimit(`support-requests:${session.userId}`, 5, 60_000);
    if (!rate.allowed) {
      return NextResponse.json(
        { error: 'Too many requests. Please retry shortly.' },
        { status: 429, headers: { 'retry-after': String(rate.retryAfterSeconds) } }
      );
    }

    const { topic, language, idempotencyKey } = parsed.data;

    const repo = new SupportRequestRepository(getSupabaseAdmin());
    const { row, created } = await repo.createRequest({
      userId: session.userId,
      topic,
      language,
      serviceTier: 'listener',
      idempotencyKey,
    });

    return NextResponse.json(
      {
        requestId: row.id,
        state: row.state,
        topic: row.topic,
        language: row.language,
        idempotencyKey: row.idempotency_key,
        createdAt: row.created_at,
      },
      { status: created ? 201 : 200 }
    );
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
