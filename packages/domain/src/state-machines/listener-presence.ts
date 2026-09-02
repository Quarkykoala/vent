import {
  ListenerPresenceState,
  type ListenerPresenceStateType,
} from '../enums';
import { DomainTransitionError } from '../errors';

const ALLOWED_TRANSITIONS: Record<
  ListenerPresenceStateType,
  readonly ListenerPresenceStateType[]
> = {
  [ListenerPresenceState.OFFLINE]: [ListenerPresenceState.AVAILABLE],
  [ListenerPresenceState.AVAILABLE]: [
    ListenerPresenceState.RESERVED,
    ListenerPresenceState.OFFLINE,
  ],
  [ListenerPresenceState.RESERVED]: [
    ListenerPresenceState.IN_SESSION,
    ListenerPresenceState.AVAILABLE,
    ListenerPresenceState.OFFLINE,
  ],
  [ListenerPresenceState.IN_SESSION]: [
    ListenerPresenceState.AVAILABLE,
    ListenerPresenceState.OFFLINE,
  ],
};

export function isListenerPresenceTransitionAllowed(
  currentState: ListenerPresenceStateType,
  nextState: ListenerPresenceStateType
): boolean {
  const allowed = ALLOWED_TRANSITIONS[currentState];
  return allowed ? allowed.includes(nextState) : false;
}

export function transitionListenerPresence(params: {
  listenerId: string;
  currentState: ListenerPresenceStateType;
  nextState: ListenerPresenceStateType;
}): ListenerPresenceStateType {
  const { listenerId, currentState, nextState } = params;
  if (!isListenerPresenceTransitionAllowed(currentState, nextState)) {
    throw new DomainTransitionError({
      entityType: 'ListenerPresence',
      entityId: listenerId,
      currentState,
      attemptedState: nextState,
    });
  }
  return nextState;
}
