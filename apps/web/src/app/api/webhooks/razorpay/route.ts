import { NextRequest, NextResponse } from 'next/server';
import crypto from 'node:crypto';
import {
  RazorpayWebhookPayloadSchema,
} from '@vent/validation';
import {
  PaymentState,
  createPaymentCaptureJournal,
  assertLedgerBalanced,
} from '@vent/domain';

export async function POST(req: NextRequest) {
  try {
    const rawBody = await req.text();
    const signature = req.headers.get('x-razorpay-signature');

    if (!signature) {
      return NextResponse.json({ error: 'Missing webhook signature' }, { status: 400 });
    }

    const secret = process.env.RAZORPAY_WEBHOOK_SECRET || 'placeholder_webhook_secret';

    // Verify HMAC-SHA256 signature
    const expectedSignature = crypto
      .createHmac('sha256', secret)
      .update(rawBody)
      .digest('hex');

    if (expectedSignature !== signature) {
      return NextResponse.json({ error: 'Invalid webhook signature' }, { status: 401 });
    }

    const json = JSON.parse(rawBody);
    const parsed = RazorpayWebhookPayloadSchema.safeParse(json);

    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid payload structure' }, { status: 400 });
    }

    const { payload } = parsed.data;
    const paymentEntity = payload.payment.entity;

    if (paymentEntity.status === 'captured') {
      const eventId = crypto.randomUUID();
      // Generate balanced ledger entries: DR Cash, CR Revenue
      const journal = createPaymentCaptureJournal({
        eventId,
        paymentId: paymentEntity.id,
        amountPaise: BigInt(paymentEntity.amount),
      });

      // Assert balance invariant
      assertLedgerBalanced(journal);

      return NextResponse.json({
        received: true,
        paymentId: paymentEntity.id,
        status: PaymentState.CAPTURED,
        journalEntriesCount: journal.length,
      });
    }

    return NextResponse.json({ received: true, status: paymentEntity.status });
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message || 'Webhook processing failed' },
      { status: 500 }
    );
  }
}
