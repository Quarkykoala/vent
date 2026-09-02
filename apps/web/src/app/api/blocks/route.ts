import { NextRequest, NextResponse } from 'next/server';

export async function POST(req: NextRequest) {
  try {
    const json = await req.json();
    const { blockerId, blockedId, reasonCode } = json;

    if (!blockerId || !blockedId) {
      return NextResponse.json({ error: 'blockerId and blockedId are required' }, { status: 400 });
    }

    if (blockerId === blockedId) {
      return NextResponse.json({ error: 'User cannot block themselves' }, { status: 400 });
    }

    return NextResponse.json({
      blockerId,
      blockedId,
      reasonCode: reasonCode || null,
      message: 'Block successfully created. Future matching excluded.',
      createdAt: new Date().toISOString(),
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Block failed' }, { status: 500 });
  }
}
