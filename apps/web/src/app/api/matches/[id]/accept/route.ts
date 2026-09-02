import { NextRequest, NextResponse } from 'next/server';
import { MatchReservationState } from '@vent/domain';

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    return NextResponse.json({
      reservationId: id,
      status: MatchReservationState.ACCEPTED,
      message: 'Match offer accepted. Ready for audio connection.',
      timestamp: new Date().toISOString(),
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Accept failed' }, { status: 500 });
  }
}
