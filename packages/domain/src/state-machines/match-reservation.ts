import {
  MatchReservationState,
  type MatchReservationStateType,
} from '../enums';
import { DomainTransitionError } from '../errors';

const ALLOWED_TRANSITIONS: Record<
  MatchReservationStateType,
  readonly MatchReservationStateType[]
> = {
  [MatchReservationState.OFFERED]: [
    MatchReservationState.ACCEPTED,
    MatchReservationState.DECLINED,
    MatchReservationState.EXPIRED,
    MatchReservationState.CANCELLED,
  ],
  [MatchReservationState.ACCEPTED]: [],
  [MatchReservationState.DECLINED]: [],
  [MatchReservationState.EXPIRED]: [],
  [MatchReservationState.CANCELLED]: [],
};

export function isMatchReservationTransitionAllowed(
  currentState: MatchReservationStateType,
  nextState: MatchReservationStateType
): boolean {
  const allowed = ALLOWED_TRANSITIONS[currentState];
  return allowed ? allowed.includes(nextState) : false;
}

export function transitionMatchReservation(params: {
  reservationId: string;
  currentState: MatchReservationStateType;
  nextState: MatchReservationStateType;
}): MatchReservationStateType {
  const { reservationId, currentState, nextState } = params;
  if (!isMatchReservationTransitionAllowed(currentState, nextState)) {
    throw new DomainTransitionError({
      entityType: 'MatchReservation',
      entityId: reservationId,
      currentState,
      attemptedState: nextState,
    });
  }
  return nextState;
}
