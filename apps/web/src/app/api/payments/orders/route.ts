import { NextRequest, NextResponse } from 'next/server';
import { CreatePaymentOrderSchema } from '@vent/validation';
import { DEFAULT_PRICING, PaymentState } from '@vent/domain';
import { PaymentRepository } from '@vent/db';
import { authenticateRequest, handleAuthError } from '@/features/auth/auth-guard';
import { getSupabaseAdmin } from '@/lib/supabase-server';

export async function POST(req: NextRequest) {
  try {
    const session = await authenticateRequest(req);

    const json = await req.json();
    const parsed = CreatePaymentOrderSchema.safeParse(json);

    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid order input', details: parsed.error.format() },
        { status: 400 }
      );
    }

    const { requestId } = parsed.data;
    const adminClient = getSupabaseAdmin();

    // Verify support request exists and belongs to this user
    const { data: requestRow, error: reqErr } = await adminClient
      .from('support_requests')
      .select('*')
      .eq('id', requestId)
      .eq('user_id', session.userId)
      .maybeSingle();

    if (reqErr || !requestRow) {
      return NextResponse.json(
        { error: 'Support request not found or unauthorized' },
        { status: 404 }
      );
    }

    // INVARIANT: an order may only be created for a request that can still be
    // entitled by a capture. Without this guard a user could pay for a request
    // that already completed or was cancelled — money taken, no entitlement.
    const payableStates = ['created', 'payment_failed'];
    if (!payableStates.includes((requestRow as any).state)) {
      return NextResponse.json(
        {
          error: `This request can no longer be paid for (state: ${(requestRow as any).state}).`,
          code: 'REQUEST_NOT_PAYABLE',
          requestState: (requestRow as any).state,
        },
        { status: 409 }
      );
    }

    // INVARIANT: Server ALWAYS dictates amount in paise, never from client!
    const serverAmountPaise = DEFAULT_PRICING.pricePaise;
    const keyId = process.env.RAZORPAY_KEY_ID;
    const keySecret = process.env.RAZORPAY_KEY_SECRET;

    // Retry safety: if this request already links a payment that is still
    // awaiting capture, return it instead of creating a duplicate order.
    if ((requestRow as any).payment_order_id) {
      const { data: existingPayment } = await adminClient
        .from('payments')
        .select('*')
        .eq('id', (requestRow as any).payment_order_id)
        .eq('user_id', session.userId)
        .maybeSingle();
      if (
        existingPayment &&
        ['created', 'authorized'].includes((existingPayment as any).state) &&
        BigInt((existingPayment as any).amount_paise) === serverAmountPaise
      ) {
        return NextResponse.json(
          {
            orderId: (existingPayment as any).provider_order_id,
            paymentId: (existingPayment as any).id,
            requestId,
            amountPaise: Number(serverAmountPaise),
            currency: DEFAULT_PRICING.currency,
            state: (existingPayment as any).state,
            keyId: keyId || 'simulated_test_key',
            idempotentReplay: true,
          },
          { status: 200 }
        );
      }
    }

    let providerOrderId: string;

    if (process.env.RAZORPAY_TEST_SIMULATOR === 'true') {
      // Test simulation mode for automated suites
      providerOrderId = `order_sim_${crypto.randomUUID().replace(/-/g, '').slice(0, 14)}`;
    } else if (keyId && keySecret) {
      // Real Razorpay Orders API call (TEST or LIVE mode determined by keys)
      const credentials = Buffer.from(`${keyId}:${keySecret}`).toString('base64');
      const rzpRes = await fetch('https://api.razorpay.com/v1/orders', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Basic ${credentials}`,
        },
        body: JSON.stringify({
          amount: Number(serverAmountPaise),
          currency: DEFAULT_PRICING.currency,
          receipt: requestId,
          notes: {
            requestId,
            userId: session.userId,
          },
        }),
      });

      if (!rzpRes.ok) {
        const errorData = await rzpRes.json().catch(() => ({}));
        return NextResponse.json(
          { error: errorData.error?.description || 'Razorpay order creation failed' },
          { status: rzpRes.status }
        );
      }

      const orderData = await rzpRes.json();
      providerOrderId = orderData.id;
    } else {
      // FAIL CLOSED: No fallback secrets or mock tokens permitted
      return NextResponse.json(
        {
          error: 'Payment provider credentials unconfigured (fail-closed invariant).',
          code: 'PAYMENT_CONFIG_ERROR',
        },
        { status: 503 }
      );
    }

    // Persist real payment record in PostgreSQL
    const paymentRepo = new PaymentRepository(adminClient);
    const paymentRow = await paymentRepo.createPayment({
      userId: session.userId,
      providerOrderId,
      amountPaise: serverAmountPaise,
    });

    // Link payment to support request
    await (adminClient.from('support_requests') as any)
      .update({ payment_order_id: paymentRow.id })
      .eq('id', requestId);

    return NextResponse.json(
      {
        orderId: providerOrderId,
        paymentId: paymentRow.id,
        requestId,
        amountPaise: Number(serverAmountPaise),
        currency: DEFAULT_PRICING.currency,
        state: PaymentState.CREATED,
        keyId: keyId || 'simulated_test_key',
      },
      { status: 201 }
    );
  } catch (err: any) {
    if (err.name === 'AuthError') {
      return handleAuthError(err);
    }
    return NextResponse.json(
      { error: err.message || 'Internal server error' },
      { status: 500 }
    );
  }
}
