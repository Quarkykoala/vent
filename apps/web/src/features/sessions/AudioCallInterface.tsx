'use client';

import React, { useState, useEffect } from 'react';

export interface AudioCallInterfaceProps {
  sessionId: string;
  roomName: string;
  participantAlias: string;
  role: 'user' | 'listener';
  durationMinutes?: number;
  onEndSession?: () => void;
  onOpenSafetyModal?: () => void;
}

export function AudioCallInterface({
  sessionId,
  roomName,
  participantAlias,
  role,
  durationMinutes = 20,
  onEndSession,
  onOpenSafetyModal,
}: AudioCallInterfaceProps) {
  const [isMuted, setIsMuted] = useState(false);
  const [secondsRemaining, setSecondsRemaining] = useState(durationMinutes * 60);
  const [connectionStatus, setConnectionStatus] = useState<'connecting' | 'connected' | 'reconnecting' | 'ended'>('connected');

  // Countdown timer
  useEffect(() => {
    if (connectionStatus !== 'connected' || secondsRemaining <= 0) return;
    const interval = setInterval(() => {
      setSecondsRemaining((prev) => Math.max(0, prev - 1));
    }, 1000);
    return () => clearInterval(interval);
  }, [connectionStatus, secondsRemaining]);

  const formatTimer = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  const handleToggleMute = () => {
    setIsMuted((prev) => !prev);
  };

  const handleReconnect = () => {
    setConnectionStatus('reconnecting');
    setTimeout(() => setConnectionStatus('connected'), 1200);
  };

  return (
    <div className="max-w-md mx-auto bg-slate-900 text-white rounded-3xl p-6 shadow-2xl border border-slate-800">
      {/* Top Bar: Room & Status */}
      <div className="flex items-center justify-between pb-4 border-b border-slate-800 text-xs">
        <div className="flex items-center gap-2">
          <span
            className={`h-2.5 w-2.5 rounded-full ${
              connectionStatus === 'connected'
                ? 'bg-emerald-400 animate-pulse'
                : connectionStatus === 'reconnecting'
                ? 'bg-amber-400 animate-spin'
                : 'bg-red-400'
            }`}
          />
          <span className="capitalize font-medium text-slate-300">{connectionStatus}</span>
        </div>
        <span className="text-slate-500 font-mono text-[11px]">{roomName}</span>
      </div>

      {/* Participant and Timer Display */}
      <div className="py-12 text-center">
        <div className="h-20 w-20 bg-emerald-950 text-emerald-400 rounded-full mx-auto flex items-center justify-center text-2xl font-bold border-2 border-emerald-500/30 mb-4">
          {role === 'listener' ? '🎧' : '🗣️'}
        </div>
        <p className="text-sm font-semibold text-slate-200">
          Connected as <span className="text-emerald-400 font-mono">{participantAlias}</span>
        </p>
        <p className="text-xs text-slate-400 mt-1">
          {role === 'listener' ? 'Listening anonymously to user' : 'Speaking anonymously to trained listener'}
        </p>

        <div className="mt-6 text-4xl font-extrabold tracking-wider font-mono text-emerald-400">
          {formatTimer(secondsRemaining)}
        </div>
        <p className="text-xs text-slate-500 mt-1">Session time remaining</p>
      </div>

      {/* Control Buttons */}
      <div className="flex items-center justify-center gap-4 pt-4 border-t border-slate-800">
        {/* Mute Button */}
        <button
          onClick={handleToggleMute}
          className={`p-3.5 rounded-full transition-all ${
            isMuted ? 'bg-amber-600 text-white' : 'bg-slate-800 hover:bg-slate-700 text-slate-200'
          }`}
          title={isMuted ? 'Unmute microphone' : 'Mute microphone'}
        >
          {isMuted ? '🔇 Unmute' : '🎙️ Mute'}
        </button>

        {/* Reconnect Button */}
        <button
          onClick={handleReconnect}
          className="p-3.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-full transition-all text-xs"
          title="Reconnect audio"
        >
          🔄 Reconnect
        </button>

        {/* End Call Button */}
        <button
          onClick={onEndSession}
          className="px-5 py-3 bg-red-600 hover:bg-red-700 text-white font-semibold rounded-full text-xs transition-all shadow-md active:scale-95"
        >
          📞 End Session
        </button>
      </div>

      {/* Safety Escalation Trigger */}
      <div className="mt-6 pt-3 border-t border-slate-800 text-center">
        <button
          onClick={onOpenSafetyModal}
          className="text-xs text-amber-400 hover:text-amber-300 font-semibold underline"
        >
          ⚠️ Report Safety Concern / Abuse
        </button>
      </div>
    </div>
  );
}
