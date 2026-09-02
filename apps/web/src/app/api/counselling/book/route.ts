import { NextRequest, NextResponse } from 'next/server';
import { BookCounsellorSlotSchema } from '@vent/validation';
import { COUNSELLOR_SESSION_PRICE_PAISE } from '@vent/domain';

export async function POST(req: NextRequest) {
  try {
    const json = await req.json();
    const parsed = BookCounsellorSlotSchema.safeParse(json);

    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid booking payload', details: parsed.error.format() }, { status: 400 });
    }

    const { slotId, userId, referralSessionId, referredFromListenerId } = parsed.data;

    return NextResponse.json({
      bookingId: crypto.randomUUID(),
      slotId,
      userId,
      amountPaise: Number(COUNSELLOR_SESSION_PRICE_PAISE),
      status: 'confirmed',
      attribution: {
        referralSessionId: referralSessionId || null,
        referredFromListenerId: referredFromListenerId || null,
      },
      message: 'Counselling slot booked successfully.',
      createdAt: new Date().toISOString(),
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Booking failed' }, { status: 500 });
  }
}
