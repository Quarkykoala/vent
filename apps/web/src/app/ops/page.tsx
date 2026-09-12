'use client';

import React, { useCallback, useEffect, useState } from 'react';
import PhoneSignIn from '@/features/auth/PhoneSignIn';

export default function OpsPage() {
  const [ageConfirmed, setAgeConfirmed] = useState(false);
  const [sessionToken, setSessionToken] = useState<string | null>(null);
  const [role, setRole] = useState<string | null>(null);
  const [queue, setQueue] = useState<any | null>(null);
  const [cases, setCases] = useState<any[] | null>(null);
  const [reconcile, setReconcile] = useState<any | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [isError, setIsError] = useState(false);
  const [busy, setBusy] = useState(false);
  const [reviewForm, setReviewForm] = useState({ listenerId: '', status: 'active', reason: '' });
  const [expiryForm, setExpiryForm] = useState({ reservationId: '' });

  function fail(msg: string): never {
    throw new Error(msg);
  }

  async function authed(path: string, init?: RequestInit): Promise<any> {
    const res = await fetch(path, {
      ...init,
      headers: { ...(init?.headers ?? {}), Authorization: `Bearer ${sessionToken}` },
    });
    const body = await res.json().catch(() => null);
    if (!res.ok) {
      if (res.status === 401) {
        setSessionToken(null);
        fail('Your sign-in has expired. Please verify your number again.');
      }
      fail(body?.error || `Request to ${path} failed.`);
    }
    return body;
  }

  const loadAll = useCallback(async () => {
    if (!sessionToken) return;
    try {
      const me = await authed('/api/auth/me');
      setRole(me.role);
      const staff = ['listener_ops', 'super_admin', 'support_agent', 'clinical_supervisor', 'finance'];
      if (!staff.includes(me.role)) {
        fail(`Role '${me.role}' has no operator access.`);
      }
      const [q, r] = await Promise.all([
        authed('/api/operations/queue').catch(() => null),
        authed('/api/finance/reconcile').catch(() => null),
      ]);
      setQueue(q);
      setReconcile(r);
      try {
        const sc = await authed('/api/safety-cases');
        setCases(sc.cases ?? []);
      } catch {
        setCases(null);
      }
      setIsError(false);
      setMessage(null);
    } catch (err: any) {
      setIsError(true);
      setMessage(err.message || 'Could not load operator data.');
    }
  }, [sessionToken]);

  useEffect(() => {
    if (sessionToken) loadAll();
  }, [sessionToken, loadAll]);

  async function handleReview() {
    if (!sessionToken || busy || !reviewForm.listenerId) return;
    setBusy(true);
    try {
      await authed('/api/listeners/review', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          listenerId: reviewForm.listenerId,
          status: reviewForm.status,
          reason: reviewForm.reason || undefined,
        }),
      });
      setIsError(false);
      setMessage(`Listener ${reviewForm.listenerId} set to ${reviewForm.status}.`);
    } catch (err: any) {
      setIsError(true);
      setMessage(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function handleExpiry() {
    if (!sessionToken || busy || !expiryForm.reservationId) return;
    setBusy(true);
    try {
      const body = await authed('/api/operations/reservation-expiry', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reservationId: expiryForm.reservationId }),
      });
      setIsError(false);
      setMessage(`Expiry check: ${body.action}.`);
    } catch (err: any) {
      setIsError(true);
      setMessage(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function handleCase(caseId: string, action: 'acknowledge' | 'resolve') {
    if (!sessionToken || busy) return;

    // The API validates resolution codes against the approved enum; asking the
    // supervisor which outcome applies avoids guessing on their behalf (and
    // avoids the 400 that a hard-coded, unapproved code produced).
    let resolutionCode = 'false_alarm';
    if (action === 'resolve') {
      const answer = window.prompt(
        'Resolution code — one of: resources_shared | crisis_referred | false_alarm | escalated_to_emergency | session_terminated',
        'resources_shared'
      );
      if (!answer) return;
      resolutionCode = answer.trim();
    }

    setBusy(true);
    try {
      await authed(`/api/safety-cases/${caseId}/${action}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(action === 'resolve' ? { resolutionCode } : {}),
      });
      setIsError(false);
      setMessage(`Safety case ${action}d.`);
      await loadAll();
    } catch (err: any) {
      setIsError(true);
      setMessage(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function handleRefund() {
    if (!sessionToken || busy) return;
    const paymentId = window.prompt('Payment ID to review for refund:');
    if (!paymentId) return;
    setBusy(true);
    try {
      const body = await authed('/api/finance/refunds', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ paymentId, failureReason: 'technical_failure', durationSeconds: 0 }),
      });
      setIsError(false);
      // Report the provider outcome, not a hope: money has only moved when the
      // provider settled it and the ledger was posted.
      setMessage(
        `Refund ${body.refundId}: ${body.refundAmountPaise} paise (${body.refundPercentage}%). ` +
          `Provider: ${body.providerOutcome}. Ledger posted: ${body.ledgerPosted ? 'yes' : 'no'}. ` +
          `Payment state: ${body.paymentState}.`
      );
    } catch (err: any) {
      setIsError(true);
      setMessage(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="max-w-2xl mx-auto py-8">
      <div className="text-center mb-8">
        <h1 className="text-3xl font-extrabold tracking-tight text-slate-900">Operations</h1>
        <p className="mt-3 text-base text-slate-600">
          Queue, safety, refund and payout review for authorized staff. Every action is audited.
        </p>
      </div>

      <div className="bg-white p-6 sm:p-8 rounded-2xl shadow-sm border border-slate-200 space-y-6">
        {!sessionToken ? (
          <>
            <label className="flex items-start gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={ageConfirmed}
                onChange={(e) => setAgeConfirmed(e.target.checked)}
                className="mt-1 h-4 w-4 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
              />
              <span className="text-xs text-slate-600 leading-relaxed">
                I confirm that I am <strong>18 years of age or older</strong>.
              </span>
            </label>
            <PhoneSignIn
              ageConfirmed={ageConfirmed}
              onAuthenticated={(token) => {
                setSessionToken(token);
                setIsError(false);
                setMessage('Signed in. Loading operator data.');
              }}
            />
          </>
        ) : (
          <>
            <p className="text-xs text-slate-600">Signed in with staff role: <strong>{role ?? '…'}</strong></p>

            <section>
              <h2 className="text-sm font-semibold text-slate-800">Live queue</h2>
              {queue ? (
                <div className="mt-1 text-xs text-slate-700">
                  <p>Queued: {queue.queuedCount} · Reserved: {queue.reservedCount} · Available listeners: {queue.availableListeners}</p>
                  <ul className="mt-2 space-y-1">
                    {(queue.openRequests ?? []).map((r: any) => (
                      <li key={r.id} className="rounded border border-slate-200 p-2 font-mono">{r.id} · {r.state}</li>
                    ))}
                  </ul>
                </div>
              ) : (
                <p className="mt-1 text-xs text-slate-500">Queue data unavailable for your role.</p>
              )}
              <div className="mt-2 flex gap-2">
                <input
                  value={expiryForm.reservationId}
                  onChange={(e) => setExpiryForm({ reservationId: e.target.value })}
                  placeholder="Reservation ID to expire if due"
                  className="flex-1 rounded-md border border-slate-300 px-3 py-2 text-xs"
                />
                <button
                  type="button"
                  onClick={handleExpiry}
                  disabled={busy}
                  className="rounded-md bg-slate-800 px-4 py-2 text-xs font-medium text-white hover:bg-slate-700 disabled:opacity-50"
                >
                  Run expiry
                </button>
              </div>
            </section>

            <section>
              <h2 className="text-sm font-semibold text-slate-800">Listener review</h2>
              <div className="mt-2 flex flex-col gap-2">
                <input
                  value={reviewForm.listenerId}
                  onChange={(e) => setReviewForm({ ...reviewForm, listenerId: e.target.value })}
                  placeholder="Listener profile ID"
                  className="rounded-md border border-slate-300 px-3 py-2 text-xs"
                />
                <div className="flex gap-2">
                  <select
                    value={reviewForm.status}
                    onChange={(e) => setReviewForm({ ...reviewForm, status: e.target.value })}
                    className="flex-1 rounded-md border border-slate-300 px-3 py-2 text-xs"
                  >
                    {['applicant', 'training', 'active', 'paused', 'suspended', 'rejected'].map((s) => (
                      <option key={s} value={s}>{s}</option>
                    ))}
                  </select>
                  <button
                    type="button"
                    onClick={handleReview}
                    disabled={busy || !reviewForm.listenerId}
                    className="rounded-md bg-slate-800 px-4 py-2 text-xs font-medium text-white hover:bg-slate-700 disabled:opacity-50"
                  >
                    Apply status
                  </button>
                </div>
                <input
                  value={reviewForm.reason}
                  onChange={(e) => setReviewForm({ ...reviewForm, reason: e.target.value })}
                  placeholder="Reason (recorded in audit)"
                  className="rounded-md border border-slate-300 px-3 py-2 text-xs"
                />
              </div>
            </section>

            <section>
              <h2 className="text-sm font-semibold text-slate-800">Safety cases</h2>
              {cases === null ? (
                <p className="mt-1 text-xs text-slate-500">Safety console unavailable for your role.</p>
              ) : cases.length === 0 ? (
                <p className="mt-1 text-xs text-slate-500">No safety cases.</p>
              ) : (
                <ul className="mt-2 space-y-2">
                  {cases.map((c: any) => (
                    <li key={c.id} className="rounded border border-slate-200 p-2 text-xs">
                      <p className="font-mono">{c.id}</p>
                      <p className="mt-1">{c.severity} · {c.state} · {(c.reason_codes ?? []).join(', ')}</p>
                      <div className="mt-2 flex gap-2">
                        <button
                          type="button"
                          onClick={() => handleCase(c.id, 'acknowledge')}
                          disabled={busy || c.state !== 'open'}
                          className="flex-1 rounded bg-slate-800 px-2 py-1 text-white disabled:opacity-50"
                        >
                          Acknowledge
                        </button>
                        <button
                          type="button"
                          onClick={() => handleCase(c.id, 'resolve')}
                          disabled={busy || c.state === 'resolved'}
                          className="flex-1 rounded border border-slate-300 px-2 py-1 disabled:opacity-50"
                        >
                          Resolve
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section>
              <h2 className="text-sm font-semibold text-slate-800">Finance</h2>
              {reconcile ? (
                <p className="mt-1 text-xs text-slate-700">
                  Ledger balanced: {String(reconcile.isBalanced)} · Debits: ₹
                  {(Number(reconcile.totalDebitsPaise ?? 0) / 100).toFixed(2)} · Credits: ₹
                  {(Number(reconcile.totalCreditsPaise ?? 0) / 100).toFixed(2)}
                  {reconcile.reconciliationStatus ? ` · ${reconcile.reconciliationStatus}` : ''}
                  {reconcile.providerReconciliation
                    ? reconcile.providerReconciliation.available
                      ? ` · Provider diff: ${reconcile.providerReconciliation.discrepanciesCount} discrepanc${reconcile.providerReconciliation.discrepanciesCount === 1 ? 'y' : 'ies'} of ${reconcile.providerReconciliation.providerTransactions} transactions`
                      : ' · Provider diff unavailable (no provider credentials)'
                    : ''}
                </p>
              ) : (
                <p className="mt-1 text-xs text-slate-500">Reconciliation unavailable for your role.</p>
              )}
              <button
                type="button"
                onClick={handleRefund}
                disabled={busy}
                className="mt-2 w-full rounded-lg border border-slate-300 px-4 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
              >
                Review a refund proposal
              </button>
              <p className="mt-1 text-[11px] text-slate-500">
                Payout batches require human finance approval via the approve API; execution moves real
                money and is never run from verification flows.
              </p>
            </section>
          </>
        )}

        {message && (
          <div
            role={isError ? 'alert' : 'status'}
            className={`p-3 rounded-lg text-xs border ${
              isError ? 'bg-red-50 border-red-200 text-red-800' : 'bg-blue-50 border-blue-200 text-blue-800'
            }`}
          >
            {message}
          </div>
        )}
      </div>
    </div>
  );
}
