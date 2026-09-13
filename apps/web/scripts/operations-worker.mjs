#!/usr/bin/env node
/**
 * Operations worker runner.
 *
 * Calls the secret-protected operations cron endpoint on an interval, with
 * bounded exponential backoff, structured allowlisted logging and graceful
 * shutdown. Restarting it is safe: every job it triggers is idempotent.
 *
 *   node scripts/operations-worker.mjs --once     # one cycle, then exit
 *   node scripts/operations-worker.mjs            # loop
 *
 * Environment:
 *   OPERATIONS_WORKER_URL            default http://127.0.0.1:3000/api/operations/cron
 *   OPERATIONS_CRON_SECRET           required (same value as the server)
 *   OPERATIONS_WORKER_INTERVAL_MS    default 15000
 */

const endpoint = process.env.OPERATIONS_WORKER_URL || 'http://127.0.0.1:3000/api/operations/cron';
const secret = process.env.OPERATIONS_CRON_SECRET || '';
const intervalMs = Number(process.env.OPERATIONS_WORKER_INTERVAL_MS || 15000);
const runOnce = process.argv.includes('--once');

let stopping = false;
let consecutiveFailures = 0;

function log(payload) {
  process.stdout.write(`${JSON.stringify({ ts: new Date().toISOString(), ...payload })}\n`);
}

async function runCycle() {
  const startedAt = Date.now();
  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'x-operations-secret': secret },
    });
    const body = await res.json().catch(() => null);

    if (res.status === 401 || res.status === 503) {
      log({ event: 'operations_cycle_rejected', status: res.status, code: body?.code ?? null });
      // Configuration problems are not retryable in a tight loop.
      return false;
    }

    const jobs = Array.isArray(body?.jobs) ? body.jobs : [];
    log({
      event: 'operations_cycle',
      status: res.status,
      duration_ms: Date.now() - startedAt,
      jobs: jobs.map((j) => ({ job: j.job, changed: j.changed, errors: j.errors?.length ?? 0 })),
    });

    if (res.status !== 200) {
      log({ event: 'operations_cycle_partial', status: res.status });
    }
    return true;
  } catch (err) {
    log({ event: 'operations_cycle_failed', duration_ms: Date.now() - startedAt, error: String(err?.message ?? err) });
    return false;
  }
}

function backoffMs() {
  consecutiveFailures += 1;
  return Math.min(60_000, intervalMs * 2 ** Math.min(consecutiveFailures, 4));
}

async function main() {
  if (!secret) {
    log({ event: 'operations_worker_misconfigured', reason: 'OPERATIONS_CRON_SECRET is not set' });
    process.exitCode = 2;
    return;
  }

  process.on('SIGINT', () => {
    stopping = true;
    log({ event: 'operations_worker_stopping', signal: 'SIGINT' });
  });
  process.on('SIGTERM', () => {
    stopping = true;
    log({ event: 'operations_worker_stopping', signal: 'SIGTERM' });
  });

  log({ event: 'operations_worker_started', endpoint, interval_ms: intervalMs, once: runOnce });

  do {
    const ok = await runCycle();
    if (ok) consecutiveFailures = 0;
    if (runOnce) break;
    if (stopping) break;
    const waitMs = ok ? intervalMs : backoffMs();
    await new Promise((resolve) => setTimeout(resolve, waitMs));
  } while (!stopping);

  log({ event: 'operations_worker_stopped' });
}

main();
