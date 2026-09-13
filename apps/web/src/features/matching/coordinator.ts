import {
  findBestMatch,
  SupportRequestState,
  MatchReservationState,
  ListenerPresenceState,
  type ListenerCandidate,
} from '@vent/domain';
import {
  MatchingRepository,
  SupportRequestRepository,
  type TypedSupabaseClient,
} from '@vent/db';

export type MatchAttemptStatus =
  | 'reserved'
  | 'offer_pending'
  | 'no_candidates'
  | 'not_queued'
  | 'not_entitled';

export interface MatchAttemptResult {
  status: MatchAttemptStatus;
  requestId: string;
  message?: string;
  reservationId?: string;
  listenerId?: string;
  expiresAt?: string;
  score?: number;
}

interface ActiveReservationRow {
  id: string;
  listener_id: string;
  state: string;
  expires_at: string;
}

const HEARTBEAT_STALE_MS = 30_000;

/**
 * Queue coordinator: the real caller of the deterministic matcher and the
 * atomic reservation transaction.
 *
 * Entitlement invariant: only requests that carry a captured payment link and
 * sit in `queued` (or in `reserved` behind an expired offer) are matchable.
 *
 * Timeout strategy: expiry is enforced lazily here on every attempt (an offer
 * past its TTL is expired and the request requeued before rematching), and
 * eagerly through the operations reservation-expiry entrypoint. Both paths use
 * the same atomic RPC, so retries and restarts are idempotent.
 */
export class MatchingCoordinator {
  constructor(private adminClient: TypedSupabaseClient) {}

  async attemptMatch(
    requestId: string,
    opts: { expiresInSeconds?: number } = {}
  ): Promise<MatchAttemptResult> {
    const supportRepo = new SupportRequestRepository(this.adminClient);
    const request = await supportRepo.findById(requestId);
    if (!request) {
      return { status: 'not_queued', requestId, message: 'Support request not found' };
    }

    // Entitlement (R4): the linked payment must exist, be captured, belong to
    // the request's user, and be bound to this request. A non-null link alone
    // proves nothing.
    if (!request.payment_order_id) {
      return {
        status: 'not_entitled',
        requestId,
        message: 'Request has no captured payment entitlement',
      };
    }
    const entitlement = await this.verifyPaymentEntitlement(request);
    if (!entitlement.ok) {
      return {
        status: 'not_entitled',
        requestId,
        message: entitlement.message,
      };
    }

    if (request.state === SupportRequestState.RESERVED) {
      // Lazy timeout: release an expired offer before attempting a rematch.
      const active = await this.findActiveReservation(requestId);
      if (active && active.state === MatchReservationState.OFFERED) {
        const isExpired = new Date(active.expires_at).getTime() <= Date.now();
        if (isExpired) {
          const matchingRepo = new MatchingRepository(this.adminClient);
          await matchingRepo.expireReservation(active.id);
          return this.attemptMatch(requestId, opts);
        }
        return {
          status: 'offer_pending',
          requestId,
          reservationId: active.id,
          listenerId: active.listener_id,
          expiresAt: active.expires_at,
          message: 'Offer still pending with listener',
        };
      }
      return {
        status: 'not_queued',
        requestId,
        message: `Request is not matchable in state: ${request.state}`,
      };
    }

    if (request.state !== SupportRequestState.QUEUED) {
      return {
        status: 'not_queued',
        requestId,
        message: `Request is not matchable in state: ${request.state}`,
      };
    }

    const candidates = await this.loadCandidates();
    const blocked = await this.loadBlockedListenerUserIds(request.user_id);
    const previousRatings = await this.loadPreviousRatings(request.user_id);

    const selection = findBestMatch(
      {
        requestId: request.id,
        userId: request.user_id,
        topic: request.topic,
        language: request.language,
        previousRatings,
      },
      candidates,
      blocked
    );

    if (!selection) {
      return {
        status: 'no_candidates',
        requestId,
        message: 'No eligible listener currently available',
      };
    }

    const matchingRepo = new MatchingRepository(this.adminClient);
    const reservation = await matchingRepo.createReservation({
      requestId: request.id,
      listenerId: selection.selectedListenerId,
      score: selection.score,
      scoreComponents: selection.components,
      expiresInSeconds: opts.expiresInSeconds ?? 45,
    });

    return {
      status: 'reserved',
      requestId: request.id,
      reservationId: reservation.id,
      listenerId: reservation.listener_id,
      expiresAt: reservation.expires_at,
      score: selection.score,
    };
  }

  /**
   * Operations entrypoint body: idempotent expiry check used by the scheduler
   * and by staff. Safe to call repeatedly; only an offered reservation past
   * its TTL is transitioned.
   */
  async expireIfDue(reservationId: string): Promise<{ handled: boolean; action: 'expired' | 'already_settled' }> {
    const matchingRepo = new MatchingRepository(this.adminClient);
    const reservation = await matchingRepo.getReservation(reservationId);
    if (!reservation) {
      return { handled: false, action: 'already_settled' };
    }
    if (reservation.state !== MatchReservationState.OFFERED) {
      return { handled: false, action: 'already_settled' };
    }
    if (new Date(reservation.expires_at).getTime() > Date.now()) {
      return { handled: false, action: 'already_settled' };
    }
    await matchingRepo.expireReservation(reservationId);
    return { handled: true, action: 'expired' };
  }

