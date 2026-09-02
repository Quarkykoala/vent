import { NextRequest, NextResponse } from 'next/server';
import { paymentWebhookProcessor } from '@/features/payments/payment-processor';

export async function POST(req: NextRequest) {
  try {
    const rawBody = await req.text();
    const signature = req.headers.get('x-razorpay-signature');

    if (!signature) {
      return NextResponse.json({ error: 'Missing webhook signature' }, { status: 400 });
    }

    const secret = process.env.RAZORPAY_WEBHOOK_SECRET || 'placeholder_webhook_secret';

    const result = await paymentWebhookProcessor.processWebhook({
      rawBody,
      signature,
      webhookSecret: secret,
    });

    return NextResponse.json(result, { status: result.status });
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message || 'Webhook processing failed' },
      { status: 500 }
    );
  }
}
