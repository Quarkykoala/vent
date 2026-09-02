import { MatchingRepository } from '@vent/db';
import { MatchReservationState } from '@vent/domain';

export interface ReservationExpiryJobPayload {
  reservationId: string;
}

/**
 * Trigger.dev durable task: checks reservation expiry and idempotently releases listener.
 */
export async function runReservationExpiryJob(
  payload: ReservationExpiryJobPayload,
  matchingRepo: MatchingRepository
): Promise<{ handled: boolean; action: 'expired' | 'already_settled' }> {
  const reservation = await matchingRepo.getReservation(payload.reservationId);
  if (!reservation) {
    return { handled: false, action: 'already_settled' };
  }

  // Only expire if still in offered state
  if (reservation.state === MatchReservationState.OFFERED) {
    const isExpired = new Date(reservation.expires_at).getTime() <= Date.now();
    if (isExpired) {
      await matchingRepo.expireReservation(payload.reservationId);
      return { handled: true, action: 'expired' };
    }
  }

  return { handled: false, action: 'already_settled' };
}
