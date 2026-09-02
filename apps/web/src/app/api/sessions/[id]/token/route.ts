import { NextRequest, NextResponse } from 'next/server';
import { livekitService } from '@/features/sessions/livekit-service';

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const authHeader = req.headers.get('authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const json = await req.json().catch(() => ({}));
    const role = json.role === 'listener' ? 'listener' : 'user';

    const roomName = `room_${id.replace(/-/g, '').slice(0, 16)}`;
    const tokenResult = livekitService.generateRoomToken({
      roomName,
      role,
      sessionAliasId: id,
      ttlSeconds: 600, // 10 minutes
    });

    return NextResponse.json(tokenResult, { status: 200 });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Token creation failed' }, { status: 500 });
  }
}
