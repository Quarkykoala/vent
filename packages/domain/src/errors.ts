export class DomainError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DomainError';
  }
}

export class DomainTransitionError extends DomainError {
  public readonly entityType: string;
  public readonly entityId: string;
  public readonly currentState: string;
  public readonly attemptedState: string;

  constructor(params: {
    entityType: string;
    entityId: string;
    currentState: string;
    attemptedState: string;
    message?: string;
  }) {
    const defaultMsg = `Invalid state transition for ${params.entityType} [${params.entityId}]: cannot transition from '${params.currentState}' to '${params.attemptedState}'.`;
    super(params.message || defaultMsg);
    this.name = 'DomainTransitionError';
    this.entityType = params.entityType;
    this.entityId = params.entityId;
    this.currentState = params.currentState;
    this.attemptedState = params.attemptedState;
  }
}

export class InvariantViolationError extends DomainError {
  constructor(message: string) {
    super(`Invariant violation: ${message}`);
    this.name = 'InvariantViolationError';
  }
}

export class LedgerBalanceError extends DomainError {
  public readonly eventId: string;
  public readonly totalDebitPaise: bigint;
  public readonly totalCreditPaise: bigint;

  constructor(params: {
    eventId: string;
    totalDebitPaise: bigint;
    totalCreditPaise: bigint;
  }) {
    super(
      `Ledger unbalanced for event [${params.eventId}]: Total debits (${params.totalDebitPaise} paise) do not equal total credits (${params.totalCreditPaise} paise).`
    );
    this.name = 'LedgerBalanceError';
    this.eventId = params.eventId;
    this.totalDebitPaise = params.totalDebitPaise;
    this.totalCreditPaise = params.totalCreditPaise;
  }
}
