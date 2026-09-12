'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import PhoneSignIn from '@/features/auth/PhoneSignIn';

interface Offer {
  reservationId: string;
  state: string;
  offeredAt: string;
  expiresAt: string;
  topic: string;
  language: string;
  serviceTier: string;
  requestState: string;
}

interface ConsoleData {
  profile: {
    id: string;
    displayName: string;
    status: string;
    tier: string;
    languages: string[];
    topics: string[];
  };
  presence: { state: string; heartbeat_at?: string; available_since?: string };
  offers: Offer[];
  recentSessions: Array<{
    id: string;
    state: string;
    started_at: string | null;
    ended_at: string | null;
    duration_seconds: number | null;
    end_reason: string | null;
  }>;
}

export default function ListenerConsolePage() {
  const [ageConfirmed, setAgeConfirmed] = useState(false);
  const [sessionToken, setSessionToken] = useState<string | null>(null);
  const [data, setData] = useState<ConsoleData | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [isError, setIsError] = useState(false);
  const [busy, setBusy] = useState(false);
  const heartbeatRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const authHeaders = useCallback(
    () => ({ Authorization: `Bearer ${sessionToken}` }),
    [sessionToken]
  );

  const loadConsole = useCallback(async () => {
    if (!sessionToken) return;
    try {
      const res = await fetch('/api/listeners/console', { headers: authHeaders() });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        if (res.status === 401) {
          setSessionToken(null);
          throw new Error('Your sign-in has expired. Please verify your number again.');
        }
        throw new Error(body?.error || 'Could not load the listener console.');
      }
      setData(body);
      setIsError(false);
      setMessage(null);
    } catch (err: any) {
      setIsError(true);
      setMessage(err.message || 'Could not load the listener console.');
    }
  }, [sessionToken, authHeaders]);

  useEffect(() => {
    if (!sessionToken) return;
    loadConsole();
    heartbeatRef.current = setInterval(async () => {
      try {
        await fetch('/api/listeners/presence/heartbeat', {
          method: 'POST',
          headers: { ...authHeaders(), 'Content-Type': 'application/json' },
          body: JSON.stringify({}),
        });
      } catch {
        // Heartbeat failures are silent; the next toggle/load surfaces errors.
      }
    }, 20000);
    return () => {
      if (heartbeatRef.current) clearInterval(heartbeatRef.current);
    };
  }, [sessionToken, loadConsole, authHeaders]);

  async function handleToggle(desiredState: 'available' | 'offline') {
    if (!sessionToken || !data || busy) return;
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch('/api/listeners/presence/toggle', {
        method: 'POST',
        headers: { ...authHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ listenerId: data.profile.id, desiredState }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error(body?.error || 'Could not change availability.');
      }
      await loadConsole();
      setIsError(false);
      setMessage(desiredState === 'available' ? 'You are now available for matches.' : 'You are now offline.');
    } catch (err: any) {
      setIsError(true);
      setMessage(err.message || 'Could not change availability.');
    } finally {
      setBusy(false);
    }
  }

  async function handleOffer(reservationId: string, action: 'accept' | 'decline') {
    if (!sessionToken || busy) return;
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch(`/api/matches/${reservationId}/${action}`, {
        method: 'POST',
        headers: { ...authHeaders(), 'Content-Type': 'application/json' },
        body: action === 'decline' ? JSON.stringify({ reason: 'break' }) : JSON.stringify({}),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error(body?.error || `Could not ${action} the offer.`);
      }
      await loadConsole();
      setIsError(false);
      if (action === 'accept') {
        setMessage(`Offer accepted. Session ${body.sessionId} is ready. Open the session page to join audio.`);
      } else {
        setMessage('Offer declined. The request returns to the queue.');
      }
    } catch (err: any) {
      setIsError(true);
      setMessage(err.message || `Could not ${action} the offer.`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="max-w-xl mx-auto py-8">
      <div className="text-center mb-8">
        <h1 className="text-3xl font-extrabold tracking-tight text-slate-900">Listener console</h1>
        <p className="mt-3 text-base text-slate-600">
          Availability, incoming offers and your recent sessions. You never see caller contact details.
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
                I confirm that I am <strong>18 years of age or older</strong>. I understand that this service provides compassionate human listening and is <strong>not therapy, medical advice, or crisis intervention</strong>.
              </span>
            </label>
            <PhoneSignIn
              ageConfirmed={ageConfirmed}
              onAuthenticated={(token) => {
                setSessionToken(token);
                setIsError(false);
                setMessage('Signed in.');
              }}
            />
          </>
        ) : !data ? (
          <p className="text-sm text-slate-600">Loading your listener console...</p>
        ) : (
          <>
            <div>
              <p className="text-sm font-semibold text-slate-800">
                {data.profile.displayName} · {data.profile.status} · {data.profile.tier}
              </p>
              <p className="text-xs text-slate-600 mt-1">
                Languages: {data.profile.languages.join(', ')}. Topics: {data.profile.topics.join(', ')}.
              </p>
              <p className="text-xs text-slate-600 mt-1">
                Presence: <strong>{data.presence.state}</strong>
              </p>
              <div className="mt-3 flex gap-2">
                <button
                  type="button"
                  onClick={() => handleToggle('available')}
                  disabled={busy || data.presence.state === 'available'}
                  className="flex-1 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Go available
                </button>
                <button
                  type="button"
                  onClick={() => handleToggle('offline')}
                  disabled={busy || data.presence.state === 'offline'}
                  className="flex-1 rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Go offline
                </button>
              </div>
            </div>

            <div>
              <p className="text-sm font-semibold text-slate-800">Incoming offers</p>
              {data.offers.length === 0 ? (
                <p className="mt-1 text-xs text-slate-600">No offers right now. Stay available to receive matches.</p>
              ) : (
                <ul className="mt-2 space-y-3">
                  {data.offers.map((offer) => (
                    <li key={offer.reservationId} className="rounded-lg border border-slate-200 p-3 text-xs">
                      <p className="font-semibold text-slate-800">
                        {offer.topic} · {offer.language} · {offer.serviceTier}
                      </p>
                      <p className="mt-1 text-slate-600">
                        Offered {new Date(offer.offeredAt).toLocaleTimeString()}; expires{' '}
                        {new Date(offer.expiresAt).toLocaleTimeString()}.
                      </p>
                      <div className="mt-2 flex gap-2">
                        <button
                          type="button"
                          onClick={() => handleOffer(offer.reservationId, 'accept')}
                          disabled={busy}
                          className="flex-1 rounded-lg bg-emerald-600 px-3 py-2 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
                        >
                          Accept
                        </button>
                        <button
                          type="button"
                          onClick={() => handleOffer(offer.reservationId, 'decline')}
                          disabled={busy}
                          className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                        >
                          Decline
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div>
              <p className="text-sm font-semibold text-slate-800">Recent sessions</p>
              {data.recentSessions.length === 0 ? (
                <p className="mt-1 text-xs text-slate-600">No sessions yet.</p>
              ) : (
                <ul className="mt-2 space-y-2 text-xs text-slate-700">
                  {data.recentSessions.map((s) => (
                    <li key={s.id} className="rounded-lg border border-slate-200 p-3">
                      <p className="font-mono">{s.id}</p>
                      <p className="mt-1">
                        State: {s.state}
                        {s.duration_seconds !== null ? ` · ${s.duration_seconds}s` : ''}
                        {s.end_reason ? ` · ${s.end_reason}` : ''}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
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
