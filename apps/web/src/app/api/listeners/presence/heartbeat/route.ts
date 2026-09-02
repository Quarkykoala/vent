import { NextRequest, NextResponse } from 'next/server';
import { ListenerHeartbeatSchema } from '@vent/validation';

export async function POST(req: NextRequest) {
  try {
    const json = await req.json();
    const parsed = ListenerHeartbeatSchema.safeParse(json);

    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid heartbeat payload' }, { status: 400 });
    }

    return NextResponse.json({
      received: true,
      listenerId: parsed.data.listenerId,
      timestamp: new Date().toISOString(),
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Heartbeat failed' }, { status: 500 });
  }
}
