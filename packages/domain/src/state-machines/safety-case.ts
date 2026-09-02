import { SafetyCaseState, type SafetyCaseStateType } from '../enums';
import { DomainTransitionError } from '../errors';

const ALLOWED_TRANSITIONS: Record<
  SafetyCaseStateType,
  readonly SafetyCaseStateType[]
> = {
  [SafetyCaseState.OPEN]: [
    SafetyCaseState.ACKNOWLEDGED,
    SafetyCaseState.ESCALATED,
    SafetyCaseState.RESOLVED,
  ],
  [SafetyCaseState.ACKNOWLEDGED]: [
    SafetyCaseState.ESCALATED,
    SafetyCaseState.RESOLVED,
  ],
  [SafetyCaseState.ESCALATED]: [SafetyCaseState.RESOLVED],
  [SafetyCaseState.RESOLVED]: [],
};

export function isSafetyCaseTransitionAllowed(
  currentState: SafetyCaseStateType,
  nextState: SafetyCaseStateType
): boolean {
  const allowed = ALLOWED_TRANSITIONS[currentState];
  return allowed ? allowed.includes(nextState) : false;
}

export function transitionSafetyCase(params: {
  caseId: string;
  currentState: SafetyCaseStateType;
  nextState: SafetyCaseStateType;
}): SafetyCaseStateType {
  const { caseId, currentState, nextState } = params;
  if (!isSafetyCaseTransitionAllowed(currentState, nextState)) {
    throw new DomainTransitionError({
      entityType: 'SafetyCase',
      entityId: caseId,
      currentState,
      attemptedState: nextState,
    });
  }
  return nextState;
}
