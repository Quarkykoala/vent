import { NextRequest, NextResponse } from 'next/server';
import { CounsellingReferralOfferSchema } from '@vent/validation';

export async function POST(req: NextRequest) {
  try {
    const json = await req.json();
    const parsed = CounsellingReferralOfferSchema.safeParse(json);

    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid referral input', details: parsed.error.format() }, { status: 400 });
    }

    return NextResponse.json({
      referralId: crypto.randomUUID(),
      sessionId: parsed.data.sessionId,
      category: parsed.data.category,
      isNonDiagnostic: true,
      offerMessage: 'A professional therapist or counsellor can offer ongoing guidance for this concern.',
      createdAt: new Date().toISOString(),
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Referral failed' }, { status: 500 });
  }
}
