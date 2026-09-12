import { NextRequest, NextResponse } from 'next/server';
import { authenticateRequest, handleAuthError } from '@/features/auth/auth-guard';
import { getSupabaseAdmin } from '@/lib/supabase-server';

/**
 * Owner-scoped payment status read for one support request.
 * Returns the server-side payment state and request state so the client can
 * react to a webhook-confirmed capture. Never grants entitlement: matching
 * still verifies the captured payment itself.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await authenticateRequest(req);
    const { id } = await params;
    const admin = getSupabaseAdmin();

    const { data: requestRow, error: reqErr } = await (admin as any)
      .from('support_requests')
      .select('id, user_id, state, payment_order_id')
      .eq('id', id)
      .maybeSingle();

    if (reqErr || !requestRow) {
      return NextResponse.json({ error: 'Support request not found' }, { status: 404 });
    }
    if ((requestRow as any).user_id !== session.userId) {
      return NextResponse.json(
        { error: 'Forbidden: Not the owner of this support request' },
        { status: 403 }
      );
    }

    let paymentState: string | null = null;
    let amountPaise: number | null = null;
    let currency: string | null = null;
    if ((requestRow as any).payment_order_id) {
      const { data: paymentRow } = await (admin as any)
        .from('payments')
        .select('state, amount_paise, currency')
        .eq('id', (requestRow as any).payment_order_id)
        .maybeSingle();
      if (paymentRow) {
        paymentState = (paymentRow as any).state;
        amountPaise = Number((paymentRow as any).amount_paise);
        currency = (paymentRow as any).currency;
      }
    }

    return NextResponse.json({
      requestId: id,
      requestState: (requestRow as any).state,
      paymentState,
      amountPaise,
      currency,
    });
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
