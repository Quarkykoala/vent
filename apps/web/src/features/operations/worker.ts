import { SESSION_CAP_SECONDS } from '@vent/domain';
import { ListenerRepository, type TypedSupabaseClient } from '@vent/db';

/**
 * Operations worker.
 *
 * Every job is idempotent (each one re-checks the state it is about to change
 * and the underlying RPC re-checks it again inside the transaction), so a
 * retry, an overlapping run or a restart after a crash converges instead of
 * double-acting. A failing job never prevents the remaining jobs from running.
 *
 * Jobs that would move money, delete data or make a clinical decision are
 * deliberately read-only here: they surface discrepancies for a human owner.
 */

export interface JobResult {
  job: string;
  changed: number;
  errors: string[];
  durationMs: number;
  details?: Record<string, unknown>;
}

export interface WorkerCycleReport {
  startedAt: string;
  finishedAt: string;
  jobs: JobResult[];
}

const STALE_PRESENCE_SECONDS = 30;
const STALE_UNPAID_ORDER_MINUTES = 60;

async function runJob(
  job: string,
  fn: () => Promise<{ changed: number; details?: Record<string, unknown> }>
): Promise<JobResult> {
  const startedAt = Date.now();
  try {
    const result = await fn();
    return {
      job,
      changed: result.changed,
      errors: [],
      durationMs: Date.now() - startedAt,
      details: result.details,
    };
  } catch (err: unknown) {
    return {
      job,
      changed: 0,
      errors: [err instanceof Error ? err.message : String(err)],
      durationMs: Date.now() - startedAt,
    };
  }
}

export class OperationsWorker {
  constructor(private admin: TypedSupabaseClient) {}

  async runCycle(): Promise<WorkerCycleReport> {
    const startedAt = new Date().toISOString();
    const jobs: JobResult[] = [];

    jobs.push(await runJob('expire_offers', () => this.expireOffers()));
    jobs.push(await runJob('sweep_stale_presence', () => this.sweepStalePresence()));
    jobs.push(await runJob('enforce_session_cap', () => this.enforceSessionCap()));
    jobs.push(await runJob('reconcile_payments', () => this.reconcilePayments()));
    jobs.push(await runJob('verify_ledger_integrity', () => this.verifyLedgerIntegrity()));
    jobs.push(await runJob('report_pending_deletions', () => this.reportPendingDeletions()));

    return { startedAt, finishedAt: new Date().toISOString(), jobs };
  }

  /** Offers past their TTL return the request to the queue and free the listener. */
  private async expireOffers(): Promise<{ changed: number; details?: Record<string, unknown> }> {
    const raw = this.admin as any;
    const { data: due, error } = await raw.rpc('list_ttl_expired_reservations', { p_limit: 200 });
    if (error) throw new Error(`list_ttl_expired_reservations failed: ${error.message}`);

    let changed = 0;
    const failures: string[] = [];
    for (const row of (due ?? []) as Array<{ reservation_id: string }>) {
      const { data, error: expireErr } = await raw.rpc('atomic_expire_reservation', {
        p_reservation_id: row.reservation_id,
      });
      if (expireErr) {
        failures.push(`${row.reservation_id}: ${expireErr.message}`);
        continue;
      }
      if (data?.success) changed += 1;
    }
    return { changed, details: { due: (due ?? []).length, failures } };
  }

  /** Available listeners whose heartbeat went stale become offline. */
  private async sweepStalePresence(): Promise<{ changed: number }> {
    const repo = new ListenerRepository(this.admin);
    const changed = await repo.sweepStalePresence(STALE_PRESENCE_SECONDS);
    return { changed };
  }

  /** Sessions past the approved cap are ended by the server, never by a client. */
  private async enforceSessionCap(): Promise<{ changed: number; details?: Record<string, unknown> }> {
    const raw = this.admin as any;
    const { data: due, error } = await raw.rpc('list_cap_expired_sessions', {
      p_cap_seconds: SESSION_CAP_SECONDS,
      p_limit: 100,
    });
    if (error) throw new Error(`list_cap_expired_sessions failed: ${error.message}`);

    let changed = 0;
    const failures: string[] = [];
    for (const row of (due ?? []) as Array<{ session_id: string; elapsed_seconds: number }>) {
      const { data, error: capErr } = await raw.rpc('atomic_expire_session_cap', {
        p_session_id: row.session_id,
        p_cap_seconds: SESSION_CAP_SECONDS,
        p_end_reason: 'duration_cap',
      });
      if (capErr) {
        failures.push(`${row.session_id}: ${capErr.message}`);
        continue;
      }
      if (data?.due) changed += 1;
    }
    return { changed, details: { due: (due ?? []).length, failures } };
  }

