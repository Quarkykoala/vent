import type {
  SupportRequestStateType,
  MatchReservationStateType,
  SessionStateType,
  PaymentStateType,
  SafetyCaseSeverityType,
  SafetyCaseStateType,
  UserStatusType,
  ListenerStatusType,
  ListenerPresenceStateType,
  ServiceTierType,
  UserRoleType,
  LedgerDirectionType,
  LedgerAccountCodeType,
} from './enums';

export interface User {
  id: string;
  auth_user_id: string;
  handle: string;
  age_verified_at: string;
  status: UserStatusType;
  created_at: string;
}

export interface ListenerProfile {
  id: string;
  user_id: string;
  display_name: string;
  status: ListenerStatusType;
  tier: ServiceTierType;
  languages: string[];
  topics: string[];
  verified_at: string | null;
  training_expires_at: string | null;
  quality_prior: number;
  created_at: string;
}

export interface ListenerPresence {
  listener_id: string;
  state: ListenerPresenceStateType;
  heartbeat_at: string;
  available_since: string | null;
  current_reservation_id: string | null;
  version: number;
}

export interface SupportRequest {
  id: string;
  user_id: string;
  topic: string;
  language: string;
  service_tier: ServiceTierType;
  state: SupportRequestStateType;
  payment_order_id: string | null;
  created_at: string;
  queued_at: string | null;
  matched_at: string | null;
  expires_at: string | null;
  idempotency_key: string;
}

export interface ScoreComponents {
  languageScore: number;
  topicScore: number;
  waitFairness: number;
  bayesianQuality: number;
  repeatAffinity: number;
  loadBalance: number;
}

export interface MatchReservation {
  id: string;
  request_id: string;
  listener_id: string;
  state: MatchReservationStateType;
  score: number;
  score_components: ScoreComponents;
  offered_at: string;
  expires_at: string;
  accepted_at: string | null;
}

export interface Session {
  id: string;
  request_id: string;
  user_id: string;
  listener_id: string;
  state: SessionStateType;
  room_name: string;
  started_at: string | null;
  ended_at: string | null;
  duration_seconds: number | null;
  end_reason: string | null;
}

export interface Rating {
  id: string;
  session_id: string;
  user_id: string;
  listener_id: string;
  stars: number;
  reason_tags: string[];
  created_at: string;
}

export interface Block {
  blocker_id: string;
  blocked_id: string;
  reason_code: string | null;
  created_at: string;
}

export interface Payment {
  id: string;
  user_id: string;
  provider: 'razorpay';
  provider_order_id: string;
  provider_payment_id: string | null;
  amount_paise: bigint;
  currency: 'INR';
  state: PaymentStateType;
  created_at: string;
  captured_at: string | null;
}

export interface LedgerEntry {
  id: string;
  event_id: string;
  account_code: LedgerAccountCodeType;
  direction: LedgerDirectionType;
  amount_paise: bigint;
  currency: 'INR';
  reference_type: string;
  reference_id: string;
  created_at: string;
}

export interface SafetyCase {
  id: string;
  session_id: string;
  opened_by: string;
  severity: SafetyCaseSeverityType;
  state: SafetyCaseStateType;
  reason_codes: string[];
  supervisor_id: string | null;
  opened_at: string;
  acknowledged_at: string | null;
  resolved_at: string | null;
  resolution_code: string | null;
}

export interface AuditEvent {
  id?: number;
  actor_id: string | null;
  actor_role: UserRoleType | 'system';
  action: string;
  entity_type: string;
  entity_id: string;
  metadata: Record<string, unknown>;
  ip_hash: string | null;
  created_at?: string;
}

export interface PricingConfig {
  sessionDurationMinutes: number;
  pricePaise: bigint;
  currency: 'INR';
  listenerEarningsPaise: bigint;
}
