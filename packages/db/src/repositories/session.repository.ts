import type { TypedSupabaseClient } from '../client';
import type { Database } from '../types';
import {
  SessionState,
  transitionSession,
  SupportRequestState,

  createSessionCompletionJournal,
  assertLedgerBalanced,
  DEFAULT_PRICING,
  type SessionStateType,
} from '@vent/domain';

export type SessionRow = Database['public']['Tables']['sessions']['Row'];
export type RatingRow = Database['public']['Tables']['ratings']['Row'];
export type BlockRow = Database['public']['Tables']['blocks']['Row'];

export class SessionRepository {
  constructor(private client: TypedSupabaseClient) {}

  async createSession(params: {
    requestId: string;
    userId: string;
    listenerId: string;
    roomName: string;
  }): Promise<SessionRow> {
    const rawClient = this.client as any;
    const now = new Date().toISOString();

    const { data, error } = await rawClient
      .from('sessions')
      .insert({
        request_id: params.requestId,
        user_id: params.userId,
        listener_id: params.listenerId,
        room_name: params.roomName,
        state: SessionState.CREATED,
        started_at: now,
      })
      .select()
      .single();

    if (error || !data) {
      throw new Error(`Failed to create session: ${error?.message}`);
    }

    return data as SessionRow;
  }

  async getSession(sessionId: string): Promise<SessionRow | null> {
    const { data, error } = await this.client
      .from('sessions')
      .select('*')
      .eq('id', sessionId)
      .maybeSingle();

    if (error) {
      throw new Error(`Failed to lookup session: ${error.message}`);
    }

    return (data as unknown as SessionRow) ?? null;
  }

  async endSession(params: {
    sessionId: string;
    endReason: string;
  }): Promise<{ durationSeconds: number; nextState: SessionStateType }> {
    const session = await this.getSession(params.sessionId);
    if (!session) {
      throw new Error('Session not found');
    }

    const nextState = transitionSession({
      sessionId: params.sessionId,
      currentState: session.state as SessionStateType,
      nextState: SessionState.ENDED,
    });

    const now = new Date();
    const startTime = session.started_at ? new Date(session.started_at) : now;
    const durationSeconds = Math.max(0, Math.floor((now.getTime() - startTime.getTime()) / 1000));

    const rawClient = this.client as any;

    // 1. Update session row
    await rawClient
      .from('sessions')
      .update({
        state: nextState,
        ended_at: now.toISOString(),
        duration_seconds: durationSeconds,
        end_reason: params.endReason,
      })
      .eq('id', params.sessionId);

    // 2. Transition support request to COMPLETED
    await rawClient
      .from('support_requests')
      .update({ state: SupportRequestState.COMPLETED })
      .eq('id', session.request_id);

    // 3. Post balanced listener earnings to ledger
    const eventId = crypto.randomUUID();
    const journal = createSessionCompletionJournal({
      eventId,
      sessionId: session.id,
      listenerEarningsPaise: DEFAULT_PRICING.listenerEarningsPaise,
    });

    assertLedgerBalanced(journal);

    const ledgerRows = journal.map((e) => ({
      event_id: e.event_id,
      account_code: e.account_code,
      direction: e.direction,
      amount_paise: Number(e.amount_paise),
      currency: e.currency,
      reference_type: e.reference_type,
      reference_id: e.reference_id,
      created_at: now.toISOString(),
    }));

    await rawClient.from('ledger_entries').insert(ledgerRows);

    return { durationSeconds, nextState };
  }

  async submitRating(params: {
    sessionId: string;
    userId: string;
    listenerId: string;
    stars: number;
    reasonTags?: string[];
  }): Promise<RatingRow> {
    const rawClient = this.client as any;

    const { data, error } = await rawClient
      .from('ratings')
      .insert({
        session_id: params.sessionId,
        user_id: params.userId,
        listener_id: params.listenerId,
        stars: params.stars,
        reason_tags: params.reasonTags || [],
        created_at: new Date().toISOString(),
      })
      .select()
      .single();

    if (error || !data) {
      throw new Error(`Failed to submit rating (one rating per session enforced): ${error?.message}`);
    }

    return data as RatingRow;
  }

  async createBlock(blockerId: string, blockedId: string, reasonCode?: string): Promise<void> {
    const rawClient = this.client as any;
    const { error } = await rawClient.from('blocks').insert({
      blocker_id: blockerId,
      blocked_id: blockedId,
      reason_code: reasonCode || null,
      created_at: new Date().toISOString(),
    });

    if (error) {
      throw new Error(`Failed to create block: ${error.message}`);
    }
  }

  async isPairBlocked(userAId: string, userBId: string): Promise<boolean> {
    const { data, error } = await this.client
      .from('blocks')
      .select('blocker_id')
      .or(`and(blocker_id.eq.${userAId},blocked_id.eq.${userBId}),and(blocker_id.eq.${userBId},blocked_id.eq.${userAId})`)
      .limit(1);

    if (error || !data || data.length === 0) {
      return false;
    }

    return true;
  }
}
