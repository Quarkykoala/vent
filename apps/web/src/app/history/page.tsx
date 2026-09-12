'use client';

import React, { useCallback, useEffect, useState } from 'react';
import PhoneSignIn from '@/features/auth/PhoneSignIn';

interface HistorySession {
  id: string;
  requestId: string;
  state: string;
  startedAt: string | null;
  endedAt: string | null;
  durationSeconds: number | null;
  endReason: string | null;
  rated: boolean;
}

interface HistoryData {
  requests: Array<{ id: string; topic: string; language: string; state: string; created_at: string }>;
  payments: Array<{ id: string; amount_paise: number; currency: string; state: string; created_at: string }>;
  sessions: HistorySession[];
}

const REASON_TAGS = [
  'great_listener',
  'felt_heard',
  'calm_environment',
  'technical_issues',
  'listener_inattentive',
  'felt_judged',
  'interrupted_frequently',
  'boundary_concern',
];

export default function HistoryPage() {
  const [ageConfirmed, setAgeConfirmed] = useState(false);
  const [sessionToken, setSessionToken] = useState<string | null>(null);
  const [data, setData] = useState<HistoryData | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [isError, setIsError] = useState(false);
  const [ratingSession, setRatingSession] = useState<string | null>(null);
  const [stars, setStars] = useState(5);
  const [tags, setTags] = useState<string[]>([]);
  const [blockListener, setBlockListener] = useState(false);
  const [busy, setBusy] = useState(false);
  const [counselling, setCounselling] = useState<Array<{ id: string; display_name: string }> | null>(null);

  const loadHistory = useCallback(async () => {
    if (!sessionToken) return;
    try {
      const res = await fetch('/api/history', {
        headers: { Authorization: `Bearer ${sessionToken}` },
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        if (res.status === 401) {
          setSessionToken(null);
          throw new Error('Your sign-in has expired. Please verify your number again.');
        }
        throw new Error(body?.error || 'Could not load your history.');
      }
      setData(body);
      setIsError(false);
      setMessage(null);
    } catch (err: any) {
      setIsError(true);
      setMessage(err.message || 'Could not load your history.');
    }
  }, [sessionToken]);

  useEffect(() => {
    if (sessionToken) loadHistory();
  }, [sessionToken, loadHistory]);

  async function handleRate(sessionId: string) {
    if (!sessionToken || busy) return;
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch(`/api/sessions/${sessionId}/rating`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${sessionToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ stars, reasonTags: tags, blockListener }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error(body?.error || 'Could not submit your rating.');
      }
      setRatingSession(null);
      setStars(5);
      setTags([]);
      setBlockListener(false);
      setIsError(false);
      setMessage('Thank you. Your rating was recorded.');
      await loadHistory();
    } catch (err: any) {
      setIsError(true);
      setMessage(err.message || 'Could not submit your rating.');
    } finally {
      setBusy(false);
    }
  }

  async function handlePrivacyRequest() {
    if (!sessionToken || busy) return;
    setBusy(true);
    setMessage(null);
    try {
      const me = await fetch('/api/auth/me', {
        headers: { Authorization: `Bearer ${sessionToken}` },
      });
      const meBody = await me.json().catch(() => null);
      if (!me.ok || !meBody?.userId) {
        throw new Error('Could not identify your account. Please sign in again.');
      }
      const res = await fetch('/api/privacy/erasure', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${sessionToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ userId: meBody.userId }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error(body?.error || 'Could not submit your privacy request.');
      }
      setIsError(false);
      setMessage('Your deletion request was recorded and will be processed under the retention rules.');
    } catch (err: any) {
      setIsError(true);
      setMessage(err.message || 'Could not submit your privacy request.');
    } finally {
      setBusy(false);
    }
  }

  async function loadCounselling() {
    if (!sessionToken || busy) return;
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch('/api/counselling/slots', {
        headers: { Authorization: `Bearer ${sessionToken}` },
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error(body?.error || 'Could not load counselling availability.');
      }
      setCounselling(body.slots ?? []);
      if ((body.slots ?? []).length === 0) {
        setMessage('No verified counsellor is available right now. Please check back later.');
      }
    } catch (err: any) {
      setIsError(true);
      setMessage(err.message || 'Could not load counselling availability.');
    } finally {
      setBusy(false);
    }
  }

  function toggleTag(tag: string) {
    setTags((prev) => (prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]));
  }

  return (
    <div className="max-w-xl mx-auto py-8">
      <div className="text-center mb-8">
        <h1 className="text-3xl font-extrabold tracking-tight text-slate-900">Your sessions</h1>
        <p className="mt-3 text-base text-slate-600">History, ratings and privacy — all under your control.</p>
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
                I confirm that I am <strong>18 years of age or older</strong>. I understand that this service provides compassionate human listening and is <strong>not therapy, medical advice, or crisis intervention</strong>.
              </span>
            </label>
            <PhoneSignIn
              ageConfirmed={ageConfirmed}
              onAuthenticated={(token) => {
                setSessionToken(token);
                setIsError(false);
                setMessage('Signed in. Loading your history.');
              }}
            />
          </>
        ) : !data ? (
          <p className="text-sm text-slate-600">Loading your history...</p>
        ) : (
          <>
            <div>
              <p className="text-sm font-semibold text-slate-800">Sessions</p>
              {data.sessions.length === 0 ? (
                <p className="mt-1 text-xs text-slate-600">No sessions yet.</p>
              ) : (
                <ul className="mt-2 space-y-3">
                  {data.sessions.map((s) => (
                    <li key={s.id} className="rounded-lg border border-slate-200 p-3 text-xs">
                      <p className="font-mono text-slate-700">{s.id}</p>
                      <p className="mt-1 text-slate-600">
                        State: {s.state}
                        {s.durationSeconds !== null ? ` · ${Math.floor(s.durationSeconds / 60)} min` : ''}
                        {s.endReason ? ` · ${s.endReason}` : ''}
                      </p>
                      {s.state === 'ended' && !s.rated && ratingSession !== s.id && (
                        <button
                          type="button"
                          onClick={() => setRatingSession(s.id)}
                          className="mt-2 w-full rounded-lg bg-emerald-600 px-3 py-2 text-xs font-medium text-white hover:bg-emerald-700"
                        >
                          Rate this session
                        </button>
                      )}
                      {s.rated && <p className="mt-2 font-semibold text-emerald-700">Rated. Thank you.</p>}
                      {ratingSession === s.id && (
                        <div className="mt-2 space-y-2 rounded-lg bg-slate-50 p-3">
                          <div className="flex gap-1">
                            {[1, 2, 3, 4, 5].map((n) => (
                              <button
                                key={n}
                                type="button"
                                onClick={() => setStars(n)}
                                className={`px-2 py-1 rounded text-sm font-bold ${
                                  stars >= n ? 'bg-emerald-600 text-white' : 'bg-slate-200 text-slate-600'
                                }`}
                              >
                                {n}
                              </button>
                            ))}
                          </div>
                          <div className="flex flex-wrap gap-1">
                            {REASON_TAGS.map((tag) => (
                              <button
                                key={tag}
                                type="button"
                                onClick={() => toggleTag(tag)}
                                className={`px-2 py-1 rounded text-[11px] border ${
                                  tags.includes(tag)
                                    ? 'border-emerald-600 bg-emerald-50 text-emerald-900'
                                    : 'border-slate-200 text-slate-600'
                                }`}
                              >
                                {tag}
                              </button>
                            ))}
                          </div>
                          <label className="flex items-center gap-2 text-slate-700">
                            <input
                              type="checkbox"
                              checked={blockListener}
                              onChange={(e) => setBlockListener(e.target.checked)}
                            />
                            Never match me with this listener again
                          </label>
                          <button
                            type="button"
                            onClick={() => handleRate(s.id)}
                            disabled={busy}
                            className="w-full rounded-lg bg-emerald-600 px-3 py-2 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
                          >
                            Submit rating
                          </button>
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div>
              <p className="text-sm font-semibold text-slate-800">Requests</p>
              {data.requests.length === 0 ? (
                <p className="mt-1 text-xs text-slate-600">No requests yet.</p>
              ) : (
                <ul className="mt-2 space-y-2 text-xs text-slate-700">
                  {data.requests.map((r) => (
                    <li key={r.id} className="rounded-lg border border-slate-200 p-3">
                      {r.topic} · {r.language} · {r.state}
                    </li>
                  ))}
                </ul>
              )}
              <a
                href="/"
                className="mt-3 block w-full rounded-lg border border-emerald-600 bg-white px-4 py-2 text-center text-sm font-medium text-emerald-700 hover:bg-emerald-50"
              >
                Talk again — start a new request
              </a>
            </div>

            <div>
              <p className="text-sm font-semibold text-slate-800">Payments</p>
              {data.payments.length === 0 ? (
                <p className="mt-1 text-xs text-slate-600">No payments yet.</p>
              ) : (
                <ul className="mt-2 space-y-2 text-xs text-slate-700">
                  {data.payments.map((p) => (
                    <li key={p.id} className="rounded-lg border border-slate-200 p-3">
                      {p.currency} {(p.amount_paise / 100).toFixed(2)} · {p.state}
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div>
              <p className="text-sm font-semibold text-slate-800">Counselling</p>
              <p className="mt-1 text-xs text-slate-600">
                If you need more than listening, you may benefit from speaking with a qualified
                counsellor. Availability below reflects verified providers only.
              </p>
              <button
                type="button"
                onClick={loadCounselling}
                disabled={busy}
                className="mt-2 w-full rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
              >
                Check counsellor availability
              </button>
              {counselling !== null && counselling.length > 0 && (
                <ul className="mt-2 space-y-2 text-xs text-slate-700">
                  {counselling.map((c: any) => (
                    <li key={c.id} className="rounded-lg border border-slate-200 p-3">
                      {c.display_name ?? c.id} · {(c.languages ?? []).join(', ')}
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div>
              <p className="text-sm font-semibold text-slate-800">Privacy</p>
              <p className="mt-1 text-xs text-slate-600">
                You can request deletion of your account under the documented retention rules.
                Legally required records are retained; everything else is removed.
              </p>
              <button
                type="button"
                onClick={handlePrivacyRequest}
                disabled={busy}
                className="mt-2 w-full rounded-lg border border-red-300 px-4 py-2 text-sm font-medium text-red-700 hover:bg-red-50 disabled:opacity-50"
              >
                Request account deletion
              </button>
            </div>
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
