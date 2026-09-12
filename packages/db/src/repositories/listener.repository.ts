import type { TypedSupabaseClient } from '../client';
import type { Database } from '../types';
import {
  ListenerPresenceState,
  reconcileStalePresence,
  type ListenerPresence,
} from '@vent/domain';

export type ListenerProfileRow = Database['public']['Tables']['listener_profiles']['Row'];
export type ListenerPresenceRow = Database['public']['Tables']['listener_presence']['Row'];

export class ListenerRepository {
  constructor(private client: TypedSupabaseClient) {}

  async createProfile(params: {
    userId: string;
    displayName: string;
    languages: string[];
    topics: string[];
    tier?: 'listener' | 'counsellor';
  }): Promise<ListenerProfileRow> {
    const rawClient = this.client as any;
    const { data, error } = await rawClient
      .from('listener_profiles')
      .insert({
        user_id: params.userId,
        display_name: params.displayName,
        languages: params.languages,
        topics: params.topics,
        tier: params.tier || 'listener',
        status: 'applicant',
      })
      .select()
      .single();

    if (error || !data) {
      throw new Error(`Failed to create listener profile: ${error?.message || 'Unknown error'}`);
    }

    // Initialize presence row as offline
    await rawClient.from('listener_presence').insert({
      listener_id: data.id,
      state: 'offline',
      heartbeat_at: new Date().toISOString(),
    });

    return data as ListenerProfileRow;
  }

  async getProfile(listenerId: string): Promise<ListenerProfileRow | null> {
    const { data, error } = await this.client
      .from('listener_profiles')
      .select('*')
      .eq('id', listenerId)
      .maybeSingle();

    if (error) {
      throw new Error(`Failed to get listener profile: ${error.message}`);
    }

    return (data as unknown as ListenerProfileRow) ?? null;
  }

  async findByUserId(userId: string): Promise<ListenerProfileRow | null> {
    const { data, error } = await this.client
      .from('listener_profiles')
      .select('*')
      .eq('user_id', userId)
      .maybeSingle();

    if (error) {
      throw new Error(`Failed to get listener profile by user ID: ${error.message}`);
    }

    return (data as unknown as ListenerProfileRow) ?? null;
  }

  async getPresence(listenerId: string): Promise<ListenerPresenceRow | null> {
    const { data, error } = await this.client
      .from('listener_presence')
      .select('*')
      .eq('listener_id', listenerId)
      .maybeSingle();

    if (error) {
      throw new Error(`Failed to get listener presence: ${error.message}`);
    }

    return (data as unknown as ListenerPresenceRow) ?? null;
  }

  /**
   * Optimistic CAS transition of presence state. Exactly one row must move
   * from `from` to `to`; a zero-row update means the state changed concurrently
   * and the caller must reload and retry.
   */
  async transitionPresence(listenerId: string, from: string, to: string): Promise<boolean> {
    const now = new Date().toISOString();
    const rawClient = this.client as any;
    const { data, error } = await rawClient
      .from('listener_presence')
      .update({
        state: to,
        heartbeat_at: now,
        available_since: to === 'available' ? now : null,
      })
      .eq('listener_id', listenerId)
      .eq('state', from)
      .select('listener_id');

    if (error) {
      throw new Error(`Failed to transition presence: ${error.message}`);
    }

    return Array.isArray(data) && data.length === 1;
  }

  async updateHeartbeat(listenerId: string): Promise<void> {
    const rawClient = this.client as any;
    const { error } = await rawClient
      .from('listener_presence')
      .update({
        heartbeat_at: new Date().toISOString(),
      })
      .eq('listener_id', listenerId);

    if (error) {
      throw new Error(`Failed to update heartbeat: ${error.message}`);
    }
  }

  async setPresenceState(
    listenerId: string,
    state: 'offline' | 'available' | 'reserved' | 'in_session'
  ): Promise<void> {
    const now = new Date().toISOString();
    const updateData = {
      state,
      heartbeat_at: now,
      available_since: state === 'available' ? now : null,
    };

    const rawClient = this.client as any;
    const { error } = await rawClient
      .from('listener_presence')
      .update(updateData)
      .eq('listener_id', listenerId);

    if (error) {
      throw new Error(`Failed to set presence state: ${error.message}`);
    }
  }

  /**
   * Staff status change (activation/suspension/retraining). The caller is
   * responsible for authorization and audit; this only performs the write.
   */
  async updateStatus(
    listenerId: string,
    status: 'applicant' | 'training' | 'active' | 'paused' | 'suspended' | 'rejected',
    trainingExpiresAt?: string | null
  ): Promise<ListenerProfileRow> {
    const rawClient = this.client as any;
    const { data, error } = await rawClient
      .from('listener_profiles')
      .update({
        status,
        ...(trainingExpiresAt !== undefined ? { training_expires_at: trainingExpiresAt } : {}),
      })
      .eq('id', listenerId)
      .select()
      .single();

    if (error || !data) {
      throw new Error(`Failed to update listener status: ${error?.message || 'not found'}`);
    }

    return data as ListenerProfileRow;
  }

  /**
   * Sweeper job: Marks available listeners with stale heartbeats as offline.
   * INVARIANT: Never modifies listeners in_session or reserved.
   * Race guard: the UPDATE itself re-checks state=available and a stale
   * heartbeat, so a reservation/heartbeat that lands between the read and
   * the write wins and the row is left untouched.
   */
  async sweepStalePresence(staleSeconds = 30): Promise<number> {
    const { data, error } = await this.client
      .from('listener_presence')
      .select('*')
      .eq('state', ListenerPresenceState.AVAILABLE);

    if (error || !data) {
      return 0;
    }

    let sweptCount = 0;
    const nowIso = new Date().toISOString();
    const rawClient = this.client as any;

    for (const record of data as unknown as ListenerPresence[]) {
      const { updatedState, changed } = reconcileStalePresence(record, nowIso, staleSeconds);
      if (!changed || updatedState !== ListenerPresenceState.OFFLINE) {
        continue;
      }
      const cutoff = new Date(Date.now() - staleSeconds * 1000).toISOString();
      const { data: moved, error: moveErr } = await rawClient
        .from('listener_presence')
        .update({ state: 'offline' })
        .eq('listener_id', record.listener_id)
        .eq('state', ListenerPresenceState.AVAILABLE)
        .lt('heartbeat_at', cutoff)
        .select('listener_id');
      if (!moveErr && Array.isArray(moved) && moved.length === 1) {
        sweptCount++;
      }
    }

    return sweptCount;
  }
}
