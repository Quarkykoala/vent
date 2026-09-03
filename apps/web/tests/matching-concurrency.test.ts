import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { MatchingRepository } from '@vent/db';
import type { ScoreComponents } from '@vent/domain';
import { getSupabaseAdmin } from '../src/lib/supabase-server';

describe('Package 3 — Database Invariants and Matching Concurrency', () => {
  const admin = getSupabaseAdmin();
  const matchingRepo = new MatchingRepository(admin);

  const mockScoreComponents: ScoreComponents = {
    languageScore: 1.0,
    topicScore: 1.0,
    waitFairness: 0.5,
    bayesianQuality: 4.5,
    repeatAffinity: 0,
    loadBalance: 1.0,
  };

  let userAId: string;
  let userBId: string;
  let listener1Id: string;
  let listener2Id: string;
  let listener1UserId: string;
  let listener2UserId: string;

  beforeAll(async () => {
    // 1. Create two test users
    const { data: uA } = await admin
      .from('users')
      .insert({
        auth_user_id: crypto.randomUUID(),
        handle: 'MatchUserA101',
        age_verified_at: new Date().toISOString(),
        status: 'active',
      } as any)
      .select()
      .single();
    userAId = (uA as any).id;

    const { data: uB } = await admin
      .from('users')
      .insert({
        auth_user_id: crypto.randomUUID(),
        handle: 'MatchUserB102',
        age_verified_at: new Date().toISOString(),
        status: 'active',
      } as any)
      .select()
      .single();
    userBId = (uB as any).id;

    // 2. Create two listener users and profiles
    const { data: lu1 } = await admin
      .from('users')
      .insert({
        auth_user_id: crypto.randomUUID(),
        handle: 'ListenerUser101',
        age_verified_at: new Date().toISOString(),
        status: 'active',
      } as any)
      .select()
      .single();
    listener1UserId = (lu1 as any).id;

    const { data: lp1 } = await admin
      .from('listener_profiles')
      .insert({
        user_id: listener1UserId,
        display_name: 'Listener One',
        status: 'active',
        tier: 'listener',
        languages: ['English', 'Hindi'],
        topics: ['work_stress', 'anxiety'],
        quality_prior: 4.5,
      } as any)
      .select()
      .single();
    listener1Id = (lp1 as any).id;

    const { data: lu2 } = await admin
      .from('users')
      .insert({
        auth_user_id: crypto.randomUUID(),
        handle: 'ListenerUser102',
        age_verified_at: new Date().toISOString(),
        status: 'active',
      } as any)
      .select()
      .single();
    listener2UserId = (lu2 as any).id;

    const { data: lp2 } = await admin
      .from('listener_profiles')
      .insert({
        user_id: listener2UserId,
        display_name: 'Listener Two',
        status: 'active',
        tier: 'listener',
        languages: ['English', 'Hindi'],
        topics: ['work_stress', 'anxiety'],
        quality_prior: 4.5,
      } as any)
      .select()
      .single();
    listener2Id = (lp2 as any).id;

    // 3. Initialize presence for both listeners
    await (admin.from('listener_presence') as any).upsert([
      {
        listener_id: listener1Id,
        state: 'available',
        heartbeat_at: new Date().toISOString(),
      },
      {
        listener_id: listener2Id,
        state: 'available',
        heartbeat_at: new Date().toISOString(),
      },
    ]);
  });

  afterAll(async () => {
    // Cleanup
    await admin.from('users').delete().in('id', [userAId, userBId, listener1UserId, listener2UserId]);
  });

  it('two concurrent requests racing for one listener: exactly one wins, one remains queued', async () => {
    // Reset listener 1 presence to available with fresh heartbeat
    await (admin.from('listener_presence') as any).update({
      state: 'available',
      heartbeat_at: new Date().toISOString(),
      current_reservation_id: null,
    }).eq('listener_id', listener1Id);

    // Create two queued support requests
    const { data: req1 } = await admin.from('support_requests').insert({
      user_id: userAId,
      topic: 'work_stress',
      language: 'English',
      service_tier: 'listener',
      state: 'queued',
      idempotency_key: `race_req_1_${Date.now()}`,
    } as any).select().single();

    const { data: req2 } = await admin.from('support_requests').insert({
      user_id: userBId,
      topic: 'work_stress',
      language: 'English',
      service_tier: 'listener',
      state: 'queued',
      idempotency_key: `race_req_2_${Date.now()}`,
    } as any).select().single();

    const req1Id = (req1 as any).id;
    const req2Id = (req2 as any).id;

    // Concurrently attempt to reserve listener 1 for both requests
    const results = await Promise.allSettled([
      matchingRepo.createReservation({
        requestId: req1Id,
        listenerId: listener1Id,
        score: 0.9,
        scoreComponents: mockScoreComponents,
      }),
      matchingRepo.createReservation({
        requestId: req2Id,
        listenerId: listener1Id,
        score: 0.85,
        scoreComponents: mockScoreComponents,
      }),
    ]);

    const successes = results.filter(r => r.status === 'fulfilled');
    const failures = results.filter(r => r.status === 'rejected');

    // INVARIANT: Exactly one reservation succeeds!
    expect(successes).toHaveLength(1);
    expect(failures).toHaveLength(1);

    // Verify database state: one request is reserved, other is still queued
    const { data: r1 } = await admin.from('support_requests').select('state').eq('id', req1Id).single();
    const { data: r2 } = await admin.from('support_requests').select('state').eq('id', req2Id).single();

    const states = [(r1 as any).state, (r2 as any).state];
    expect(states).toContain('reserved');
    expect(states).toContain('queued');

    // Clean up active reservation for subsequent tests
    const winningRes = (successes[0] as PromiseFulfilledResult<any>).value;
    await matchingRepo.declineReservation(winningRes.id, listener1Id);
  });

  it('one request racing across multiple listeners: exactly one reservation created', async () => {
    // Ensure both listeners available
    await (admin.from('listener_presence') as any).update({
      state: 'available',
      heartbeat_at: new Date().toISOString(),
      current_reservation_id: null,
    }).in('listener_id', [listener1Id, listener2Id]);

    const { data: req } = await admin.from('support_requests').insert({
      user_id: userAId,
      topic: 'work_stress',
      language: 'English',
      service_tier: 'listener',
      state: 'queued',
      idempotency_key: `multi_listener_race_${Date.now()}`,
    } as any).select().single();

    const reqId = (req as any).id;

    const results = await Promise.allSettled([
      matchingRepo.createReservation({
        requestId: reqId,
        listenerId: listener1Id,
        score: 0.95,
        scoreComponents: mockScoreComponents,
      }),
      matchingRepo.createReservation({
        requestId: reqId,
        listenerId: listener2Id,
        score: 0.88,
        scoreComponents: mockScoreComponents,
      }),
    ]);

    const successes = results.filter(r => r.status === 'fulfilled');
    const failures = results.filter(r => r.status === 'rejected');

    // INVARIANT: Exactly one listener reservation succeeds for the request
    expect(successes).toHaveLength(1);
    expect(failures).toHaveLength(1);

    const winningRes = (successes[0] as PromiseFulfilledResult<any>).value;
    await matchingRepo.declineReservation(winningRes.id, winningRes.listener_id);
  });

  it('rematching after decline: retains declined reservation and creates new offer for same request', async () => {
    // Reset listener 1 and 2
    await (admin.from('listener_presence') as any).update({
      state: 'available',
      heartbeat_at: new Date().toISOString(),
      current_reservation_id: null,
    }).in('listener_id', [listener1Id, listener2Id]);

    const { data: req } = await admin.from('support_requests').insert({
      user_id: userAId,
      topic: 'work_stress',
      language: 'English',
      service_tier: 'listener',
      state: 'queued',
      idempotency_key: `rematch_req_${Date.now()}`,
    } as any).select().single();

    const reqId = (req as any).id;

    // 1. Offer to Listener 1
    const res1 = await matchingRepo.createReservation({
      requestId: reqId,
      listenerId: listener1Id,
      score: 0.91,
      scoreComponents: mockScoreComponents,
    });
    expect(res1.state).toBe('offered');

    // 2. Listener 1 declines offer
    await matchingRepo.declineReservation(res1.id, listener1Id);

    // Verify request returned to queued and listener 1 returned to available
    const { data: reqAfterDecline } = await admin.from('support_requests').select('state').eq('id', reqId).single();
    expect((reqAfterDecline as any).state).toBe('queued');

    const { data: lp1AfterDecline } = await admin.from('listener_presence').select('state').eq('listener_id', listener1Id).single();
    expect((lp1AfterDecline as any).state).toBe('available');

    // 3. Rematch: Offer the SAME request to Listener 2!
    // SCHEMA INVARIANT FIX: Prior bug threw duplicate key on request_id here!
    const res2 = await matchingRepo.createReservation({
      requestId: reqId,
      listenerId: listener2Id,
      score: 0.85,
      scoreComponents: mockScoreComponents,
    });

    expect(res2).toBeDefined();
    expect(res2.id).not.toBe(res1.id);
    expect(res2.listener_id).toBe(listener2Id);
    expect(res2.state).toBe('offered');

    // Verify both reservations exist in the database (historical retention)
    const { data: allReservations } = await admin
      .from('match_reservations')
      .select('*')
      .eq('request_id', reqId)
      .order('offered_at', { ascending: true });

    expect(allReservations).toHaveLength(2);
    expect((allReservations as any)[0].state).toBe('declined');
    expect((allReservations as any)[1].state).toBe('offered');

    await matchingRepo.declineReservation(res2.id, listener2Id);
  });

  it('accept vs timeout: expired offer cannot be accepted and returns request to queued', async () => {
    await (admin.from('listener_presence') as any).update({
      state: 'available',
      heartbeat_at: new Date().toISOString(),
      current_reservation_id: null,
    }).eq('listener_id', listener1Id);

    const { data: req } = await admin.from('support_requests').insert({
      user_id: userAId,
      topic: 'work_stress',
      language: 'English',
      service_tier: 'listener',
      state: 'queued',
      idempotency_key: `timeout_req_${Date.now()}`,
    } as any).select().single();

    const reqId = (req as any).id;

    // Create reservation with 1 second TTL
    const res = await matchingRepo.createReservation({
      requestId: reqId,
      listenerId: listener1Id,
      score: 0.9,
      scoreComponents: mockScoreComponents,
      expiresInSeconds: 1,
    });

    // Wait 1.5 seconds for expiration
    await new Promise(r => setTimeout(r, 1500));

    // Attempt to accept after expiry
    await expect(matchingRepo.acceptReservation(res.id, listener1Id)).rejects.toThrow(
      /Offer has expired|expired/i
    );

    // Verify request returned to queued and listener returned to available
    const { data: reqAfterTimeout } = await admin.from('support_requests').select('state').eq('id', reqId).single();
    expect((reqAfterTimeout as any).state).toBe('queued');

    const { data: lpAfterTimeout } = await admin.from('listener_presence').select('state').eq('listener_id', listener1Id).single();
    expect((lpAfterTimeout as any).state).toBe('available');
  });

  it('rejects matching when presence heartbeat is stale (>30s)', async () => {
    // Set listener 1 heartbeat to 45 seconds ago
    const staleTime = new Date(Date.now() - 45000).toISOString();
    await (admin.from('listener_presence') as any).update({
      state: 'available',
      heartbeat_at: staleTime,
      current_reservation_id: null,
    }).eq('listener_id', listener1Id);

    const { data: req } = await admin.from('support_requests').insert({
      user_id: userAId,
      topic: 'work_stress',
      language: 'English',
      service_tier: 'listener',
      state: 'queued',
      idempotency_key: `stale_req_${Date.now()}`,
    } as any).select().single();

    await expect(
      matchingRepo.createReservation({
        requestId: (req as any).id,
        listenerId: listener1Id,
        score: 0.9,
        scoreComponents: mockScoreComponents,
      })
    ).rejects.toThrow(/heartbeat is stale/i);
  });

  it('rejects matching when a user block exists between user and listener', async () => {
    // Reset listener 1 fresh
    await (admin.from('listener_presence') as any).update({
      state: 'available',
      heartbeat_at: new Date().toISOString(),
      current_reservation_id: null,
    }).eq('listener_id', listener1Id);

    // Create block from User A to Listener 1
    await admin.from('blocks').insert({
      blocker_id: userAId,
      blocked_id: listener1UserId,
      reason_code: 'harassment',
    } as any);

    const { data: req } = await admin.from('support_requests').insert({
      user_id: userAId,
      topic: 'work_stress',
      language: 'English',
      service_tier: 'listener',
      state: 'queued',
      idempotency_key: `block_req_${Date.now()}`,
    } as any).select().single();

    await expect(
      matchingRepo.createReservation({
        requestId: (req as any).id,
        listenerId: listener1Id,
        score: 0.9,
        scoreComponents: mockScoreComponents,
      })
    ).rejects.toThrow(/user block constraint/i);

    // Remove block
    await admin.from('blocks').delete().match({ blocker_id: userAId, blocked_id: listener1UserId });
  });
});
