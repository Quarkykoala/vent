import { describe, it, expect, afterEach, afterAll } from 'vitest';
import http from 'node:http';
import crypto from 'node:crypto';
import type { AddressInfo } from 'node:net';
import {
  buildSafetyAlertPlan,
  summarizeSafetyAlertDelivery,
  safetyAlertNeedsHumanFollowUp,
} from '@vent/domain';
import { getSupabaseAdmin } from '../src/lib/supabase-server';
import { SafetyAlertDispatcher } from '../src/features/safety/alert-channels';

/**
 * Safety alert delivery truthfulness.
 *
 * A safety case must never claim a delivery that did not happen. These tests
 * point the adapter at a real local HTTP receiver (and at a closed port) and
 * inspect both the reported state and the persisted append-only attempt rows.
 */

const admin = getSupabaseAdmin() as any;
const caseIds: string[] = [];
const servers: http.Server[] = [];

function nextCaseId(): string {
  const id = crypto.randomUUID();
  caseIds.push(id);
  return id;
}

async function startReceiver(status: number): Promise<string> {
  const server = http.createServer((req, res) => {
    req.on('data', () => undefined);
    req.on('end', () => {
      res.writeHead(status, { 'content-type': 'application/json', 'x-provider-ref': 'ref_local_receiver' });
      res.end(JSON.stringify({ ok: status < 400 }));
    });
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return `http://127.0.0.1:${port}/alert`;
}

afterEach(() => {
  delete process.env.SAFETY_ALERT_WEBHOOK_URL;
  delete process.env.SAFETY_BACKUP_WEBHOOK_URL;
});

afterAll(async () => {
  for (const server of servers) await new Promise<void>((resolve) => server.close(() => resolve()));
  for (const id of caseIds) await admin.from('audit_events').delete().eq('entity_id', id);
});

describe('safety alert plan', () => {
  it('requires the primary channels and adds a backup channel only for urgent/emergency', () => {
    const review = buildSafetyAlertPlan('review').map((c) => c.channelName);
    expect(review).toContain('ops_dashboard');
    expect(review).toContain('primary_sms');
    expect(review).not.toContain('backup_pager');

    const urgent = buildSafetyAlertPlan('urgent').map((c) => c.channelName);
    expect(urgent).toContain('backup_pager');
  });
});

describe('safety alert dispatch reports what actually happened', () => {
  it('reports not_configured when no transport exists, and flags human follow-up', async () => {
    const caseId = nextCaseId();
    const dispatcher = new SafetyAlertDispatcher(admin);
    const results = await dispatcher.dispatch({
      caseId,
      sessionId: crypto.randomUUID(),
      severity: 'urgent',
      reasonCodes: ['self_harm_risk'],
    });

    const byChannel = Object.fromEntries(results.map((r) => [r.channelName, r.state]));
    expect(byChannel.ops_dashboard).toBe('delivered');
    expect(byChannel.primary_sms).toBe('not_configured');
    expect(byChannel.backup_pager).toBe('not_configured');

    const summary = summarizeSafetyAlertDelivery(results);
    expect(summary.delivered).toEqual(['ops_dashboard']);
    expect(summary.followUpRequired).toBe(true);
    expect(safetyAlertNeedsHumanFollowUp(results)).toBe(true);
  });

  it('reports delivered with a provider reference when a real transport acknowledges', async () => {
    const url = await startReceiver(200);
    process.env.SAFETY_ALERT_WEBHOOK_URL = url;
    process.env.SAFETY_BACKUP_WEBHOOK_URL = url;

    const caseId = nextCaseId();
    const dispatcher = new SafetyAlertDispatcher(admin);
    const results = await dispatcher.dispatch({
      caseId,
      sessionId: crypto.randomUUID(),
      severity: 'emergency',
      reasonCodes: ['imminent_risk'],
    });

    const sms = results.find((r) => r.channelName === 'primary_sms');
    expect(sms?.state).toBe('delivered');
    expect(sms?.providerRef).toBe('ref_local_receiver');
    expect(summarizeSafetyAlertDelivery(results).followUpRequired).toBe(false);
  });

  it('reports failed when the transport rejects the alert', async () => {
    const url = await startReceiver(500);
    process.env.SAFETY_ALERT_WEBHOOK_URL = url;

    const caseId = nextCaseId();
    const dispatcher = new SafetyAlertDispatcher(admin);
    const results = await dispatcher.dispatch({
      caseId,
      sessionId: crypto.randomUUID(),
      severity: 'review',
      reasonCodes: ['user_distress'],
    });

    const sms = results.find((r) => r.channelName === 'primary_sms');
    expect(sms?.state).toBe('failed');
    expect(sms?.detail).toContain('500');
    expect(summarizeSafetyAlertDelivery(results).followUpRequired).toBe(true);
  });

  it('reports failed when the transport is unreachable', async () => {
    // Port 1 is not listening on the loopback interface.
    process.env.SAFETY_ALERT_WEBHOOK_URL = 'http://127.0.0.1:1/alert';

    const caseId = nextCaseId();
    const dispatcher = new SafetyAlertDispatcher(admin);
    const results = await dispatcher.dispatch({
      caseId,
      sessionId: crypto.randomUUID(),
      severity: 'review',
      reasonCodes: ['user_distress'],
    });

    const sms = results.find((r) => r.channelName === 'primary_sms');
    expect(['failed', 'ambiguous']).toContain(sms?.state);
    expect(sms?.state).not.toBe('delivered');
  });

  it('persists one append-only attempt row per channel with its true state', async () => {
    const url = await startReceiver(200);
    process.env.SAFETY_ALERT_WEBHOOK_URL = url;

    const caseId = nextCaseId();
    const dispatcher = new SafetyAlertDispatcher(admin);
    const results = await dispatcher.dispatch({
      caseId,
      sessionId: crypto.randomUUID(),
      severity: 'urgent',
      reasonCodes: ['panic'],
    });

    const { data, error } = await admin
      .from('audit_events')
      .select('action, metadata')
      .eq('entity_id', caseId)
      .eq('action', 'safety_alert_dispatch');
    expect(error).toBeNull();
    expect(data).toHaveLength(results.length);

    const persistedStates = (data as Array<{ metadata: { channel: string; state: string } }>).map(
      (row) => `${row.metadata.channel}:${row.metadata.state}`
    );
    for (const r of results) {
      expect(persistedStates).toContain(`${r.channelName}:${r.state}`);
    }
  });
});
