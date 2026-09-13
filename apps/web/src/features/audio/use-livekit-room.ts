'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import {
  Room,
  RoomEvent,
  Track,
  ConnectionState,
  type RemoteTrackPublication,
  type RemoteParticipant,
} from 'livekit-client';

export interface UseLiveKitRoomOptions {
  token?: string;
  url?: string;
  autoConnect?: boolean;
  onDisconnected?: () => void;
  onError?: (err: Error) => void;
}

export function useLiveKitRoom(options: UseLiveKitRoomOptions = {}) {
  const [connectionState, setConnectionState] = useState<ConnectionState>(ConnectionState.Disconnected);
  const [isMuted, setIsMuted] = useState(false);
  const [hasRemoteAudio, setHasRemoteAudio] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const roomRef = useRef<Room | null>(null);
  const audioElementRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    const room = new Room({
      adaptiveStream: true,
      dynacast: true,
      audioCaptureDefaults: {
        autoGainControl: true,
        echoCancellation: true,
        noiseSuppression: true,
      },
    });

    roomRef.current = room;

    room.on(RoomEvent.ConnectionStateChanged, (state: ConnectionState) => {
      setConnectionState(state);
    });

    room.on(
      RoomEvent.TrackSubscribed,
      (track: Track, _pub: RemoteTrackPublication, _participant: RemoteParticipant) => {
        if (track.kind === Track.Kind.Audio) {
          if (!audioElementRef.current && typeof document !== 'undefined') {
            const el = document.createElement('audio');
            el.autoplay = true;
            audioElementRef.current = el;
          }
          if (audioElementRef.current) {
            track.attach(audioElementRef.current);
          }
          setHasRemoteAudio(true);
        }
      }
    );

    room.on(RoomEvent.TrackUnsubscribed, (track: Track) => {
      if (track.kind === Track.Kind.Audio) {
        track.detach();
        setHasRemoteAudio(false);
      }
    });

    room.on(RoomEvent.Disconnected, () => {
      setConnectionState(ConnectionState.Disconnected);
      setHasRemoteAudio(false);
      options.onDisconnected?.();
    });

    if (options.autoConnect && options.token && options.url) {
      room.connect(options.url, options.token).then(async () => {
        await room.localParticipant.setMicrophoneEnabled(true);
        setIsMuted(false);
      }).catch((err) => {
        const errorObj = err instanceof Error ? err : new Error(String(err));
        setError(errorObj);
        options.onError?.(errorObj);
      });
    }

    return () => {
      room.disconnect();
      if (audioElementRef.current) {
        audioElementRef.current.remove();
        audioElementRef.current = null;
      }
    };
  }, []);

  const connect = useCallback(async (token: string, url: string) => {
    if (!roomRef.current) return;
    try {
      setError(null);
      await roomRef.current.connect(url, token);
      await roomRef.current.localParticipant.setMicrophoneEnabled(true);
      setIsMuted(false);
    } catch (err: any) {
      const errorObj = err instanceof Error ? err : new Error(String(err));
      setError(errorObj);
      options.onError?.(errorObj);
    }
  }, [options]);

  const disconnect = useCallback(() => {
    roomRef.current?.disconnect();
  }, []);

  const toggleMute = useCallback(async () => {
    if (!roomRef.current) return;
    const currentEnabled = roomRef.current.localParticipant.isMicrophoneEnabled;
    await roomRef.current.localParticipant.setMicrophoneEnabled(!currentEnabled);
    setIsMuted(currentEnabled);
  }, []);

  return {
    connectionState,
    isMuted,
    hasRemoteAudio,
    error,
    connect,
    disconnect,
    toggleMute,
    room: roomRef.current,
  };
}
