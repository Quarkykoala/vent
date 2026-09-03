'use client';

import React from 'react';
import { useLiveKitRoom } from './use-livekit-room';
import { ConnectionState } from 'livekit-client';

export interface AudioCallRoomProps {
  token: string;
  url: string;
  sessionTitle?: string;
  onEndCall: () => void;
}

export function AudioCallRoom({
  token,
  url,
  sessionTitle = 'Private Audio Session',
  onEndCall,
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
    onDisconnected: onEndCall,
  });

  const handleHangUp = () => {
    disconnect();
    onEndCall();
  };

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

      {error && (
        <div className="mt-4 p-3 bg-rose-900/50 border border-rose-700 rounded-lg text-rose-200 text-xs text-center">
          {error.message}
        </div>
      )}

      {/* Strict Privacy Invariant Banner */}
      <div className="my-6 p-3 bg-emerald-950/40 border border-emerald-800/60 rounded-xl text-xs text-emerald-300 text-center flex items-center space-x-2">
        <span>🔒 Zero Recording Guarantee: End-to-end encrypted audio stream. No media or transcripts are ever stored.</span>
      </div>

      <div className="flex items-center space-x-4 mt-2">
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
