import { describe, it, expect } from 'vitest';
import {
  isHeartbeatStale,
  reconcileStalePresence,
  isListenerEligibleForMatching,
  ListenerPresenceState,
  type ListenerPresence,
} from '../src/index';

describe('Phase 2 — Listener Onboarding & Presence Invariants', () => {
  const baseTime = new Date('2026-09-02T12:00:00.000Z');

  describe('isHeartbeatStale', () => {
    it('returns false for fresh heartbeat (< 30 seconds old)', () => {
      const freshHeartbeat = new Date('2026-09-02T11:59:45.000Z').toISOString(); // 15s ago
      expect(isHeartbeatStale(freshHeartbeat, baseTime.toISOString(), 30)).toBe(false);
    });

    it('returns true for stale heartbeat (> 30 seconds old)', () => {
      const staleHeartbeat = new Date('2026-09-02T11:59:15.000Z').toISOString(); // 45s ago
      expect(isHeartbeatStale(staleHeartbeat, baseTime.toISOString(), 30)).toBe(true);
    });
  });

  describe('reconcileStalePresence (Sweeper Invariant)', () => {
    it('automatically transitions a stale AVAILABLE listener to OFFLINE', () => {
      const staleAvailablePresence: ListenerPresence = {
        listener_id: 'list-1',
        state: ListenerPresenceState.AVAILABLE,
        heartbeat_at: new Date('2026-09-02T11:59:00.000Z').toISOString(), // 60s ago
        available_since: new Date('2026-09-02T11:30:00.000Z').toISOString(),
        current_reservation_id: null,
        version: 1,
      };

      const result = reconcileStalePresence(staleAvailablePresence, baseTime.toISOString(), 30);
      expect(result.changed).toBe(true);
      expect(result.updatedState).toBe(ListenerPresenceState.OFFLINE);
    });

    it('CRITICAL INVARIANT: NEVER terminates or marks offline a listener in IN_SESSION even if heartbeat is stale', () => {
      const staleInSessionPresence: ListenerPresence = {
        listener_id: 'list-active-call',
        state: ListenerPresenceState.IN_SESSION,
        heartbeat_at: new Date('2026-09-02T11:58:00.000Z').toISOString(), // 2 mins ago
        available_since: null,
        current_reservation_id: 'res-99',
        version: 2,
      };

      const result = reconcileStalePresence(staleInSessionPresence, baseTime.toISOString(), 30);
      expect(result.changed).toBe(false);
      expect(result.updatedState).toBe(ListenerPresenceState.IN_SESSION);
    });

    it('NEVER marks offline a RESERVED listener during pending match acceptance', () => {
      const staleReservedPresence: ListenerPresence = {
        listener_id: 'list-reserved',
        state: ListenerPresenceState.RESERVED,
        heartbeat_at: new Date('2026-09-02T11:58:30.000Z').toISOString(),
        available_since: null,
        current_reservation_id: 'res-88',
        version: 3,
      };

      const result = reconcileStalePresence(staleReservedPresence, baseTime.toISOString(), 30);
      expect(result.changed).toBe(false);
      expect(result.updatedState).toBe(ListenerPresenceState.RESERVED);
    });
  });

  describe('isListenerEligibleForMatching', () => {
    it('considers an active, freshly beating listener with valid training eligible', () => {
      const eligible = isListenerEligibleForMatching({
        status: 'active',
        trainingExpiresAtIso: '2026-12-31T23:59:59.000Z',
        presenceState: ListenerPresenceState.AVAILABLE,
        heartbeatAtIso: new Date('2026-09-02T11:59:50.000Z').toISOString(),
        nowIso: baseTime.toISOString(),
      });
      expect(eligible).toBe(true);
    });

    it('rejects listeners with expired training', () => {
      const expired = isListenerEligibleForMatching({
        status: 'active',
        trainingExpiresAtIso: '2026-08-01T00:00:00.000Z', // Expired last month
        presenceState: ListenerPresenceState.AVAILABLE,
        heartbeatAtIso: new Date('2026-09-02T11:59:50.000Z').toISOString(),
        nowIso: baseTime.toISOString(),
      });
      expect(expired).toBe(false);
    });

    it('rejects listeners with paused or suspended status', () => {
      const suspended = isListenerEligibleForMatching({
        status: 'suspended',
        trainingExpiresAtIso: '2026-12-31T23:59:59.000Z',
        presenceState: ListenerPresenceState.AVAILABLE,
        heartbeatAtIso: new Date('2026-09-02T11:59:50.000Z').toISOString(),
        nowIso: baseTime.toISOString(),
      });
      expect(suspended).toBe(false);
    });
  });
});
