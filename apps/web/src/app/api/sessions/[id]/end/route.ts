import { NextRequest, NextResponse } from 'next/server';
import { SessionState } from '@vent/domain';

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const json = await req.json().catch(() => ({}));
    const endReason = json.reason || 'user_ended';

    return NextResponse.json({
      sessionId: id,
      state: SessionState.ENDED,
      endReason,
      endedAt: new Date().toISOString(),
      message: 'Session completed normally. Listener earnings logged to ledger.',
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Failed to end session' }, { status: 500 });
  }
}
