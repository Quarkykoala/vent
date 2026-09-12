/**
 * Safety alert dispatch model.
 *
 * A safety case is never blocked by alert delivery, but delivery must never be
 * *claimed* without evidence. These types force every channel to report what
 * actually happened:
 *
 * - `delivered`      the channel acknowledged the alert (provider reference kept)
 * - `not_configured` no transport exists for this channel in this environment
 * - `failed`         the transport rejected or errored the alert
 * - `ambiguous`      the request left the process but no acknowledgement arrived
 * - `pending`        queued for a retry; not yet delivered
 */

export type AlertDeliveryState =
  | 'pending'
  | 'delivered'
  | 'failed'
  | 'ambiguous'
  | 'not_configured';

export interface AlertChannelPlan {
  channelName: string;
  /** Primary channels are always required; backup channels only for urgent/emergency. */
  required: boolean;
  source: 'primary' | 'backup';
}

export interface AlertDispatchResult {
  channelName: string;
  state: AlertDeliveryState;
  providerRef: string | null;
  detail: string;
  attemptedAt: string;
}

export type SafetyAlertSeverity = 'review' | 'urgent' | 'emergency';

/**
 * The channel plan for a case. `ops_dashboard` is delivered by the durable
 * safety_cases row itself (the supervisor queue reads that row), so it is
 * reported from persistence rather than from a transport.
 */
export function buildSafetyAlertPlan(severity: SafetyAlertSeverity): AlertChannelPlan[] {
  const plan: AlertChannelPlan[] = [
    { channelName: 'ops_dashboard', required: true, source: 'primary' },
    { channelName: 'primary_sms', required: true, source: 'primary' },
  ];
  if (severity === 'urgent' || severity === 'emergency') {
    plan.push({ channelName: 'backup_pager', required: false, source: 'backup' });
  }
  return plan;
}

/** True when a required channel did not deliver — the operator must know. */
export function safetyAlertNeedsHumanFollowUp(results: AlertDispatchResult[]): boolean {
  return results.some(
    (r) => r.state !== 'delivered' && r.channelName !== 'ops_dashboard'
  );
}

export function summarizeSafetyAlertDelivery(results: AlertDispatchResult[]): {
  delivered: string[];
  notDelivered: string[];
  followUpRequired: boolean;
} {
  const delivered = results.filter((r) => r.state === 'delivered').map((r) => r.channelName);
  const notDelivered = results
    .filter((r) => r.state !== 'delivered')
    .map((r) => `${r.channelName}:${r.state}`);
  return { delivered, notDelivered, followUpRequired: safetyAlertNeedsHumanFollowUp(results) };
}
