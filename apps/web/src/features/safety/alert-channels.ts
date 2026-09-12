import {
  buildSafetyAlertPlan,
  type AlertDeliveryState,
  type AlertDispatchResult,
  type SafetyAlertSeverity,
} from '@vent/domain';
import type { TypedSupabaseClient } from '@vent/db';

/**
 * Safety alert channel dispatcher.
 *
 * Channels are real transports when configured and honest about it when not:
 * an unconfigured environment reports `not_configured` instead of pretending an
 * alert was delivered. Every attempt is persisted as an append-only
 * `audit_events` row so the delivery state survives restarts and can be read by
 * a supervisor.
 *
 * Delivery failure never fails safety-case creation.
 */

export interface SafetyAlertInput {
  caseId: string;
  sessionId: string;
  severity: SafetyAlertSeverity;
  reasonCodes: string[];
}

interface ChannelOutcome {
  state: AlertDeliveryState;
  providerRef: string | null;
  detail: string;
}

const DELIVERY_TIMEOUT_MS = 5000;

async function postToWebhook(
  url: string,
  body: unknown,
  channel: string
): Promise<ChannelOutcome> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DELIVERY_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-vent-alert-channel': channel },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (res.ok) {
      const providerRef = res.headers.get('x-provider-ref');
      return {
        state: 'delivered',
        providerRef,
        detail: `HTTP ${res.status}`,
      };
    }
    return { state: 'failed', providerRef: null, detail: `HTTP ${res.status}` };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    // An aborted or network-level failure after the request left the process is
    // not proof of non-delivery; report it as ambiguous so a human checks.
    const state: AlertDeliveryState = /abort/i.test(message) ? 'ambiguous' : 'failed';
    return { state, providerRef: null, detail: message };
  } finally {
    clearTimeout(timer);
  }
}

export class SafetyAlertDispatcher {
  constructor(private admin: TypedSupabaseClient) {}

  async dispatch(input: SafetyAlertInput): Promise<AlertDispatchResult[]> {
    const plan = buildSafetyAlertPlan(input.severity);
    const results: AlertDispatchResult[] = [];

    for (const channel of plan) {
      const outcome = await this.deliverChannel(channel.channelName, input);
      const result: AlertDispatchResult = {
        channelName: channel.channelName,
        state: outcome.state,
        providerRef: outcome.providerRef,
        detail: outcome.detail,
        attemptedAt: new Date().toISOString(),
      };
      results.push(result);
      await this.persistAttempt(input, result);
    }

    return results;
  }

  private async deliverChannel(
    channelName: string,
    input: SafetyAlertInput
  ): Promise<ChannelOutcome> {
    if (channelName === 'ops_dashboard') {
      // The durable safety_cases row IS the supervisor-queue delivery. It is
      // reported delivered because the caller has already persisted that row.
      return {
        state: 'delivered',
        providerRef: input.caseId,
        detail: 'case row persisted in supervisor queue',
      };
    }

    const url =
      channelName === 'primary_sms'
        ? process.env.SAFETY_ALERT_WEBHOOK_URL
        : process.env.SAFETY_BACKUP_WEBHOOK_URL;

    if (!url || url.trim().length === 0) {
      return {
        state: 'not_configured',
        providerRef: null,
        detail: `${channelName} transport is not configured in this environment`,
      };
    }

    return postToWebhook(
      url,
      {
        caseId: input.caseId,
        sessionId: input.sessionId,
        severity: input.severity,
        reasonCodes: input.reasonCodes,
        channel: channelName,
      },
      channelName
    );
  }

  private async persistAttempt(input: SafetyAlertInput, result: AlertDispatchResult): Promise<void> {
    try {
      await (this.admin as any).from('audit_events').insert({
        actor_id: null,
        actor_role: 'system',
        action: 'safety_alert_dispatch',
        entity_type: 'safety_case',
        entity_id: input.caseId,
        metadata: {
          channel: result.channelName,
          state: result.state,
          provider_ref: result.providerRef,
          detail: result.detail,
          severity: input.severity,
        },
        created_at: new Date().toISOString(),
      });
    } catch {
      // Alert persistence must never break the safety path. The in-memory
      // result is still returned to the caller for the incident record.
    }
  }
}
