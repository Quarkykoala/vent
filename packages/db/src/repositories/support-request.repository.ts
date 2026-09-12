import type { TypedSupabaseClient } from '../client';

export interface SupportRequestRow {
  id: string;
  user_id: string;
  topic: string;
  language: string;
  service_tier: string;
  state: string;
  payment_order_id: string | null;
  idempotency_key: string;
  created_at: string;
  queued_at: string | null;
  matched_at: string | null;
  expires_at: string | null;
}

/**
 * Durable support-request persistence. Every mutation path is idempotent on
 * (user_id, idempotency_key): a retried submission returns the original row
 * instead of creating a duplicate request or purchase.
 */
export class SupportRequestRepository {
  constructor(private client: TypedSupabaseClient) {}

  async findByIdempotencyKey(
    userId: string,
    idempotencyKey: string
  ): Promise<SupportRequestRow | null> {
    const { data, error } = await this.client
      .from('support_requests')
      .select('*')
      .eq('user_id', userId)
      .eq('idempotency_key', idempotencyKey)
      .maybeSingle();

    if (error) {
      throw new Error(`Database error finding support request: ${error.message}`);
    }

    return (data as unknown as SupportRequestRow) ?? null;
  }

  async findById(id: string): Promise<SupportRequestRow | null> {
    const { data, error } = await this.client
      .from('support_requests')
      .select('*')
      .eq('id', id)
      .maybeSingle();

    if (error) {
      throw new Error(`Database error finding support request: ${error.message}`);
    }

    return (data as unknown as SupportRequestRow) ?? null;
  }

  async createRequest(params: {
    userId: string;
    topic: string;
    language: string;
    serviceTier: string;
    idempotencyKey: string;
  }): Promise<{ row: SupportRequestRow; created: boolean }> {
    const existing = await this.findByIdempotencyKey(params.userId, params.idempotencyKey);
    if (existing) {
      return { row: existing, created: false };
    }

    const insertPayload = {
      user_id: params.userId,
      topic: params.topic,
      language: params.language,
      service_tier: params.serviceTier,
      state: 'created',
      idempotency_key: params.idempotencyKey,
    };

    const { data, error } = await this.client
      .from('support_requests')
      // @ts-expect-error Supabase strict typing on insert overload
      .insert(insertPayload)
      .select()
      .single();

    if (error) {
      // Lost a create race on the unique idempotency key: return the winner's row.
      if ((error as { code?: string }).code === '23505') {
        const raced = await this.findByIdempotencyKey(params.userId, params.idempotencyKey);
        if (raced) {
          return { row: raced, created: false };
        }
      }
      throw new Error(`Database error creating support request: ${error.message}`);
    }

    return { row: data as unknown as SupportRequestRow, created: true };
  }
}
