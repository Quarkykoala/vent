import type { TypedSupabaseClient } from '../client';
import type { Database } from '../types';

export type UserRow = Database['public']['Tables']['users']['Row'];
export type UserInsert = Database['public']['Tables']['users']['Insert'];

const ADJECTIVES = ['Calm', 'Gentle', 'Quiet', 'Serene', 'Kind', 'Patient', 'Peaceful', 'Brave', 'Warm'];
const NOUNS = ['River', 'Mountain', 'Breeze', 'Meadow', 'Horizon', 'Cloud', 'Stone', 'Harbor', 'Sky'];

/**
 * Generates an empathetic, privacy-preserving pseudonymous handle.
 * Guarantees that neither legal names nor personal identifiers are exposed to listeners.
 */
export function generatePseudonym(): string {
  const adj = ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)]!;
  const noun = NOUNS[Math.floor(Math.random() * NOUNS.length)]!;
  const num = Math.floor(100 + Math.random() * 900);
  return `${adj}${noun}${num}`;
}

export class UserRepository {
  constructor(private client: TypedSupabaseClient) {}

  async findByAuthUserId(authUserId: string): Promise<UserRow | null> {
    const { data, error } = await this.client
      .from('users')
      .select('*')
      .eq('auth_user_id', authUserId)
      .maybeSingle();

    if (error) {
      throw new Error(`Database error finding user by auth ID: ${error.message}`);
    }

    return (data as unknown as UserRow) ?? null;
  }

  async findById(userId: string): Promise<UserRow | null> {
    const { data, error } = await this.client
      .from('users')
      .select('*')
      .eq('id', userId)
      .maybeSingle();

    if (error) {
      throw new Error(`Database error finding user by ID: ${error.message}`);
    }

    return (data as unknown as UserRow) ?? null;
  }

  async createUser(params: {
    authUserId: string;
    handle?: string;
    ageVerifiedAt?: string;
  }): Promise<UserRow> {
    const handle = params.handle || generatePseudonym();
    // Durable 18+ evidence is only written when a caller performed an explicit
    // age-gate interaction; never defaulted to "now".
    const insertPayload: UserInsert = {
      auth_user_id: params.authUserId,
      handle,
      status: 'active',
      ...(params.ageVerifiedAt ? { age_verified_at: params.ageVerifiedAt } : {}),
    };

    const { data, error } = await this.client
      .from('users')
      // @ts-expect-error Supabase strict typing on insert overload
      .insert(insertPayload)
      .select()
      .single();

    if (error) {
      throw new Error(`Database error creating user: ${error.message}`);
    }

    return data as unknown as UserRow;
  }

  /**
   * Writes genuine 18+ evidence after an explicit age-gate interaction.
   * Only fills a missing timestamp; never rewrites existing evidence.
   */
  async recordAgeVerification(userId: string, verifiedAt: string): Promise<UserRow> {
    const existing = await this.findById(userId);
    if (!existing) {
      throw new Error('Database error recording age verification: user not found');
    }
    if (existing.age_verified_at) {
      return existing;
    }

    const { data, error } = await (this.client as any)
      .from('users')
      .update({ age_verified_at: verifiedAt })
      .eq('id', userId)
      .select()
      .single();

    if (error || !data) {
      throw new Error(`Database error recording age verification: ${error?.message}`);
    }

    return data as unknown as UserRow;
  }
}
