import { NextRequest, NextResponse } from 'next/server';
import { CreatePaymentOrderSchema } from '@vent/validation';
import { DEFAULT_PRICING, PaymentState } from '@vent/domain';
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
    const rawClient = adminClient as any;
    const serverAmountPaise = DEFAULT_PRICING.pricePaise;
    const currency = DEFAULT_PRICING.currency;
    const keyId = process.env.RAZORPAY_KEY_ID;
    const keySecret = process.env.RAZORPAY_KEY_SECRET;

    const { data: requestRow, error: reqErr } = await adminClient
      .from('support_requests')
      .select('id, user_id, state, payment_order_id')
      .eq('id', requestId)
      .eq('user_id', session.userId)
      .maybeSingle();

    if (reqErr || !requestRow) {
      return NextResponse.json({ error: 'Support request not found or unauthorized' }, { status: 404 });
    }

    // A fully-bound prior attempt is an idempotent replay.
    if ((requestRow as any).payment_order_id) {
      const { data: existingPayment } = await adminClient
        .from('payments')
        .select('*')
        .eq('id', (requestRow as any).payment_order_id)
        .eq('user_id', session.userId)
        .maybeSingle();
      if (existingPayment && ['created', 'authorized'].includes((existingPayment as any).state)) {
        return NextResponse.json({
          orderId: (existingPayment as any).provider_order_id,
          paymentId: (existingPayment as any).id,
          requestId,
          amountPaise: Number((existingPayment as any).amount_paise),
          currency: (existingPayment as any).currency,
          state: (existingPayment as any).state,
          keyId: keyId || (process.env.RAZORPAY_TEST_SIMULATOR === 'true' ? 'simulated_test_key' : null),
          idempotentReplay: true,
        }, { status: 200 });
      }
    }

    // Persist a unique request-scoped intent BEFORE touching the provider.
    const { data: intent, error: intentErr } = await rawClient.rpc('atomic_reserve_payment_order_intent', {
      p_request_id: requestId,
      p_user_id: session.userId,
      p_amount_paise: Number(serverAmountPaise),
      p_currency: currency,
    });
    if (intentErr) {
      return NextResponse.json({ error: intentErr.message }, { status: 500 });
    }
    if (!intent?.success) {
      const status = intent?.code === 'REQUEST_NOT_FOUND' ? 404 : 409;
      return NextResponse.json({ error: intent?.error || 'Payment intent reservation failed', code: intent?.code }, { status });
    }

    if (intent.already_bound && intent.payment_id) {
      const { data: payment } = await adminClient.from('payments').select('*').eq('id', intent.payment_id).single();
      return NextResponse.json({
        orderId: (payment as any).provider_order_id,
        paymentId: (payment as any).id,
        requestId,
        amountPaise: Number((payment as any).amount_paise),
        currency: (payment as any).currency,
        state: (payment as any).state,
        keyId: keyId || (process.env.RAZORPAY_TEST_SIMULATOR === 'true' ? 'simulated_test_key' : null),
        idempotentReplay: true,
      }, { status: 200 });
    }

    // If a previous process died after beginning a provider submission, do not
    // guess whether Razorpay created an order and do not retry with a fresh
    // external order. This is deliberately fail-safe against double charging.
    if (['submitting', 'reconciliation_required'].includes(intent.state)) {
      return NextResponse.json(
        {
          error: 'A previous provider order submission is unresolved and requires reconciliation before retry.',
          code: 'ORDER_RECONCILIATION_REQUIRED',
          requestId,
        },
        { status: 409 }
      );
    }

    const { data: submitGuard, error: submitErr } = await rawClient.rpc('atomic_mark_payment_order_submitting', {
      p_request_id: requestId,
      p_user_id: session.userId,
    });
    if (submitErr) {
      return NextResponse.json({ error: submitErr.message }, { status: 500 });
    }
    if (!submitGuard?.success) {
      return NextResponse.json(
        { error: submitGuard?.error || 'Payment submission could not be reserved', code: submitGuard?.code },
        { status: 409 }
      );
    }

    let providerOrderId: string;

    if (process.env.RAZORPAY_TEST_SIMULATOR === 'true') {
      providerOrderId = `order_sim_${crypto.randomUUID().replace(/-/g, '').slice(0, 14)}`;
    } else if (keyId && keySecret) {
      const credentials = Buffer.from(`${keyId}:${keySecret}`).toString('base64');
      const rzpRes = await fetch('https://api.razorpay.com/v1/orders', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Basic ${credentials}`,
        },
        body: JSON.stringify({
          amount: Number(serverAmountPaise),
          currency,
          // Stable business identity for provider-side reconciliation.
          receipt: requestId,
          notes: { requestId, userId: session.userId },
        }),
      });

      if (!rzpRes.ok) {
        const errorData = await rzpRes.json().catch(() => ({}));
        await rawClient
          .from('payment_order_intents')
          .update({
            state: 'failed',
            last_error: errorData.error?.description || `Provider HTTP ${rzpRes.status}`,
            updated_at: new Date().toISOString(),
          })
          .eq('request_id', requestId)
          .eq('state', 'submitting');
        return NextResponse.json(
          { error: errorData.error?.description || 'Razorpay order creation failed' },
          { status: rzpRes.status }
        );
      }

      const orderData = await rzpRes.json();
      providerOrderId = orderData.id;
    } else {
      await rawClient
        .from('payment_order_intents')
        .update({ state: 'failed', last_error: 'Payment provider credentials unconfigured', updated_at: new Date().toISOString() })
        .eq('request_id', requestId)
        .eq('state', 'submitting');
      return NextResponse.json(
        { error: 'Payment provider credentials unconfigured (fail-closed invariant).', code: 'PAYMENT_CONFIG_ERROR' },
        { status: 503 }
      );
    }

    // Provider succeeded. Bind payment + support request in ONE DB transaction.
    const { data: bindResult, error: bindErr } = await rawClient.rpc('atomic_bind_payment_order', {
      p_request_id: requestId,
      p_user_id: session.userId,
      p_provider_order_id: providerOrderId,
      p_amount_paise: Number(serverAmountPaise),
      p_currency: currency,
    });

    if (bindErr || !bindResult?.success) {
      const detail = bindErr?.message || bindResult?.error || 'Unknown local bind failure';
      await rawClient
        .from('payment_order_intents')
        .update({
          state: 'reconciliation_required',
          provider_order_id: providerOrderId,
          last_error: detail,
          updated_at: new Date().toISOString(),
        })
        .eq('request_id', requestId);
      return NextResponse.json(
        {
          error: 'Provider order exists but local binding needs reconciliation; no retry order was created.',
          code: 'PROVIDER_ORDER_RECONCILIATION_REQUIRED',
          requestId,
          providerOrderId,
        },
        { status: 502 }
      );
    }

    return NextResponse.json({
      orderId: providerOrderId,
      paymentId: bindResult.payment_id,
      requestId,
      amountPaise: Number(serverAmountPaise),
      currency,
      state: PaymentState.CREATED,
      keyId: keyId || (process.env.RAZORPAY_TEST_SIMULATOR === 'true' ? 'simulated_test_key' : null),
      idempotentReplay: Boolean(bindResult.idempotent_replay),
    }, { status: bindResult.idempotent_replay ? 200 : 201 });
  } catch (err: any) {
    if (err.name === 'AuthError') {
      return handleAuthError(err);
    }
    // If the provider request itself was ambiguous (network interruption/process
    // failure), the durable intent remains `submitting`; a retry will be blocked
    // until reconciliation rather than creating a second provider order.
    return NextResponse.json({ error: err.message || 'Internal server error' }, { status: 500 });
  }
}
