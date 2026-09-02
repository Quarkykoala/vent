import { NextRequest, NextResponse } from 'next/server';
import { ResolveSafetyCaseSchema } from '@vent/validation';
import { SafetyCaseState } from '@vent/domain';

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const json = await req.json();
    const parsed = ResolveSafetyCaseSchema.safeParse({ ...json, caseId: id });

    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid resolution payload', details: parsed.error.format() }, { status: 400 });
    }

    return NextResponse.json({
      caseId: id,
      state: SafetyCaseState.RESOLVED,
      resolutionCode: parsed.data.resolutionCode,
      resolvedAt: new Date().toISOString(),
      message: 'Safety case resolved with clinical disposition.',
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Resolution failed' }, { status: 500 });
  }
}
