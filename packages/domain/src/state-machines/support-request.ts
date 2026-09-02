import { SupportRequestState, type SupportRequestStateType } from '../enums';
import { DomainTransitionError } from '../errors';

const ALLOWED_TRANSITIONS: Record<
  SupportRequestStateType,
  readonly SupportRequestStateType[]
> = {
  [SupportRequestState.CREATED]: [
    SupportRequestState.PAID,
    SupportRequestState.PAYMENT_FAILED,
    SupportRequestState.CANCELLED,
  ],
  [SupportRequestState.PAID]: [
    SupportRequestState.QUEUED,
    SupportRequestState.CANCELLED,
  ],
  [SupportRequestState.QUEUED]: [
    SupportRequestState.RESERVED,
    SupportRequestState.CANCELLED,
    SupportRequestState.EXPIRED,
  ],
  [SupportRequestState.RESERVED]: [
    SupportRequestState.ACCEPTED,
    SupportRequestState.DECLINED,
    SupportRequestState.OFFER_EXPIRED,
    SupportRequestState.CANCELLED,
  ],
  [SupportRequestState.DECLINED]: [SupportRequestState.QUEUED],
  [SupportRequestState.OFFER_EXPIRED]: [SupportRequestState.QUEUED],
  [SupportRequestState.ACCEPTED]: [
    SupportRequestState.CONNECTED,
    SupportRequestState.TECHNICAL_FAILED,
  ],
  [SupportRequestState.CONNECTED]: [
    SupportRequestState.COMPLETED,
    SupportRequestState.TECHNICAL_FAILED,
    SupportRequestState.SAFETY_ESCALATED,
  ],
  [SupportRequestState.COMPLETED]: [],
  [SupportRequestState.PAYMENT_FAILED]: [],
  [SupportRequestState.CANCELLED]: [],
  [SupportRequestState.EXPIRED]: [],
  [SupportRequestState.TECHNICAL_FAILED]: [],
  [SupportRequestState.SAFETY_ESCALATED]: [],
};

export function isSupportRequestTransitionAllowed(
  currentState: SupportRequestStateType,
  nextState: SupportRequestStateType
): boolean {
  const allowed = ALLOWED_TRANSITIONS[currentState];
  return allowed ? allowed.includes(nextState) : false;
}

export function transitionSupportRequest(params: {
  requestId: string;
  currentState: SupportRequestStateType;
  nextState: SupportRequestStateType;
}): SupportRequestStateType {
  const { requestId, currentState, nextState } = params;
  if (!isSupportRequestTransitionAllowed(currentState, nextState)) {
    throw new DomainTransitionError({
      entityType: 'SupportRequest',
      entityId: requestId,
      currentState,
      attemptedState: nextState,
    });
  }
  return nextState;
}
