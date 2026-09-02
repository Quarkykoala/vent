import { NextRequest, NextResponse } from 'next/server';
import { SafetyCaseState } from '@vent/domain';

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    return NextResponse.json({
      caseId: id,
      state: SafetyCaseState.ACKNOWLEDGED,
      acknowledgedAt: new Date().toISOString(),
      message: 'Safety case acknowledged by supervisor.',
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Acknowledgement failed' }, { status: 500 });
  }
}
