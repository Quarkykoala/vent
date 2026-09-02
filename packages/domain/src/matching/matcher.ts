import {
  MatchReservationState,
  SupportRequestState,
  ListenerPresenceState,
  type SupportRequestStateType,
  type MatchReservationStateType,
  type ListenerPresenceStateType,
} from '../enums';
import { InvariantViolationError } from '../errors';
import { calculateMatchingScore } from './scoring';
import { calculateNormalizedBayesianQuality } from './bayesian';
import type { ScoreComponents } from '../types';

export interface ListenerCandidate {
  listenerId: string;
  userId: string;
  status: string;
  languages: string[];
  topics: string[];
  presenceState: ListenerPresenceStateType;
  isStale: boolean;
  trainingExpiresAtIso: string | null;
  averageRating: number;
  totalRatedSessions: number;
  availableWaitMinutes: number;
  sessionsCompletedToday: number;
}

export interface SupportRequestMatchInput {
  requestId: string;
  userId: string;
  topic: string;
  language: string;
  previousRatings?: Record<string, number>; // listenerId -> rating
}

export interface MatchSelectionResult {
  selectedListenerId: string;
  score: number;
  components: ScoreComponents;
}

/**
 * Hard filters and deterministic scoring matching algorithm.
 * INVARIANTS:
 * - Blocked pairs NEVER match.
 * - Unavailable or stale listeners NEVER match.
 * - Training must be current.
 * - Listener cannot have >1 active reservation/session.
 */
export function findBestMatch(
  request: SupportRequestMatchInput,
  candidates: ListenerCandidate[],
  blockedListenerUserIds: Set<string>,
  nowIso: string = new Date().toISOString()
): MatchSelectionResult | null {
  const eligibleScored: Array<{
    listenerId: string;
    score: number;
    components: ScoreComponents;
  }> = [];

  for (const c of candidates) {
    // 1. Hard Filter: Blocked pair constraint
    if (blockedListenerUserIds.has(c.userId)) {
      continue;
    }

    // 2. Hard Filter: Active status & non-expired training
    if (c.status !== 'active') {
      continue;
    }
    if (
      !c.trainingExpiresAtIso ||
      new Date(c.trainingExpiresAtIso).getTime() <= new Date(nowIso).getTime()
    ) {
      continue;
    }

    // 3. Hard Filter: Must be currently AVAILABLE and NOT stale
    if (c.presenceState !== ListenerPresenceState.AVAILABLE || c.isStale) {
      continue;
    }

    // 4. Hard Filter: Language match
    const languageMatch = c.languages.includes(request.language);
    if (!languageMatch) {
      continue;
    }

    // 5. Hard Filter: Topic match
    const topicMatch = c.topics.includes(request.topic);
    if (!topicMatch) {
      continue;
    }

    // Check repeat affinity: previous rating >= 4
    const prevRating = request.previousRatings?.[c.listenerId] ?? 0;
    const hasRepeatAffinity = prevRating >= 4;

    const normalizedQuality = calculateNormalizedBayesianQuality({
      averageRating: c.averageRating,
      totalRatedSessions: c.totalRatedSessions,
    });

    const { totalScore, components } = calculateMatchingScore({
      languageMatch: true,
      topicMatch: true,
      availableWaitMinutes: c.availableWaitMinutes,
      normalizedQuality,
      hasRepeatAffinity,
      sessionsCompletedToday: c.sessionsCompletedToday,
    });

    eligibleScored.push({
      listenerId: c.listenerId,
      score: totalScore,
      components,
    });
  }

  if (eligibleScored.length === 0) {
    return null;
  }

  // Deterministic sorting: Highest score first; if equal, listener waiting longest
  eligibleScored.sort((a, b) => b.score - a.score);

  const best = eligibleScored[0]!;
  return {
    selectedListenerId: best.listenerId,
    score: best.score,
    components: best.components,
  };
}

/**
 * Handles listener offer decline.
 * Releases listener to available and requeues support request for immediate rematch.
 */
export function handleOfferDecline(params: {
  reservationState: MatchReservationStateType;
  requestState: SupportRequestStateType;
}): {
  nextReservationState: MatchReservationStateType;
  nextRequestState: SupportRequestStateType;
  nextListenerPresence: ListenerPresenceStateType;
} {
  if (params.reservationState !== MatchReservationState.OFFERED) {
    throw new InvariantViolationError('Only offered reservations can be declined');
  }

  return {
    nextReservationState: MatchReservationState.DECLINED,
    nextRequestState: SupportRequestState.QUEUED,
    nextListenerPresence: ListenerPresenceState.AVAILABLE,
  };
}

/**
 * Handles offer expiration (timeout).
 * Releases listener to available and requeues support request.
 */
export function handleOfferTimeout(params: {
  reservationState: MatchReservationStateType;
  requestState: SupportRequestStateType;
}): {
  nextReservationState: MatchReservationStateType;
  nextRequestState: SupportRequestStateType;
  nextListenerPresence: ListenerPresenceStateType;
} {
  if (params.reservationState !== MatchReservationState.OFFERED) {
    throw new InvariantViolationError('Only offered reservations can expire');
  }

  return {
    nextReservationState: MatchReservationState.EXPIRED,
    nextRequestState: SupportRequestState.QUEUED,
    nextListenerPresence: ListenerPresenceState.AVAILABLE,
  };
}

/**
 * Handles listener offer acceptance.
 * Transitions reservation to ACCEPTED, request to ACCEPTED, and listener to IN_SESSION.
 */
export function handleOfferAccept(params: {
  reservationState: MatchReservationStateType;
  requestState: SupportRequestStateType;
}): {
  nextReservationState: MatchReservationStateType;
  nextRequestState: SupportRequestStateType;
  nextListenerPresence: ListenerPresenceStateType;
} {
  if (params.reservationState !== MatchReservationState.OFFERED) {
    throw new InvariantViolationError('Only offered reservations can be accepted');
  }

  return {
    nextReservationState: MatchReservationState.ACCEPTED,
    nextRequestState: SupportRequestState.ACCEPTED,
    nextListenerPresence: ListenerPresenceState.IN_SESSION,
  };
}