  /**
   * Read-only provider/local discrepancy surface. Nothing is auto-corrected:
   * a human finance owner decides what to do with each finding.
   */
  private async reconcilePayments(): Promise<{ changed: number; details?: Record<string, unknown> }> {
    const raw = this.admin as any;

    // payments and support_requests have no foreign key between them (the link
    // is support_requests.payment_order_id), so the join is done here rather
    // than through an embedded PostgREST relation.
    const { data: captured, error: capturedErr } = await raw
      .from('payments')
      .select('id, provider_order_id, amount_paise, state')
      .eq('state', 'captured');
    if (capturedErr) throw new Error(`captured payment read failed: ${capturedErr.message}`);

    const { data: boundRequests, error: boundErr } = await raw
      .from('support_requests')
      .select('id, state, payment_order_id')
      .not('payment_order_id', 'is', null);
    if (boundErr) throw new Error(`bound request read failed: ${boundErr.message}`);

    const byPayment = new Map<string, Array<{ id: string; state: string }>>();
    for (const r of (boundRequests ?? []) as Array<{ id: string; state: string; payment_order_id: string }>) {
      const list = byPayment.get(r.payment_order_id) ?? [];
      list.push({ id: r.id, state: r.state });
      byPayment.set(r.payment_order_id, list);
    }

    const capturedWithoutAnyRequest: string[] = [];
    const capturedNeverQueued: string[] = [];
    for (const p of (captured ?? []) as Array<{ id: string }>) {
      const requests = byPayment.get(p.id) ?? [];
      if (requests.length === 0) {
        // Real orphan: money captured with no request bound at all.
        capturedWithoutAnyRequest.push(p.id);
      } else if (requests.every((r) => r.state === 'created' || r.state === 'paid')) {
        // Captured but the request never entered the queue: actionable.
        capturedNeverQueued.push(p.id);
      }
      // Requests in queued/reserved/accepted/connected/completed/cancelled/...
      // are normal lifecycle outcomes, not discrepancies.
    }

    const staleCutoff = new Date(Date.now() - STALE_UNPAID_ORDER_MINUTES * 60_000).toISOString();
    const { data: stale, error: staleErr } = await raw
      .from('payments')
      .select('id')
      .in('state', ['created', 'authorized'])
      .lt('created_at', staleCutoff);
    if (staleErr) throw new Error(`stale payment read failed: ${staleErr.message}`);

    return {
      changed: 0,
      details: {
        capturedWithoutAnyRequest: capturedWithoutAnyRequest.length,
        capturedNeverQueued: capturedNeverQueued.length,
        orphanPaymentIds: capturedWithoutAnyRequest.slice(0, 20),
        neverQueuedPaymentIds: capturedNeverQueued.slice(0, 20),
        staleUnpaidOrders: (stale ?? []).length,
      },
    };
  }

  /**
   * Read-only ledger integrity check: every double-entry event must have equal
   * debits and credits. A one-sided event means a journal was written in two
   * pieces (or half-written) and the trial balance is lying. Nothing is
   * auto-corrected — the ledger is append-only and a human posts the
   * compensating entry.
   */
  private async verifyLedgerIntegrity(): Promise<{ changed: number; details?: Record<string, unknown> }> {
    const { data, error } = await (this.admin as any)
      .from('ledger_entries')
      .select('event_id, account_code, direction, amount_paise');
    if (error) throw new Error(`ledger read failed: ${error.message}`);

    const byEvent = new Map<string, { debit: bigint; credit: bigint; entries: number }>();
    for (const row of (data ?? []) as Array<{
      event_id: string;
      direction: string;
      amount_paise: number | string;
    }>) {
      const agg = byEvent.get(row.event_id) ?? { debit: 0n, credit: 0n, entries: 0 };
      const amount = BigInt(row.amount_paise);
      if (row.direction === 'debit') agg.debit += amount;
      else agg.credit += amount;
      agg.entries += 1;
      byEvent.set(row.event_id, agg);
    }

    const unbalanced: string[] = [];
    let totalDebit = 0n;
    let totalCredit = 0n;
    for (const [eventId, agg] of byEvent) {
      totalDebit += agg.debit;
      totalCredit += agg.credit;
      if (agg.debit !== agg.credit) unbalanced.push(eventId);
    }

    return {
      changed: 0,
      details: {
        events: byEvent.size,
        unbalancedEvents: unbalanced.length,
        unbalancedEventIds: unbalanced.slice(0, 20),
        trialBalanceDebitPaise: totalDebit.toString(),
        trialBalanceCreditPaise: totalCredit.toString(),
        trialBalanceBalanced: totalDebit === totalCredit,
      },
    };
  }

  /**
   * DPDP erasure requests are surfaced for the privacy owner. This job never
   * deletes anything: erasure runs through the audited privacy endpoint.
   */
  private async reportPendingDeletions(): Promise<{ changed: number; details?: Record<string, unknown> }> {
    const { data, error } = await (this.admin as any)
      .from('users')
      .select('id, status')
      .eq('status', 'deletion_pending');
    if (error) throw new Error(`pending deletion read failed: ${error.message}`);
    return { changed: 0, details: { pending: (data ?? []).length } };
  }
}
