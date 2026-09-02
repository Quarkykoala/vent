import { describe, it, expect } from 'vitest';
import {
  findBestMatch,
  handleOfferDecline,
  handleOfferTimeout,
  handleOfferAccept,
  MatchReservationState,
  SupportRequestState,
  ListenerPresenceState,
  type ListenerCandidate,
} from '../src/index';

describe('Phase 4 — Matching Engine Invariants & Transitions', () => {
  const baseTime = new Date('2026-09-02T12:00:00.000Z');

  const mockCandidateA: ListenerCandidate = {
    listenerId: 'listener-a',
    userId: 'user-listener-a',
    status: 'active',
    languages: ['Hindi', 'English'],
    topics: ['Relationship Conflict', 'Loneliness'],
    presenceState: ListenerPresenceState.AVAILABLE,
    isStale: false,
    trainingExpiresAtIso: '2026-12-31T23:59:59.000Z',
    averageRating: 4.8,
    totalRatedSessions: 50,
    availableWaitMinutes: 20,
    sessionsCompletedToday: 2,
  };

  const mockCandidateB: ListenerCandidate = {
    listenerId: 'listener-b',
    userId: 'user-listener-b',
    status: 'active',
    languages: ['Hindi', 'English'],
    topics: ['Relationship Conflict'],
    presenceState: ListenerPresenceState.AVAILABLE,
    isStale: false,
    trainingExpiresAtIso: '2026-12-31T23:59:59.000Z',
    averageRating: 4.5,
    totalRatedSessions: 10,
    availableWaitMinutes: 5,
    sessionsCompletedToday: 0,
  };

  it('selects the highest scoring compatible listener deterministically', () => {
    const match = findBestMatch(
      {
        requestId: 'req-1',
        userId: 'user-client-1',
        topic: 'Relationship Conflict',
        language: 'Hindi',
      },
      [mockCandidateA, mockCandidateB],
      new Set(), // No blocks
      baseTime.toISOString()
    );

    expect(match).not.toBeNull();
    expect(match?.selectedListenerId).toBe('listener-a'); // Higher quality & longer wait
    expect(match?.score).toBeGreaterThan(0.7);
  });

  it('CRITICAL INVARIANT: Never matches a blocked pair', () => {
    const blockedUserIds = new Set(['user-listener-a']); // Client blocked listener-a

    const match = findBestMatch(
      {
        requestId: 'req-2',
        userId: 'user-client-1',
        topic: 'Relationship Conflict',
        language: 'Hindi',
      },
      [mockCandidateA, mockCandidateB],
      blockedUserIds,
      baseTime.toISOString()
    );

    expect(match).not.toBeNull();
    // Must bypass listener-a and select listener-b
    expect(match?.selectedListenerId).toBe('listener-b');
  });

  it('never matches an unavailable or stale listener', () => {
    const staleCandidate: ListenerCandidate = {
      ...mockCandidateA,
      isStale: true, // Stale heartbeat
    };

    const match = findBestMatch(
      {
        requestId: 'req-3',
        userId: 'user-client-1',
        topic: 'Relationship Conflict',
        language: 'Hindi',
      },
      [staleCandidate],
      new Set(),
      baseTime.toISOString()
    );

    expect(match).toBeNull();
  });

  it('handles offer decline by requeuing request and releasing listener to available', () => {
    const outcome = handleOfferDecline({
      reservationState: MatchReservationState.OFFERED,
      requestState: SupportRequestState.RESERVED,
    });

    expect(outcome.nextReservationState).toBe(MatchReservationState.DECLINED);
    expect(outcome.nextRequestState).toBe(SupportRequestState.QUEUED);
    expect(outcome.nextListenerPresence).toBe(ListenerPresenceState.AVAILABLE);
  });

  it('handles offer timeout by requeuing request and releasing listener to available', () => {
    const outcome = handleOfferTimeout({
      reservationState: MatchReservationState.OFFERED,
      requestState: SupportRequestState.RESERVED,
    });

    expect(outcome.nextReservationState).toBe(MatchReservationState.EXPIRED);
    expect(outcome.nextRequestState).toBe(SupportRequestState.QUEUED);
    expect(outcome.nextListenerPresence).toBe(ListenerPresenceState.AVAILABLE);
  });

  it('handles offer accept by transitioning request to accepted and listener to in_session', () => {
    const outcome = handleOfferAccept({
      reservationState: MatchReservationState.OFFERED,
      requestState: SupportRequestState.RESERVED,
    });

    expect(outcome.nextReservationState).toBe(MatchReservationState.ACCEPTED);
    expect(outcome.nextRequestState).toBe(SupportRequestState.ACCEPTED);
    expect(outcome.nextListenerPresence).toBe(ListenerPresenceState.IN_SESSION);
  });
});
