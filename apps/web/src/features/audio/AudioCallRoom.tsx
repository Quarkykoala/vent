'use client';

import React from 'react';
import { useLiveKitRoom } from './use-livekit-room';
import { ConnectionState } from 'livekit-client';

export interface AudioCallRoomProps {
  token: string;
  url: string;
  sessionTitle?: string;
  onEndCall: () => void;
  /** Seconds left before the server-enforced session cap. */
  remainingSeconds?: number;
  /** Called when the visible countdown reaches the server cap. */
  onCapReached?: () => void;
  /** Opens the in-session safety control. Required by the approved flow. */
  onSafetyConcern?: () => void;
  /** Shown when the room dropped but the session itself is still live. */
  connectionLost?: boolean;
  onReconnect?: () => void;
  /** Called when the transport drops, instead of ending the session. */
  onConnectionLost?: () => void;
}

export function AudioCallRoom({
  token,
  url,
  sessionTitle = 'Private Audio Session',
  onEndCall,
  remainingSeconds,
  onCapReached,
  onSafetyConcern,
  connectionLost = false,
  onReconnect,
  onConnectionLost,
}: AudioCallRoomProps) {
  const {
    connectionState,
    isMuted,
    hasRemoteAudio,
    error,
    toggleMute,
    disconnect,
  } = useLiveKitRoom({
    token,
    url,
    autoConnect: true,
    onDisconnected: onConnectionLost ?? onEndCall,
  });

  const [secondsLeft, setSecondsLeft] = React.useState(remainingSeconds ?? null);

  React.useEffect(() => {
    if (typeof remainingSeconds !== 'number') return;
    setSecondsLeft(remainingSeconds);
    const timer = setInterval(() => {
      setSecondsLeft((current) => {
        if (current === null) return current;
        const next = Math.max(0, current - 1);
        return next;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [remainingSeconds]);

  React.useEffect(() => {
    if (secondsLeft === 0) {
      onCapReached?.();
    }
  }, [secondsLeft, onCapReached]);

  const handleHangUp = () => {
    disconnect();
    onEndCall();
  };

  const minutes = secondsLeft === null ? null : Math.floor(secondsLeft / 60);
  const seconds = secondsLeft === null ? null : secondsLeft % 60;

  return (
    <div className="flex flex-col items-center justify-between p-6 bg-slate-900 text-white rounded-2xl shadow-xl max-w-md mx-auto border border-slate-800">
      <div className="text-center space-y-2">
        <h2 className="text-xl font-semibold">{sessionTitle}</h2>
        <div className="flex items-center justify-center space-x-2">
          <span
            className={`h-3 w-3 rounded-full ${
              connectionState === ConnectionState.Connected
                ? 'bg-emerald-500 animate-pulse'
                : connectionState === ConnectionState.Connecting
                ? 'bg-amber-500 animate-pulse'
                : 'bg-rose-500'
            }`}
          />
          <span className="text-sm text-slate-300 capitalize">
            {connectionState === ConnectionState.Connected
              ? hasRemoteAudio
                ? 'Audio Connected'
                : 'Connected (Waiting for other participant...)'
              : connectionState}
          </span>
        </div>
      </div>

      {/* Server-authoritative session timer */}
      {minutes !== null && (
        <p
          className="mt-3 text-sm font-mono text-slate-200"
          data-testid="session-timer"
          aria-live="off"
        >
          {minutes}:{String(seconds).padStart(2, '0')} remaining
        </p>
      )}

      {error && (
        <div className="mt-4 p-3 bg-rose-900/50 border border-rose-700 rounded-lg text-rose-200 text-xs text-center">
          {error.message}
        </div>
      )}

      {connectionLost && onReconnect && (
        <div className="mt-4 p-3 bg-amber-900/40 border border-amber-700 rounded-lg text-amber-200 text-xs text-center space-y-2">
          <p>The audio connection dropped. The session is still open.</p>
          <button
            type="button"
            onClick={onReconnect}
            className="rounded-lg bg-amber-500 px-3 py-1.5 text-xs font-semibold text-slate-900 hover:bg-amber-400"
          >
            Reconnect audio
          </button>
        </div>
      )}

      {/* Strict Privacy Invariant Banner */}
      <div className="my-6 p-3 bg-emerald-950/40 border border-emerald-800/60 rounded-xl text-xs text-emerald-300 text-center flex items-center space-x-2">
        <span>🔒 Zero Recording Guarantee: encrypted audio stream. No media or transcripts are ever stored.</span>
      </div>

      <div className="flex items-center space-x-4 mt-2">
        {onSafetyConcern && (
          <button
            type="button"
            onClick={onSafetyConcern}
            data-testid="safety-concern"
            className="px-4 py-4 rounded-full bg-amber-600 hover:bg-amber-500 text-white text-sm font-semibold transition-colors"
            aria-label="Raise a safety concern"
          >
            Safety concern
          </button>
        )}

        <button
          type="button"
          onClick={toggleMute}
          disabled={connectionState !== ConnectionState.Connected}
          className={`p-4 rounded-full transition-colors ${
            isMuted
              ? 'bg-rose-600 hover:bg-rose-700 text-white'
              : 'bg-slate-700 hover:bg-slate-600 text-white'
          }`}
          aria-label={isMuted ? 'Unmute microphone' : 'Mute microphone'}
        >
          {isMuted ? 'Unmute' : 'Mute'}
        </button>

        <button
          type="button"
          onClick={handleHangUp}
          className="p-4 bg-rose-600 hover:bg-rose-700 text-white rounded-full font-medium transition-colors"
          aria-label="End audio session"
        >
          End Call
        </button>
      </div>
    </div>
  );
}
