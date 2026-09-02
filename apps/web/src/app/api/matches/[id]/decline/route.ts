import { NextRequest, NextResponse } from 'next/server';
import { DeclineMatchSchema } from '@vent/validation';
import { MatchReservationState } from '@vent/domain';

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const json = await req.json().catch(() => ({}));
    const parsed = DeclineMatchSchema.safeParse({ reservationId: id, reason: json.reason || 'break' });

    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid decline input', details: parsed.error.format() }, { status: 400 });
    }

    return NextResponse.json({
      reservationId: id,
      status: MatchReservationState.DECLINED,
      reason: parsed.data.reason,
      message: 'Match declined. User returned to queue.',
      timestamp: new Date().toISOString(),
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Decline failed' }, { status: 500 });
  }
}
