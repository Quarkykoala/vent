import { NextRequest, NextResponse } from 'next/server';
import { paymentWebhookProcessor } from '@/features/payments/payment-processor';

export async function POST(req: NextRequest) {
  try {
    const rawBody = await req.text();
    const signature = req.headers.get('x-razorpay-signature') || '';

    const result = await paymentWebhookProcessor.processWebhook({
      rawBody,
      signature,
      webhookSecret: process.env.RAZORPAY_WEBHOOK_SECRET,
    });

    return NextResponse.json(result, { status: result.status });
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message || 'Webhook processing failed' },
      { status: 500 }
    );
  }
}
