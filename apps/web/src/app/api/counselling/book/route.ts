import { NextRequest, NextResponse } from 'next/server';
import { BookCounsellorSlotSchema } from '@vent/validation';
import { authenticateRequest, handleAuthError } from '@/features/auth/auth-guard';
import { getSupabaseAdmin } from '@/lib/supabase-server';

export async function POST(req: NextRequest) {
  try {
    await authenticateRequest(req);
    const json = await req.json();
    const parsed = BookCounsellorSlotSchema.safeParse(json);

    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid booking payload', details: parsed.error.format() }, { status: 400 });
    }

    // Caller identity is server-derived; no client userId is accepted.
    const { slotId } = parsed.data;
    const admin = getSupabaseAdmin();

    // Fail closed: there is no real slot inventory yet, so no booking can be
    // confirmed. Returning a fabricated confirmation would invent care supply.
    const { data: counsellor } = await (admin as any)
      .from('listener_profiles')
      .select('id')
      .eq('id', slotId)
      .eq('tier', 'counsellor')
      .eq('status', 'active')
      .maybeSingle();

    if (!counsellor) {
      return NextResponse.json(
        {
          error: 'Counselling booking is not available yet. No verified counsellor supply exists for the requested slot.',
          code: 'COUNSELLING_UNAVAILABLE',
        },
        { status: 503 }
      );
    }

    return NextResponse.json(
      {
        error: 'Counselling scheduling is not yet operational for verified providers.',
        code: 'COUNSELLING_UNAVAILABLE',
      },
      { status: 503 }
    );
  } catch (err: any) {
    if (err.name === 'AuthError') {
      return handleAuthError(err);
    }
    return NextResponse.json({ error: err.message || 'Booking failed' }, { status: 500 });
  }
}
