import { SessionState, type SessionStateType } from '../enums';
import { DomainTransitionError } from '../errors';

const ALLOWED_TRANSITIONS: Record<
  SessionStateType,
  readonly SessionStateType[]
> = {
  [SessionState.CREATED]: [SessionState.CONNECTING, SessionState.FAILED],
  [SessionState.CONNECTING]: [SessionState.ACTIVE, SessionState.FAILED],
  [SessionState.ACTIVE]: [
    SessionState.ENDED,
    SessionState.FAILED,
    SessionState.SAFETY_ENDED,
  ],
  [SessionState.ENDED]: [],
  [SessionState.FAILED]: [],
  [SessionState.SAFETY_ENDED]: [],
};

export function isSessionTransitionAllowed(
  currentState: SessionStateType,
  nextState: SessionStateType
): boolean {
  const allowed = ALLOWED_TRANSITIONS[currentState];
  return allowed ? allowed.includes(nextState) : false;
}

export function transitionSession(params: {
  sessionId: string;
  currentState: SessionStateType;
  nextState: SessionStateType;
}): SessionStateType {
  const { sessionId, currentState, nextState } = params;
  if (!isSessionTransitionAllowed(currentState, nextState)) {
    throw new DomainTransitionError({
      entityType: 'Session',
      entityId: sessionId,
      currentState,
      attemptedState: nextState,
    });
  }
  return nextState;
}
