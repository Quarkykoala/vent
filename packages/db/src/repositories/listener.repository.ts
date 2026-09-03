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
   * Sweeper job: Marks available listeners with stale heartbeats as offline.
   * INVARIANT: Never modifies listeners in_session or reserved.
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
      if (changed && updatedState === ListenerPresenceState.OFFLINE) {
        await rawClient
          .from('listener_presence')
          .update({ state: 'offline' })
          .eq('listener_id', record.listener_id);
        sweptCount++;
      }
    }

    return sweptCount;
  }
}
