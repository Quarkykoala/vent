import { NextRequest, NextResponse } from 'next/server';
import { CreatePaymentOrderSchema } from '@vent/validation';
import { DEFAULT_PRICING, PaymentState } from '@vent/domain';

export async function POST(req: NextRequest) {
  try {
    const json = await req.json();
    const parsed = CreatePaymentOrderSchema.safeParse(json);

    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid order input', details: parsed.error.format() },
        { status: 400 }
      );
    }

    const { requestId } = parsed.data;

    // INVARIANT: Server ALWAYS dictates amount in paise, never from client!
    const serverAmountPaise = Number(DEFAULT_PRICING.pricePaise);
    const mockProviderOrderId = `order_${crypto.randomUUID().slice(0, 14)}`;

    return NextResponse.json(
      {
        orderId: mockProviderOrderId,
        requestId,
        amountPaise: serverAmountPaise,
        currency: DEFAULT_PRICING.currency,
        state: PaymentState.CREATED,
        keyId: process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID || 'rzp_test_placeholder',
      },
      { status: 201 }
    );
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message || 'Internal server error' },
      { status: 500 }
    );
  }
}
