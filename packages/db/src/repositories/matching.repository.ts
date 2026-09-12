import type { TypedSupabaseClient } from '../client';
import type { Database } from '../types';
import type { ScoreComponents } from '@vent/domain';

export type MatchReservationRow = Database['public']['Tables']['match_reservations']['Row'];

export class MatchingRepository {
  constructor(private client: TypedSupabaseClient) {}

  /**
   * Atomically locks candidate listener, verifies queue status, heartbeats,
   * language/topic alignment and blocks, and creates the reservation with TTL.
   */
  async createReservation(params: {
    requestId: string;
    listenerId: string;
    score: number;
    scoreComponents: ScoreComponents;
    expiresInSeconds?: number;
  }): Promise<MatchReservationRow> {
    const rawClient = this.client as any;
    const { data, error } = await rawClient.rpc('atomic_reserve_match', {
      p_request_id: params.requestId,
      p_listener_id: params.listenerId,
      p_score: params.score,
      p_score_components: params.scoreComponents,
      p_ttl_seconds: params.expiresInSeconds || 45,
    });

    if (error) {
      throw new Error(`Database error in atomic_reserve_match: ${error.message}`);
    }

    if (!data || !data.success) {
      throw new Error(data?.error || 'Failed to atomically reserve match');
    }

    const reservation = await this.getReservation(data.reservation_id);
    if (!reservation) {
      throw new Error(`Created reservation ${data.reservation_id} could not be retrieved`);
    }

    return reservation;
  }

  async getReservation(reservationId: string): Promise<MatchReservationRow | null> {
    const { data, error } = await this.client
      .from('match_reservations')
      .select('*')
      .eq('id', reservationId)
      .maybeSingle();

    if (error) {
      throw new Error(`Failed to get reservation: ${error.message}`);
    }

    return (data as unknown as MatchReservationRow) ?? null;
  }

  /**
   * Atomically accepts a match reservation with locked state check and expiration guard.
   */
  async acceptReservation(reservationId: string, listenerId?: string): Promise<void> {
    const rawClient = this.client as any;

    let targetListenerId = listenerId;
    if (!targetListenerId) {
      const res = await this.getReservation(reservationId);
      if (!res) throw new Error('Reservation not found');
      targetListenerId = res.listener_id;
    }

    const { data, error } = await rawClient.rpc('atomic_accept_reservation', {
      p_reservation_id: reservationId,
      p_listener_id: targetListenerId,
    });

    if (error) {
      throw new Error(`Database error in atomic_accept_reservation: ${error.message}`);
    }

    if (!data || !data.success) {
      throw new Error(data?.error || 'Failed to atomically accept reservation');
    }
  }

  /**
   * Atomically declines an offer, returning the support request to QUEUED and listener to AVAILABLE.
   */
  async declineReservation(reservationId: string, listenerId?: string): Promise<void> {
    const rawClient = this.client as any;

    let targetListenerId = listenerId;
    if (!targetListenerId) {
      const res = await this.getReservation(reservationId);
      if (!res) throw new Error('Reservation not found');
      targetListenerId = res.listener_id;
    }

    const { data, error } = await rawClient.rpc('atomic_decline_reservation', {
      p_reservation_id: reservationId,
      p_listener_id: targetListenerId,
    });

    if (error) {
      throw new Error(`Database error in atomic_decline_reservation: ${error.message}`);
    }

    if (!data || !data.success) {
      throw new Error(data?.error || 'Failed to atomically decline reservation');
    }
  }

  /**
   * Atomically expires an offer after TTL, returning request to QUEUED and listener to AVAILABLE.
   */
  async expireReservation(reservationId: string): Promise<void> {
    const rawClient = this.client as any;
    const { data, error } = await rawClient.rpc('atomic_expire_reservation', {
      p_reservation_id: reservationId,
    });

    if (error) {
      throw new Error(`Database error in atomic_expire_reservation: ${error.message}`);
    }

    if (!data || !data.success) {
      throw new Error(data?.error || 'Failed to atomically expire reservation');
    }
  }

  /**
   * R2 durable recovery: after reservation acceptance, converge on exactly one
   * session for the request. Returns the existing session when a previous
   * attempt already created it; otherwise creates it inside the same
   * transaction. The UNIQUE(request_id) constraint is the final guard.
   *
   * A request or session that already reached a terminal state is reported as
   * `terminal: true` with no mutation: a replayed acceptance must never
   * resurrect a finished session, reservation or presence row.
   */
  async recoverSession(
    reservationId: string,
    listenerId: string
  ): Promise<{
    sessionId: string | null;
    roomName: string | null;
    requestId: string | null;
    recovered: boolean;
    terminal: boolean;
    terminalState?: string;
  }> {
    const rawClient = this.client as any;
    const { data, error } = await rawClient.rpc('atomic_accept_session_recovery', {
      p_reservation_id: reservationId,
      p_listener_id: listenerId,
    });

    if (error) {
      throw new Error(`Database error in atomic_accept_session_recovery: ${error.message}`);
    }

    if (data?.code === 'TERMINAL_STATE') {
      return {
        sessionId: data.session_id ?? null,
        roomName: null,
        requestId: null,
        recovered: false,
        terminal: true,
        terminalState: data.session_state ?? data.request_state,
      };
    }

    if (!data || !data.success) {
      throw new Error(data?.error || 'Failed to recover accepted session');
    }

    return {
      sessionId: data.session_id,
      roomName: data.room_name,
      requestId: data.request_id,
      recovered: data.recovered === true,
      terminal: false,
    };
  }
}
