// Review-only counterexamples; excluded from the application's normal test discovery.
// Real local Auth/Postgres/handlers, synthetic fixtures, no payment or SMS dispatch.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import crypto from 'node:crypto';
import { NextRequest } from 'next/server';
import { ListenerRepository, MatchingRepository, SessionRepository } from '@vent/db';
import { UserRole } from '@vent/domain';
import * as supabaseBoundary from '../../../apps/web/src/lib/supabase-server';
import { SupabaseAuthService } from '../../../apps/web/src/features/auth/supabase-auth-service';
import { MatchingCoordinator } from '../../../apps/web/src/features/matching/coordinator';
import { POST as matchHandler } from '../../../apps/web/src/app/api/support-requests/[id]/match/route';
import { POST as acceptHandler } from '../../../apps/web/src/app/api/matches/[id]/accept/route';
import { POST as endHandler } from '../../../apps/web/src/app/api/sessions/[id]/end/route';
import { POST as createHandler } from '../../../apps/web/src/app/api/support-requests/route';

const endpoint = new URL(supabaseBoundary.getSupabaseServerUrl());
if (endpoint.hostname !== '127.0.0.1' || endpoint.port !== '54321') {
  throw new Error('Review probes require the explicitly identified local Vent test stack.');
}
const admin: any = supabaseBoundary.getSupabaseAdmin();
const authIds: string[] = [];
const userIds: string[] = [];
const requestIds: string[] = [];
const paymentIds: string[] = [];
const run = crypto.randomUUID().slice(0, 8);
type Actor = { id: string; authId: string; token: string; phone: string; authUser: any; authSession: any };
let owner: Actor;
let attacker: Actor;
let listener: Actor;
let listenerId: string;

async function actor(label: string, role = UserRole.USER, publicRow = true): Promise<Actor> {
  const phone = `+919${Math.floor(100000000 + Math.random() * 900000000)}`;
  const password = `ReviewOnly_${crypto.randomUUID()}`;
  const made = await admin.auth.admin.createUser({ phone, phone_confirm: true, password, app_metadata: { role } });
  if (made.error || !made.data.user) throw new Error(`Synthetic auth fixture failed: ${made.error?.message}`);
  const authId = made.data.user.id;
  authIds.push(authId);
  let id = '';
  if (publicRow) {
    const inserted = await admin.from('users').insert({ auth_user_id: authId, handle: `Review_${run}_${label}`, age_verified_at: new Date().toISOString(), status: 'active' }).select('id').single();
    if (inserted.error) throw inserted.error;
    id = inserted.data.id;
    userIds.push(id);
  }
  const signedIn = await supabaseBoundary.getSupabaseServerClient().auth.signInWithPassword({ phone, password });
  if (signedIn.error || !signedIn.data.session) throw new Error('Synthetic password login failed');
  return { id, authId, token: signedIn.data.session.access_token, phone, authUser: made.data.user, authSession: signedIn.data.session };
}

