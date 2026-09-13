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

  it('denies a non-owner without changing the victim request or reserving a listener', async () => {
    const id = await paidRequest();
    const response = await matchHandler(post(`/api/support-requests/${id}/match`, attacker), { params: Promise.resolve({ id }) });
    const after = await state(id);
    console.info(JSON.stringify({ probe: 'authorization-before-mutation', response: response.status, ...after }));
    expect(response.status).toBe(403);
    expect(after.requestState).toBe('queued');
    expect(after.reservationStates).toEqual([]);
  });

  it('can recover acceptance after a transient session creation failure', async () => {
    const requestId = await paidRequest();
    const reservation = await new MatchingRepository(admin).createReservation({ requestId, listenerId, score: 1, scoreComponents: {}, expiresInSeconds: 120 });
    const failure = vi.spyOn(SessionRepository.prototype, 'createSession').mockRejectedValueOnce(new Error('Synthetic transient insert failure'));
    const first = await acceptHandler(post(`/api/matches/${reservation.id}/accept`, listener), { params: Promise.resolve({ id: reservation.id }) });
    failure.mockRestore();
    const retry = await acceptHandler(post(`/api/matches/${reservation.id}/accept`, listener), { params: Promise.resolve({ id: reservation.id }) });
    const after = await state(requestId);
    console.info(JSON.stringify({ probe: 'accept-retry-after-partial-failure', first: first.status, retry: retry.status, ...after }));
    expect(retry.status).toBe(200);
    expect(after.sessionCount).toBe(1);
  });

  it('records genuine age confirmation for an existing token-provisioned user', async () => {
    const unconfirmed = await actor('age', UserRole.USER, false);
    const service = new SupabaseAuthService();
    const tokenSession = await service.getUserFromToken(unconfirmed.token);
    expect(tokenSession).not.toBeNull();
    unconfirmed.id = tokenSession!.userId;
    userIds.push(unconfirmed.id);
    // Only external OTP verification is stubbed: the application service and DB remain real.
    const otpBoundary = vi.spyOn(supabaseBoundary, 'getSupabaseServerClient').mockReturnValue({ auth: { verifyOtp: vi.fn().mockResolvedValue({ data: { user: unconfirmed.authUser, session: unconfirmed.authSession }, error: null }) } } as any);
    await service.verifyOtp({ phone: unconfirmed.phone, code: 'synthetic-provider-approved', ageConfirmed: true });
    otpBoundary.mockRestore();
    const evidence = await admin.from('users').select('age_verified_at').eq('id', unconfirmed.id).single();
    if (evidence.error) throw evidence.error;
    const response = await createHandler(post('/api/support-requests', unconfirmed, { topic: 'Work & Career Stress', language: 'English', serviceTier: 'listener', idempotencyKey: crypto.randomUUID() }));
    const result = await response.json();
    if (result.requestId) requestIds.push(result.requestId);
    console.info(JSON.stringify({ probe: 'existing-user-age-confirmation', ageEvidencePresent: Boolean(evidence.data.age_verified_at), createResponse: response.status }));
    expect(evidence.data.age_verified_at).not.toBeNull();
    expect(response.status).toBe(201);
  });

  it('does not grant matching entitlement for a link to a failed payment', async () => {
    const requestId = await paidRequest('failed');
    const result = await new MatchingCoordinator(admin).attemptMatch(requestId);
    const after = await state(requestId);
    console.info(JSON.stringify({ probe: 'captured-payment-check', paymentState: 'failed', result: result.status, ...after }));
    expect(result.status).toBe('not_entitled');
    expect(after.reservationStates).toEqual([]);
  });
});
