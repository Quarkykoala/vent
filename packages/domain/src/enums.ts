export const SupportRequestState = {
  CREATED: 'created',
  PAID: 'paid',
  QUEUED: 'queued',
  RESERVED: 'reserved',
  ACCEPTED: 'accepted',
  CONNECTED: 'connected',
  COMPLETED: 'completed',
  PAYMENT_FAILED: 'payment_failed',
  CANCELLED: 'cancelled',
  EXPIRED: 'expired',
  DECLINED: 'declined',
  OFFER_EXPIRED: 'offer_expired',
  TECHNICAL_FAILED: 'technical_failed',
  SAFETY_ESCALATED: 'safety_escalated',
} as const;

export type SupportRequestStateType =
  (typeof SupportRequestState)[keyof typeof SupportRequestState];

export const MatchReservationState = {
  OFFERED: 'offered',
  ACCEPTED: 'accepted',
  DECLINED: 'declined',
  EXPIRED: 'expired',
  CANCELLED: 'cancelled',
} as const;

export type MatchReservationStateType =
  (typeof MatchReservationState)[keyof typeof MatchReservationState];

export const SessionState = {
  CREATED: 'created',
  CONNECTING: 'connecting',
  ACTIVE: 'active',
  ENDED: 'ended',
  FAILED: 'failed',
  SAFETY_ENDED: 'safety_ended',
} as const;

export type SessionStateType = (typeof SessionState)[keyof typeof SessionState];

export const PaymentState = {
  CREATED: 'created',
  AUTHORIZED: 'authorized',
  CAPTURED: 'captured',
  FAILED: 'failed',
  REFUNDED: 'refunded',
  PARTIALLY_REFUNDED: 'partially_refunded',
} as const;

export type PaymentStateType = (typeof PaymentState)[keyof typeof PaymentState];

export const SafetyCaseSeverity = {
  REVIEW: 'review',
  URGENT: 'urgent',
  EMERGENCY: 'emergency',
} as const;

export type SafetyCaseSeverityType =
  (typeof SafetyCaseSeverity)[keyof typeof SafetyCaseSeverity];

export const SafetyCaseState = {
  OPEN: 'open',
  ACKNOWLEDGED: 'acknowledged',
  ESCALATED: 'escalated',
  RESOLVED: 'resolved',
} as const;

export type SafetyCaseStateType =
  (typeof SafetyCaseState)[keyof typeof SafetyCaseState];

export const UserStatus = {
  ACTIVE: 'active',
  SUSPENDED: 'suspended',
  DELETION_PENDING: 'deletion_pending',
  DELETED: 'deleted',
} as const;

export type UserStatusType = (typeof UserStatus)[keyof typeof UserStatus];

export const ListenerStatus = {
  APPLICANT: 'applicant',
  TRAINING: 'training',
  ACTIVE: 'active',
  PAUSED: 'paused',
  SUSPENDED: 'suspended',
  REJECTED: 'rejected',
} as const;

export type ListenerStatusType =
  (typeof ListenerStatus)[keyof typeof ListenerStatus];

export const ListenerPresenceState = {
  OFFLINE: 'offline',
  AVAILABLE: 'available',
  RESERVED: 'reserved',
  IN_SESSION: 'in_session',
} as const;

export type ListenerPresenceStateType =
  (typeof ListenerPresenceState)[keyof typeof ListenerPresenceState];

export const ServiceTier = {
  LISTENER: 'listener',
  COUNSELLOR: 'counsellor',
} as const;

export type ServiceTierType = (typeof ServiceTier)[keyof typeof ServiceTier];

export const UserRole = {
  USER: 'user',
  LISTENER: 'listener',
  COUNSELLOR: 'counsellor',
  SUPPORT_AGENT: 'support_agent',
  LISTENER_OPS: 'listener_ops',
  CLINICAL_SUPERVISOR: 'clinical_supervisor',
  FINANCE: 'finance',
  PRIVACY_ADMIN: 'privacy_admin',
  SUPER_ADMIN: 'super_admin',
} as const;

export type UserRoleType = (typeof UserRole)[keyof typeof UserRole];

export const LedgerDirection = {
  DEBIT: 'debit',
  CREDIT: 'credit',
} as const;

export type LedgerDirectionType =
  (typeof LedgerDirection)[keyof typeof LedgerDirection];

export const LedgerAccountCode = {
  CASH_PG_CLEARING: 'cash_pg_clearing',
  CUSTOMER_SERVICE_REVENUE: 'customer_service_revenue',
  LISTENER_PAYABLE: 'listener_payable',
  PAYMENT_PROCESSING_EXPENSE: 'payment_processing_expense',
  REFUND_LIABILITY: 'refund_liability',
  TAX_PAYABLE: 'tax_payable',
} as const;

export type LedgerAccountCodeType =
  (typeof LedgerAccountCode)[keyof typeof LedgerAccountCode];