function post(path: string, who: Actor, body?: unknown) {
  return new NextRequest(`http://localhost:3100${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${who.token}` },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

async function paidRequest(paymentState = 'captured') {
  const payment = await admin.from('payments').insert({
    user_id: owner.id, provider: 'razorpay', provider_order_id: `order_review_${crypto.randomUUID()}`,
    amount_paise: 50000, currency: 'INR', state: paymentState,
    captured_at: paymentState === 'captured' ? new Date().toISOString() : null,
  }).select('id').single();
  if (payment.error) throw payment.error;
  paymentIds.push(payment.data.id);
  const request = await admin.from('support_requests').insert({
    user_id: owner.id, topic: 'Work & Career Stress', language: 'Gujarati', service_tier: 'listener',
    state: 'queued', payment_order_id: payment.data.id, queued_at: new Date().toISOString(), idempotency_key: crypto.randomUUID(),
  }).select('id').single();
  if (request.error) throw request.error;
  requestIds.push(request.data.id);
  return request.data.id as string;
}

async function state(requestId: string) {
  const [request, reservations, sessions, presence] = await Promise.all([
    admin.from('support_requests').select('state').eq('id', requestId).single(),
    admin.from('match_reservations').select('state').eq('request_id', requestId),
    admin.from('sessions').select('state').eq('request_id', requestId),
    admin.from('listener_presence').select('state').eq('listener_id', listenerId).single(),
  ]);
  for (const result of [request, reservations, sessions, presence]) if (result.error) throw result.error;
  return { requestState: request.data.state, reservationStates: reservations.data.map((r: any) => r.state), sessionCount: sessions.data.length, presenceState: presence.data.state };
}

describe('Independent long-horizon review — real local database counterexamples', () => {
  beforeAll(async () => {
    owner = await actor('owner');
    attacker = await actor('other');
    listener = await actor('listener', UserRole.LISTENER);
    const profile = await new ListenerRepository(admin).createProfile({ userId: listener.id, displayName: `Review ${run}`, languages: ['Gujarati'], topics: ['Work & Career Stress'] });
    listenerId = profile.id;
    const updated = await admin.from('listener_profiles').update({ status: 'active', training_expires_at: new Date(Date.now() + 86400000).toISOString() }).eq('id', listenerId);
    if (updated.error) throw updated.error;
  });
  beforeEach(async () => {
    await new ListenerRepository(admin).setPresenceState(listenerId, 'available');
  });
  afterEach(async () => {
    vi.restoreAllMocks();
    if (requestIds.length) {
      for (const table of ['sessions', 'match_reservations']) {
        const result = await admin.from(table).delete().in('request_id', requestIds);
        if (result.error) throw result.error;
      }
      const result = await admin.from('support_requests').delete().in('id', requestIds);
      if (result.error) throw result.error;
      requestIds.length = 0;
    }
    if (paymentIds.length) {
      const result = await admin.from('payments').delete().in('id', paymentIds);
      if (result.error) throw result.error;
      paymentIds.length = 0;
    }
  });
  afterAll(async () => {
    if (listenerId) {
      for (const [table, key] of [['listener_presence', 'listener_id'], ['listener_profiles', 'id']]) {
        const result = await admin.from(table).delete().eq(key, listenerId);
        if (result.error) throw result.error;
      }
    }
    if (userIds.length) {
      const result = await admin.from('users').delete().in('id', userIds);
      if (result.error) throw result.error;
    }
    for (const id of authIds) {
      const result = await admin.auth.admin.deleteUser(id);
      if (result.error) throw result.error;
    }
    console.info('Review synthetic fixtures cleaned up.');
  });

  it('recovers after a transient failure at the new recovery boundary', async () => {
    const requestId = await paidRequest();
    const reservation = await new MatchingRepository(admin).createReservation({ requestId, listenerId, score: 1, scoreComponents: {}, expiresInSeconds: 120 });
    const fault = vi.spyOn(MatchingRepository.prototype, 'recoverSession').mockRejectedValueOnce(new Error('Review synthetic recovery failure'));
    const first = await acceptHandler(post(`/api/matches/${reservation.id}/accept`, listener), { params: Promise.resolve({ id: reservation.id }) });
    fault.mockRestore();
    const retry = await acceptHandler(post(`/api/matches/${reservation.id}/accept`, listener), { params: Promise.resolve({ id: reservation.id }) });
    const after = await state(requestId);
    console.info(JSON.stringify({ probe: 'new-r2-fault-boundary', first: first.status, retry: retry.status, ...after }));
    expect(first.status).toBe(400);
    expect(retry.status).toBe(200);
    expect(after.sessionCount).toBe(1);
  });

  it('denies anonymous direct calls to privileged session recovery', async () => {
    const requestId = await paidRequest();
    const repo = new MatchingRepository(admin);
    const reservation = await repo.createReservation({ requestId, listenerId, score: 1, scoreComponents: {}, expiresInSeconds: 120 });
    await repo.acceptReservation(reservation.id, listenerId);
    const before = await state(requestId);
    const anonymous = supabaseBoundary.getSupabaseServerClient();
    const result = await (anonymous as any).rpc('atomic_accept_session_recovery', { p_reservation_id: reservation.id, p_listener_id: listenerId });
    const after = await state(requestId);
    console.info(JSON.stringify({ probe: 'anonymous-recovery', authenticatedUserTokenSupplied: false, status: result.status, errorCode: result.error?.code ?? null, success: result.data?.success ?? false, before, after }));
    expect(result.error).not.toBeNull();
    expect(after).toEqual(before);
  });

  it('keeps completed-session listener presence unchanged on accept replay', async () => {
    const requestId = await paidRequest();
    const reservation = await new MatchingRepository(admin).createReservation({ requestId, listenerId, score: 1, scoreComponents: {}, expiresInSeconds: 120 });
    const first = await acceptHandler(post(`/api/matches/${reservation.id}/accept`, listener), { params: Promise.resolve({ id: reservation.id }) });
    expect(first.status).toBe(200);
    const body = await first.json();
    const ended = await endHandler(post(`/api/sessions/${body.sessionId}/end`, owner, { reason: 'normal_completion' }), { params: Promise.resolve({ id: body.sessionId }) });
    expect(ended.status).toBe(200);
    const before = await state(requestId);
    expect(before.presenceState).toBe('available');
    const retry = await acceptHandler(post(`/api/matches/${reservation.id}/accept`, listener), { params: Promise.resolve({ id: reservation.id }) });
    const after = await state(requestId);
    console.info(JSON.stringify({ probe: 'accept-replay-after-end', retry: retry.status, before, after }));
    expect(after.presenceState).toBe('available');
    expect(after.requestState).toBe('completed');
  });
});