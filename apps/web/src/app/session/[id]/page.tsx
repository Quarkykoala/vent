'use client';

import React, { Suspense, useCallback, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import PhoneSignIn from '@/features/auth/PhoneSignIn';
import { AudioCallRoom } from '@/features/audio/AudioCallRoom';

interface TokenResult {
  token: string;
  url: string;
  participantAlias: string;
  expiresAt: string;
  startedAt: string;
  maxDurationSeconds: number;
  remainingSeconds: number;
  role: 'user' | 'listener';
}

export default function SessionPage() {
  return (
    <Suspense fallback={<p className="text-sm text-slate-600">Loading your session...</p>}>
      <SessionContent />
    </Suspense>
  );
}

function SessionContent() {
  const params = useParams();
  const sessionId = typeof params.id === 'string' ? params.id : '';
  const [ageConfirmed, setAgeConfirmed] = useState(false);
  const [sessionToken, setSessionToken] = useState<string | null>(null);
  const [roomToken, setRoomToken] = useState<TokenResult | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [isError, setIsError] = useState(false);
  const [ending, setEnding] = useState(false);
  const [ended, setEnded] = useState(false);
  const [connectionLost, setConnectionLost] = useState(false);
  const [reconnectNonce, setReconnectNonce] = useState(0);
  const [safetyOpen, setSafetyOpen] = useState(false);
  const [safetyMessage, setSafetyMessage] = useState<string | null>(null);

  const fetchRoomToken = useCallback(async () => {
    if (!sessionToken || !sessionId || ended) return;
    try {
      const res = await fetch(`/api/sessions/${sessionId}/token`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${sessionToken}` },
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        if (res.status === 401) {
          setSessionToken(null);
          throw new Error('Your sign-in has expired. Please verify your number again.');
        }
        if (res.status === 503) {
          throw new Error('Audio service is not configured right now. Please try again later.');
        }
        throw new Error(body?.error || 'Could not join the audio room.');
      }
      setRoomToken(body);
      setIsError(false);
      setMessage(null);
    } catch (err: any) {
      setIsError(true);
      setMessage(err.message || 'Could not join the audio room.');
    }
  }, [sessionToken, sessionId, ended]);

  useEffect(() => {
    if (sessionToken && sessionId && !roomToken && !ended) {
      fetchRoomToken();
    }
  }, [sessionToken, sessionId, roomToken, ended, fetchRoomToken]);

  async function handleEndSession(reason: string = 'normal_completion') {
    if (!sessionToken || !sessionId || ending || ended) return;
    setEnding(true);
    try {
      const res = await fetch(`/api/sessions/${sessionId}/end`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${sessionToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ reason }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error(body?.error || 'Could not end the session on the server.');
      }
      setEnded(true);
      setIsError(false);
      setMessage(
        `Session ended. Duration: ${Math.floor((body.durationSeconds ?? 0) / 60)} min. You can now rate your listener.`
      );
    } catch (err: any) {
      setIsError(true);
      setMessage(err.message || 'Could not end the session. Please try again.');
    } finally {
      setEnding(false);
    }
  }

  /**
   * Reconnect without losing the in-memory session: request a fresh room token
   * (the previous one may have expired) and remount the room with it. A full
   * page reload would discard the memory-only sign-in and force a new OTP in
   * the middle of a live session.
   */
  async function handleReconnect() {
    setConnectionLost(false);
    setRoomToken(null);
    setReconnectNonce((n) => n + 1);
    await fetchRoomToken();
  }

  /**
   * In-session safety control. The server records the case, ends the session
   * safely and reports which alert channels actually acknowledged. The UI never
   * claims a supervisor was reached when no transport exists.
   */
  async function handleSafetyConcern() {
    if (!sessionToken || !sessionId) return;
    setSafetyOpen(true);
    setSafetyMessage('Raising a safety concern...');
    try {
      const res = await fetch('/api/safety-cases', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${sessionToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          sessionId,
          severity: 'urgent',
          reasonCodes: ['user_requested_supervisor'],
          idempotencyKey: crypto.randomUUID(),
        }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error(body?.error || 'Could not raise the safety concern.');
      }
      setEnded(true);
      setSafetyMessage(
        body?.delivery?.followUpRequired
          ? 'Safety case recorded and the session has ended safely. Some alert channels did not confirm delivery, so the on-call supervisor queue requires a human check.'
          : 'Safety case recorded and the session has ended safely. The supervisor queue holds your case.'
      );
    } catch (err: any) {
      setSafetyMessage(err.message || 'Could not raise the safety concern.');
    }
  }

  return (
    <div className="max-w-xl mx-auto py-8">
      <div className="text-center mb-8">
        <h1 className="text-3xl font-extrabold tracking-tight text-slate-900">Private audio session</h1>
        <p className="mt-3 text-base text-slate-600">
          Audio only, with a trained human listener. No recording, no transcripts.
        </p>
      </div>

      <div className="space-y-6">
        {!sessionId && <p className="text-sm text-slate-600">No session selected.</p>}

        {sessionId && !sessionToken && (
          <div className="bg-white p-6 sm:p-8 rounded-2xl shadow-sm border border-slate-200 space-y-6">
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
                setMessage('Signed in. Joining your audio room.');
              }}
            />
          </div>
        )}

        {sessionId && sessionToken && !roomToken && !isError && (
          <p className="text-sm text-slate-600">Requesting a short-lived audio token...</p>
        )}

        {sessionId && sessionToken && roomToken && !ended && (
          <AudioCallRoom
            key={reconnectNonce}
            token={roomToken.token}
            url={roomToken.url}
            sessionTitle={`Private session · ${roomToken.participantAlias}`}
            remainingSeconds={roomToken.remainingSeconds}
            onCapReached={() => handleEndSession('duration_cap')}
            onSafetyConcern={handleSafetyConcern}
            connectionLost={connectionLost}
            onConnectionLost={() => setConnectionLost(true)}
            onReconnect={handleReconnect}
            onEndCall={() => handleEndSession()}
          />
        )}

        {safetyOpen && (
          <div
            data-testid="safety-panel"
            className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-xs text-amber-900 space-y-2"
          >
            <p className="font-semibold">Safety concern raised</p>
            <p>{safetyMessage}</p>
            <p>
              A trained human supervisor reviews every safety case. If you or someone else is in
              immediate danger, call <strong>112</strong> (emergency) or{' '}
              <strong>Tele-MANAS 14416</strong> now.
            </p>
            <a href="/crisis" className="inline-block font-semibold underline">
              Open crisis resources
            </a>
          </div>
        )}

        {/*
          Safety is never conditional on the audio room. Crisis resources and the
          human escalation control must stay reachable when the room fails to
          load (unconfigured provider, cap reached, expired token) and after the
          session has ended.
        */}
        {sessionId && sessionToken && !safetyOpen && (
          <div
            data-testid="session-safety-bar"
            className="rounded-xl border border-slate-300 bg-slate-50 p-3 text-xs text-slate-700 space-y-2"
          >
            <p className="font-semibold text-slate-800">Need help right now?</p>
            <p>
              If you are in immediate danger, call <strong>112</strong> (emergency) or{' '}
              <strong>Tele-MANAS 14416</strong>. Both are free and available now.
            </p>
            <div className="flex flex-wrap gap-2">
              <a href="/crisis" className="rounded-lg border border-slate-300 px-3 py-1.5 font-medium">
                Crisis resources
              </a>
              <button
                type="button"
                onClick={handleSafetyConcern}
                data-testid="safety-concern-fallback"
                className="rounded-lg bg-amber-600 px-3 py-1.5 font-semibold text-white hover:bg-amber-500"
              >
                Raise a safety concern
              </button>
            </div>
          </div>
        )}

        {sessionId && sessionToken && !ended && (
          <button
            type="button"
            onClick={() => handleEndSession()}
            disabled={ending}
            className="w-full rounded-xl bg-red-600 px-4 py-3 text-sm font-medium text-white hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {ending ? 'Ending session...' : 'End session on the server'}
          </button>
        )}

        {ended && (
          <a
            href={`/history`}
            className="block w-full rounded-xl bg-emerald-600 px-4 py-3 text-center text-sm font-medium text-white hover:bg-emerald-700"
          >
            Continue to rating and history
          </a>
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
