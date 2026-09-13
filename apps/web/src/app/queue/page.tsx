'use client';

import React, { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import PhoneSignIn from '@/features/auth/PhoneSignIn';

interface QueueStatus {
  requestId: string;
  topic: string;
  language: string;
  state: string;
  queuedAt: string | null;
  expiresAt: string | null;
  reservation: { id: string; state: string; offeredAt: string; expiresAt: string } | null;
  session: { id: string; state: string } | null;
}

function describeState(status: QueueStatus): string {
  switch (status.state) {
    case 'created':
      return 'Your request is saved but not yet paid. Complete payment to enter the queue.';
    case 'paid':
    case 'queued':
      return status.reservation
        ? 'A trained listener has been offered your request and is deciding. This usually resolves within a minute.'
        : 'Your paid request is in the queue. We are looking for an available trained listener.';
    case 'reserved':
      return 'A trained listener has been offered your request and is deciding. This usually resolves within a minute.';
    case 'accepted':
    case 'connected':
      return status.session
        ? 'Your listener accepted. Your audio session is ready.'
        : 'Your listener accepted. Preparing your audio session.';
    case 'completed':
      return 'Your session is complete. Thank you for talking with us.';
    case 'declined':
    case 'offer_expired':
      return 'That offer did not work out. Your request is being matched again.';
    case 'cancelled':
      return 'This request was cancelled.';
    case 'expired':
      return 'This request expired before a listener could be found.';
    case 'technical_failed':
      return 'A technical problem interrupted this request. You can start a new request.';
    case 'payment_failed':
      return 'Payment failed and no money was captured. You can try again.';
    default:
      return `Current state: ${status.state}.`;
  }
}

export default function QueuePage() {
  return (
    <Suspense fallback={<p className="text-sm text-slate-600">Loading your queue...</p>}>
      <QueueContent />
    </Suspense>
  );
}

function QueueContent() {
  const searchParams = useSearchParams();
  const requestId = searchParams.get('requestId') ?? '';
  const [ageConfirmed, setAgeConfirmed] = useState(false);
  const [sessionToken, setSessionToken] = useState<string | null>(null);
  const [status, setStatus] = useState<QueueStatus | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [isError, setIsError] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const loadStatus = useCallback(async () => {
    if (!sessionToken || !requestId) return;
    try {
      const res = await fetch(`/api/support-requests/${requestId}/queue-status`, {
        headers: { Authorization: `Bearer ${sessionToken}` },
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        if (res.status === 401) {
          setSessionToken(null);
          throw new Error('Your sign-in has expired. Please verify your number again.');
        }
        throw new Error(body?.error || 'Could not load queue status.');
      }
      setStatus(body);
      setIsError(false);
      setMessage(null);
    } catch (err: any) {
      setIsError(true);
      setMessage(err.message || 'Could not load queue status.');
    }
  }, [sessionToken, requestId]);

  const triggerMatch = useCallback(async () => {
    if (!sessionToken || !requestId) return;
    try {
      const res = await fetch(`/api/support-requests/${requestId}/match`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${sessionToken}` },
      });
      await res.json().catch(() => null);
      await loadStatus();
    } catch {
      await loadStatus();
    }
  }, [sessionToken, requestId, loadStatus]);

  useEffect(() => {
    if (!sessionToken || !requestId) return;
    loadStatus();
    pollRef.current = setInterval(async () => {
      await triggerMatch();
    }, 8000);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [sessionToken, requestId, loadStatus, triggerMatch]);

  return (
    <div className="max-w-xl mx-auto py-8">
      <div className="text-center mb-8">
        <h1 className="text-3xl font-extrabold tracking-tight text-slate-900">Your queue</h1>
        <p className="mt-3 text-base text-slate-600">
          Live status for your paid request. No wait-time promises — this page shows what is actually happening.
        </p>
      </div>

      <div className="bg-white p-6 sm:p-8 rounded-2xl shadow-sm border border-slate-200 space-y-6">
        {!requestId && (
          <p className="text-sm text-slate-600">
            No request selected. Create a request from the home page first.
          </p>
        )}

        {requestId && !sessionToken && (
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
                setMessage('Signed in. Loading your queue status.');
              }}
            />
          </>
        )}

        {requestId && sessionToken && !status && !isError && (
          <p className="text-sm text-slate-600">Loading queue status...</p>
        )}

        {status && (
          <div className="text-sm text-slate-800 space-y-2">
            <p className="font-semibold">
              {status.topic} · {status.language}
            </p>
            <p>{describeState(status)}</p>
            <p className="text-xs text-slate-500">State: {status.state}</p>
            {status.reservation && (
              <p className="text-xs text-slate-500">
                Offer {status.reservation.state} at {new Date(status.reservation.offeredAt).toLocaleTimeString()};
                expires {new Date(status.reservation.expiresAt).toLocaleTimeString()}.
              </p>
            )}
            {status.session && (
              <a
                href={`/session/${status.session.id}`}
                className="mt-3 block w-full rounded-lg bg-emerald-600 px-4 py-2 text-center text-sm font-medium text-white hover:bg-emerald-700"
              >
                Join your audio session
              </a>
            )}
            <button
              type="button"
              onClick={triggerMatch}
              className="mt-2 w-full rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              Check for a match now
            </button>
          </div>
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