  private async verifyPaymentEntitlement(request: {
    id: string;
    user_id: string;
    payment_order_id: string | null;
  }): Promise<{ ok: boolean; message?: string }> {
    const { data, error } = await (this.adminClient as any)
      .from('payments')
      .select('id, user_id, state')
      .eq('id', request.payment_order_id)
      .maybeSingle();
    if (error) {
      throw new Error(`Failed to verify payment entitlement: ${error.message}`);
    }
    if (!data) {
      return { ok: false, message: 'Linked payment record not found' };
    }
    if ((data as { user_id: string }).user_id !== request.user_id) {
      return { ok: false, message: 'Linked payment belongs to a different user' };
    }
    if ((data as { state: string }).state !== 'captured') {
      return {
        ok: false,
        message: `Linked payment is not captured (state: ${(data as { state: string }).state})`,
      };
    }
    return { ok: true };
  }

  private async findActiveReservation(requestId: string): Promise<ActiveReservationRow | null> {
    const { data, error } = await (this.adminClient as any)
      .from('match_reservations')
      .select('*')
      .eq('request_id', requestId)
      .in('state', [MatchReservationState.OFFERED, MatchReservationState.ACCEPTED])
      .order('offered_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) {
      throw new Error(`Failed to load active reservation: ${error.message}`);
    }
    return (data as unknown as ActiveReservationRow) ?? null;
  }

  private async loadCandidates(): Promise<ListenerCandidate[]> {
    const raw = this.adminClient as any;
    const now = Date.now();

    const { data: profileRows, error: profileErr } = await raw
      .from('listener_profiles')
      .select(
        'id, user_id, status, languages, topics, training_expires_at, listener_presence ( state, heartbeat_at, available_since )'
      )
      .eq('status', 'active');
    if (profileErr) {
      throw new Error(`Failed to load listener candidates: ${profileErr.message}`);
    }

    const { data: ratingRows, error: ratingErr } = await raw
      .from('ratings')
      .select('listener_id, stars');
    if (ratingErr) {
      throw new Error(`Failed to load ratings for scoring: ${ratingErr.message}`);
    }

    const startOfDayIso = new Date(new Date().setHours(0, 0, 0, 0)).toISOString();
    const { data: sessionRows, error: sessionErr } = await raw
      .from('sessions')
      .select('listener_id')
      .in('state', ['ended', 'safety_ended'])
      .gte('started_at', startOfDayIso);
    if (sessionErr) {
      throw new Error(`Failed to load session counts for scoring: ${sessionErr.message}`);
    }

    const ratingsByListener = new Map<string, { sum: number; count: number }>();
    for (const r of (ratingRows ?? []) as Array<{ listener_id: string; stars: number }>) {
      const agg = ratingsByListener.get(r.listener_id) ?? { sum: 0, count: 0 };
      agg.sum += r.stars;
      agg.count += 1;
      ratingsByListener.set(r.listener_id, agg);
    }
    const sessionsToday = new Map<string, number>();
    for (const s of (sessionRows ?? []) as Array<{ listener_id: string }>) {
      sessionsToday.set(s.listener_id, (sessionsToday.get(s.listener_id) ?? 0) + 1);
    }

    const candidates: ListenerCandidate[] = [];
    for (const row of (profileRows ?? []) as Array<Record<string, any>>) {
      const presence = Array.isArray(row.listener_presence)
        ? row.listener_presence[0]
        : row.listener_presence;
      candidates.push({
        listenerId: row.id,
        userId: row.user_id,
        status: row.status,
        languages: row.languages ?? [],
        topics: row.topics ?? [],
        presenceState: (presence?.state ?? ListenerPresenceState.OFFLINE) as ListenerCandidate['presenceState'],
        isStale: !presence?.heartbeat_at || new Date(presence.heartbeat_at).getTime() < now - HEARTBEAT_STALE_MS,
        trainingExpiresAtIso: row.training_expires_at ?? null,
        averageRating: ratingsByListener.has(row.id)
          ? ratingsByListener.get(row.id)!.sum / ratingsByListener.get(row.id)!.count
          : 0,
        totalRatedSessions: ratingsByListener.get(row.id)?.count ?? 0,
        availableWaitMinutes: presence?.available_since
          ? Math.max(0, (now - new Date(presence.available_since).getTime()) / 60_000)
          : 0,
        sessionsCompletedToday: sessionsToday.get(row.id) ?? 0,
      });
    }

    return candidates;
  }

  private async loadBlockedListenerUserIds(requestUserId: string): Promise<Set<string>> {
    const blocked = new Set<string>();
    const { data, error } = await (this.adminClient as any)
      .from('blocks')
      .select('blocker_id, blocked_id')
      .or(`blocker_id.eq.${requestUserId},blocked_id.eq.${requestUserId}`);
    if (error) {
      throw new Error(`Failed to load blocks for matching: ${error.message}`);
    }
    for (const b of (data ?? []) as Array<{ blocker_id: string; blocked_id: string }>) {
      // Either direction blocks the pair; the matcher filters by listener user id.
      if (b.blocker_id === requestUserId) blocked.add(b.blocked_id);
      else blocked.add(b.blocker_id);
    }
    return blocked;
  }

  private async loadPreviousRatings(requestUserId: string): Promise<Record<string, number>> {
    const { data, error } = await (this.adminClient as any)
      .from('ratings')
      .select('listener_id, stars')
      .eq('user_id', requestUserId);
    if (error) {
      throw new Error(`Failed to load previous ratings: ${error.message}`);
    }
    const map: Record<string, number> = {};
    for (const r of (data ?? []) as Array<{ listener_id: string; stars: number }>) {
      map[r.listener_id] = r.stars;
    }
    return map;
  }
}
