import { NextRequest, NextResponse } from 'next/server';
import { ToggleListenerPresenceSchema } from '@vent/validation';

export async function POST(req: NextRequest) {
  try {
    const json = await req.json();
    const parsed = ToggleListenerPresenceSchema.safeParse(json);

    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid presence toggle payload' }, { status: 400 });
    }

    const { listenerId, desiredState } = parsed.data;

    return NextResponse.json({
      listenerId,
      state: desiredState,
      availableSince: desiredState === 'available' ? new Date().toISOString() : null,
      updatedAt: new Date().toISOString(),
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Presence update failed' }, { status: 500 });
  }
}
