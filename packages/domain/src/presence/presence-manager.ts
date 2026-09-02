import { ListenerPresenceState, type ListenerPresenceStateType } from '../enums';
import type { ListenerPresence } from '../types';

export const HEARTBEAT_TTL_SECONDS = 30;

/**
 * Checks whether a listener heartbeat timestamp is older than the configured TTL.
 */
export function isHeartbeatStale(
  heartbeatAtIso: string,
  nowIso: string = new Date().toISOString(),
  ttlSeconds = HEARTBEAT_TTL_SECONDS
): boolean {
  const heartbeatTime = new Date(heartbeatAtIso).getTime();
  const currentTime = new Date(nowIso).getTime();
  const diffSeconds = (currentTime - heartbeatTime) / 1000;
  return diffSeconds > ttlSeconds;
}

/**
 * Reconciles listener presence state against heartbeat freshness.
 * CRITICAL INVARIANT:
 * - If a listener is 'available' and their heartbeat is stale, mark them 'offline'.
 * - If a listener is 'in_session' or 'reserved', NEVER terminate or mark them offline solely
 *   from presence heartbeat. Active sessions must remain safe from transient network drops.
 */
export function reconcileStalePresence(
  presence: ListenerPresence,
  nowIso: string = new Date().toISOString(),
  ttlSeconds = HEARTBEAT_TTL_SECONDS
): { updatedState: ListenerPresenceStateType; changed: boolean } {
  const stale = isHeartbeatStale(presence.heartbeat_at, nowIso, ttlSeconds);

  if (stale && presence.state === ListenerPresenceState.AVAILABLE) {
    return {
      updatedState: ListenerPresenceState.OFFLINE,
      changed: true,
    };
  }

  // Active session and reserved states are strictly protected from presence sweeper
  return {
    updatedState: presence.state,
    changed: false,
  };
}

/**
 * Validates that a listener is clinically and operationally eligible to take requests.
 */
export function isListenerEligibleForMatching(params: {
  status: string;
  trainingExpiresAtIso: string | null;
  presenceState: ListenerPresenceStateType;
  heartbeatAtIso: string;
  nowIso?: string;
}): boolean {
  const now = params.nowIso || new Date().toISOString();

  if (params.status !== 'active') {
    return false;
  }

  // Training validity check
  if (
    !params.trainingExpiresAtIso ||
    new Date(params.trainingExpiresAtIso).getTime() <= new Date(now).getTime()
  ) {
    return false;
  }

  // Presence state check
  if (params.presenceState !== ListenerPresenceState.AVAILABLE) {
    return false;
  }

  // Freshness check
  if (isHeartbeatStale(params.heartbeatAtIso, now)) {
    return false;
  }

  return true;
}
