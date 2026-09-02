import { InvariantViolationError } from '../errors';

export const ALLOWLISTED_ANALYTICS_EVENTS = [
  'support_request_created',
  'payment_captured',
  'match_offered',
  'match_accepted',
  'match_declined',
  'session_started',
  'session_ended',
  'rating_submitted',
  'safety_case_opened',
  'counselling_referral_viewed',
  'counselling_slot_booked',
] as const;

export type AnalyticsEventType = (typeof ALLOWLISTED_ANALYTICS_EVENTS)[number];

const FORBIDDEN_PROPERTY_SUBSTRINGS = [
  'phone',
  'email',
  'story',
  'transcript',
  'audio',
  'token',
  'secret',
  'password',
  'free_text',
  'note',
];

/**
 * Sanitizes event metadata to ensure complete DPDP 2025 and AGENTS.md privacy compliance.
 * Throws if a forbidden sensitive property key is present.
 */
export function sanitizeAnalyticsProperties(
  properties: Record<string, unknown>
): Record<string, unknown> {
  const sanitized: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(properties)) {
    const lowerKey = key.toLowerCase();
    for (const forbidden of FORBIDDEN_PROPERTY_SUBSTRINGS) {
      if (lowerKey.includes(forbidden)) {
        throw new InvariantViolationError(
          `Privacy Violation: Analytics event property '${key}' contains prohibited sensitive keyword '${forbidden}'.`
        );
      }
    }
    sanitized[key] = value;
  }

  return sanitized;
}

export interface AnalyticsEventPayload {
  event: AnalyticsEventType;
  distinctId: string; // Pseudonymous user/listener ID
  properties: Record<string, unknown>;
  timestampIso?: string;
}

/**
 * Validates and formats an analytics event.
 */
export function createSafeAnalyticsEvent(
  payload: AnalyticsEventPayload
): AnalyticsEventPayload {
  if (!ALLOWLISTED_ANALYTICS_EVENTS.includes(payload.event)) {
    throw new InvariantViolationError(
      `Invalid analytics event '${payload.event}'. Only allowlisted events may be emitted.`
    );
  }

  const safeProperties = sanitizeAnalyticsProperties(payload.properties);

  return {
    event: payload.event,
    distinctId: payload.distinctId,
    properties: safeProperties,
    timestampIso: payload.timestampIso || new Date().toISOString(),
  };
}

/**
 * DPDP 2025 Right to Erasure Data Scrubber.
 * Anonymizes user table record while preserving financial ledger integrity.
 */
export function scrubUserDataForErasure(user: {
  id: string;
  handle: string;
  auth_user_id: string;
}): {
  id: string;
  handle: string;
  auth_user_id: string;
  status: 'deleted';
} {
  return {
    id: user.id,
    handle: `deleted_user_${user.id.slice(0, 8)}`,
    auth_user_id: `erased_${crypto.randomUUID()}`,
    status: 'deleted',
  };
}
