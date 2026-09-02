import type { TypedSupabaseClient } from '../client';
import type { Database } from '../types';
import {
  MatchReservationState,
  SupportRequestState,
  ListenerPresenceState,
  handleOfferDecline,
  handleOfferTimeout,
  handleOfferAccept,
  type ScoreComponents,
} from '@vent/domain';

export type MatchReservationRow = Database['public']['Tables']['match_reservations']['Row'];

export class MatchingRepository {
  constructor(private client: TypedSupabaseClient) {}

  async createReservation(params: {
    requestId: string;
    listenerId: string;
    score: number;
    scoreComponents: ScoreComponents;
    expiresInSeconds?: number;
  }): Promise<MatchReservationRow> {
    const rawClient = this.client as any;
    const expiresSeconds = params.expiresInSeconds || 45;
    const expiresAt = new Date(Date.now() + expiresSeconds * 1000).toISOString();

    // 1. Transition support request to RESERVED
    await rawClient
      .from('support_requests')
      .update({ state: SupportRequestState.RESERVED })
      .eq('id', params.requestId);

    // 2. Transition listener presence to RESERVED
    await rawClient
      .from('listener_presence')
      .update({ state: ListenerPresenceState.RESERVED })
      .eq('listener_id', params.listenerId);

    // 3. Create reservation row
    const { data, error } = await rawClient
      .from('match_reservations')
      .insert({
        request_id: params.requestId,
        listener_id: params.listenerId,
        state: MatchReservationState.OFFERED,
        score: params.score,
        score_components: params.scoreComponents,
        offered_at: new Date().toISOString(),
        expires_at: expiresAt,
      })
      .select()
      .single();

    if (error || !data) {
      throw new Error(`Failed to create match reservation: ${error?.message}`);
    }

    return data as MatchReservationRow;
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

  async acceptReservation(reservationId: string): Promise<void> {
    const reservation = await this.getReservation(reservationId);
    if (!reservation) {
      throw new Error('Reservation not found');
    }

    const { nextReservationState, nextRequestState, nextListenerPresence } =
      handleOfferAccept({
        reservationState: reservation.state as any,
        requestState: SupportRequestState.RESERVED,
      });

    const rawClient = this.client as any;

    await rawClient
      .from('match_reservations')
      .update({
        state: nextReservationState,
        accepted_at: new Date().toISOString(),
      })
      .eq('id', reservationId);

    await rawClient
      .from('support_requests')
      .update({ state: nextRequestState })
      .eq('id', reservation.request_id);

    await rawClient
      .from('listener_presence')
      .update({ state: nextListenerPresence })
      .eq('listener_id', reservation.listener_id);
  }

  async declineReservation(reservationId: string): Promise<void> {
    const reservation = await this.getReservation(reservationId);
    if (!reservation) {
      throw new Error('Reservation not found');
    }

    const { nextReservationState, nextRequestState, nextListenerPresence } =
      handleOfferDecline({
        reservationState: reservation.state as any,
        requestState: SupportRequestState.RESERVED,
      });

    const rawClient = this.client as any;

    await rawClient
      .from('match_reservations')
      .update({ state: nextReservationState })
      .eq('id', reservationId);

    await rawClient
      .from('support_requests')
      .update({ state: nextRequestState })
      .eq('id', reservation.request_id);

    await rawClient
      .from('listener_presence')
      .update({ state: nextListenerPresence })
      .eq('listener_id', reservation.listener_id);
  }

  async expireReservation(reservationId: string): Promise<void> {
    const reservation = await this.getReservation(reservationId);
    if (!reservation) {
      throw new Error('Reservation not found');
    }

    const { nextReservationState, nextRequestState, nextListenerPresence } =
      handleOfferTimeout({
        reservationState: reservation.state as any,
        requestState: SupportRequestState.RESERVED,
      });

    const rawClient = this.client as any;

    await rawClient
      .from('match_reservations')
      .update({ state: nextReservationState })
      .eq('id', reservationId);

    await rawClient
      .from('support_requests')
      .update({ state: nextRequestState })
      .eq('id', reservation.request_id);

    await rawClient
      .from('listener_presence')
      .update({ state: nextListenerPresence })
      .eq('listener_id', reservation.listener_id);
  }
}
