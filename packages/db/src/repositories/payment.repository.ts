import type { TypedSupabaseClient } from '../client';
import type { Database } from '../types';
import {
  PaymentState,
  transitionPayment,
  assertLedgerBalanced,
  type UnpersistedLedgerEntry,
  type PaymentStateType,
} from '@vent/domain';

export type PaymentRow = Database['public']['Tables']['payments']['Row'];

export class PaymentRepository {
  constructor(private client: TypedSupabaseClient) {}

  async createPayment(params: {
    userId: string;
    providerOrderId: string;
    amountPaise: bigint;
  }): Promise<PaymentRow> {
    const rawClient = this.client as any;
    const { data, error } = await rawClient
      .from('payments')
      .insert({
        user_id: params.userId,
        provider: 'razorpay',
        provider_order_id: params.providerOrderId,
        amount_paise: Number(params.amountPaise),
        currency: 'INR',
        state: PaymentState.CREATED,
      })
      .select()
      .single();

    if (error || !data) {
      throw new Error(`Failed to create payment record: ${error?.message}`);
    }

    return data as PaymentRow;
  }

  async getByOrderId(orderId: string): Promise<PaymentRow | null> {
    const { data, error } = await this.client
      .from('payments')
      .select('*')
      .eq('provider_order_id', orderId)
      .maybeSingle();

    if (error) {
      throw new Error(`Failed to lookup payment by order ID: ${error.message}`);
    }

    return (data as unknown as PaymentRow) ?? null;
  }

  async isEventProcessed(eventId: string): Promise<{ processed: boolean; response?: any }> {
    const rawClient = this.client as any;
    const { data, error } = await rawClient
      .from('idempotency_keys')
      .select('response')
      .eq('key', `payment_webhook_${eventId}`)
      .maybeSingle();

    if (error || !data) {
      return { processed: false };
    }

    return { processed: true, response: (data as any).response };
  }

  async recordIdempotentEvent(eventId: string, operation: string, response: any): Promise<void> {
    const rawClient = this.client as any;
    await rawClient.from('idempotency_keys').insert({
      key: `payment_webhook_${eventId}`,
      operation,
      response,
      created_at: new Date().toISOString(),
    });
  }

  async recordCapturedPaymentAndLedger(params: {
    paymentId: string;
    currentState: PaymentStateType;
    providerPaymentId: string;
    journalEntries: UnpersistedLedgerEntry[];
  }): Promise<void> {
    // Assert domain state machine transition
    const nextState = transitionPayment({
      paymentId: params.paymentId,
      currentState: params.currentState,
      nextState: PaymentState.CAPTURED,
    });

    // Assert double-entry balance invariant
    assertLedgerBalanced(params.journalEntries);

    const rawClient = this.client as any;

    // Update payment state
    const { error: payErr } = await rawClient
      .from('payments')
      .update({
        state: nextState,
        provider_payment_id: params.providerPaymentId,
        captured_at: new Date().toISOString(),
      })
      .eq('id', params.paymentId);

    if (payErr) {
      throw new Error(`Failed to update payment state: ${payErr.message}`);
    }

    // Insert balanced ledger rows (append-only)
    const ledgerRows = params.journalEntries.map((e) => ({
      event_id: e.event_id,
      account_code: e.account_code,
      direction: e.direction,
      amount_paise: Number(e.amount_paise),
      currency: e.currency,
      reference_type: e.reference_type,
      reference_id: e.reference_id,
      created_at: new Date().toISOString(),
    }));

    const { error: ledgerErr } = await rawClient
      .from('ledger_entries')
      .insert(ledgerRows);

    if (ledgerErr) {
      throw new Error(`Failed to write ledger entries: ${ledgerErr.message}`);
    }
  }
}
