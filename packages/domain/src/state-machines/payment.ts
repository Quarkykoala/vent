import { PaymentState, type PaymentStateType } from '../enums';
import { DomainTransitionError } from '../errors';

const ALLOWED_TRANSITIONS: Record<
  PaymentStateType,
  readonly PaymentStateType[]
> = {
  [PaymentState.CREATED]: [
    PaymentState.AUTHORIZED,
    PaymentState.CAPTURED,
    PaymentState.FAILED,
  ],
  [PaymentState.AUTHORIZED]: [PaymentState.CAPTURED, PaymentState.FAILED],
  [PaymentState.CAPTURED]: [
    PaymentState.REFUNDED,
    PaymentState.PARTIALLY_REFUNDED,
  ],
  [PaymentState.PARTIALLY_REFUNDED]: [PaymentState.REFUNDED],
  [PaymentState.FAILED]: [],
  [PaymentState.REFUNDED]: [],
};

export function isPaymentTransitionAllowed(
  currentState: PaymentStateType,
  nextState: PaymentStateType
): boolean {
  const allowed = ALLOWED_TRANSITIONS[currentState];
  return allowed ? allowed.includes(nextState) : false;
}

export function transitionPayment(params: {
  paymentId: string;
  currentState: PaymentStateType;
  nextState: PaymentStateType;
}): PaymentStateType {
  const { paymentId, currentState, nextState } = params;
  if (!isPaymentTransitionAllowed(currentState, nextState)) {
    throw new DomainTransitionError({
      entityType: 'Payment',
      entityId: paymentId,
      currentState,
      attemptedState: nextState,
    });
  }
  return nextState;
}
