import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createSupabaseClient, type TypedSupabaseClient } from '@vent/db';
import { UserRole } from '@vent/domain';
import {
  getSupabaseAdmin,
  getSupabaseServerUrl,
  getSupabaseAnonKey,
} from '../src/lib/supabase-server';

interface PersonaClient {
  role: string;
  phone: string;
  authUserId: string;
  userId: string;
  client: TypedSupabaseClient;
  token?: string;
  listenerProfileId?: string;
}

describe('Package 2 — Real Postgres RLS Hardening Across 11 Personas', () => {
  const admin = getSupabaseAdmin();
  const url = getSupabaseServerUrl();
  const anonKey = getSupabaseAnonKey();

  const personas: Record<string, PersonaClient> = {};
  let testSessionEndedId: string;
  let testSessionActiveId: string;
  let testRequestIdA: string;
  let testReservationIdA: string;
  let testPaymentIdA: string;

  beforeAll(async () => {
    // 1. Anon persona client
    personas['anon'] = {
      role: 'anon',
      phone: '',
      authUserId: '',
      userId: '',
      client: createSupabaseClient({ supabaseUrl: url, supabaseAnonKey: anonKey }),
    };

    // 2. Service role persona client
    personas['service_role'] = {
      role: 'service_role',
      phone: '',
      authUserId: '',
      userId: '',
      client: admin,
    };

    // Define personas to seed
    const personaConfigs = [
      { name: 'userA', phone: '+919999900001', role: UserRole.USER },
      { name: 'userB', phone: '+919999900002', role: UserRole.USER },
      { name: 'listenerA', phone: '+919999900003', role: UserRole.LISTENER },
      { name: 'listenerB', phone: '+919999900004', role: UserRole.LISTENER },
      { name: 'support_agent', phone: '+919999900005', role: UserRole.SUPPORT_AGENT },
      { name: 'listener_ops', phone: '+919999900006', role: UserRole.LISTENER_OPS },
      { name: 'clinical_supervisor', phone: '+919999900007', role: UserRole.CLINICAL_SUPERVISOR },
      { name: 'finance', phone: '+919999900008', role: UserRole.FINANCE },
      { name: 'privacy_admin', phone: '+919999900009', role: UserRole.PRIVACY_ADMIN },
    ];

    // Cleanup and provision each persona
    const { data: existingAuth } = await admin.auth.admin.listUsers();
    const phonesToClean = personaConfigs.map(c => c.phone);
    for (const u of existingAuth?.users || []) {
      if (phonesToClean.includes(u.phone || '')) {
        await admin.from('users').delete().eq('auth_user_id', u.id);
        await admin.auth.admin.deleteUser(u.id);
      }
    }

    for (const cfg of personaConfigs) {
      const { data: created, error: createErr } = await admin.auth.admin.createUser({
        phone: cfg.phone,
        phone_confirm: true,
        password: 'Password123!',
        app_metadata: { role: cfg.role },
      });

      if (createErr || !created.user) {
        throw new Error(`Failed provisioning ${cfg.name}: ${createErr?.message}`);
      }

      const authUserId = created.user.id;

      // Create public.users record
      const { data: userRow, error: userErr } = await admin
        .from('users')
        .insert({
          auth_user_id: authUserId,
          handle: `${cfg.name.toUpperCase()}Pseudonym123`,
          age_verified_at: new Date().toISOString(),
          status: 'active',
        } as any)
        .select()
        .single();

      if (userErr || !userRow) {
        throw new Error(`Failed creating public.users for ${cfg.name}: ${userErr?.message}`);
      }

      const userId = (userRow as any).id;

      // Sign in to obtain JWT
      const loginClient = createSupabaseClient({ supabaseUrl: url, supabaseAnonKey: anonKey });
      const { data: signInData, error: signInErr } = await loginClient.auth.signInWithPassword({
        phone: cfg.phone,
        password: 'Password123!',
      });

      if (signInErr || !signInData.session) {
        throw new Error(`Failed login for ${cfg.name}: ${signInErr?.message}`);
      }

      const token = signInData.session.access_token;

      // Authenticated client scoped to this user's token
      const client = createSupabaseClient({
        supabaseUrl: url,
        supabaseAnonKey: anonKey,
        authToken: token,
      });

      let listenerProfileId: string | undefined;
      if (cfg.role === UserRole.LISTENER) {
        const { data: lpRow, error: lpErr } = await admin
          .from('listener_profiles')
          .insert({
            user_id: userId,
            display_name: `${cfg.name} Display`,
            status: 'active',
            tier: 'listener',
            languages: ['English', 'Hindi'],
            topics: ['general', 'work_stress'],
            quality_prior: 4.5,
          } as any)
          .select()
          .single();

        if (lpErr) throw new Error(`Failed listener_profile for ${cfg.name}: ${lpErr.message}`);
        listenerProfileId = (lpRow as any).id;
      }

      personas[cfg.name] = {
        role: cfg.role,
        phone: cfg.phone,
        authUserId,
        userId,
        client,
        token,
        listenerProfileId,
      };
    }

    // Seed domain fixtures:
    // Support request for User A
    const { data: reqRow, error: reqErr } = await admin
      .from('support_requests')
      .insert({
        user_id: personas['userA'].userId,
        topic: 'work_stress',
        language: 'English',
        service_tier: 'listener',
        state: 'queued',
        idempotency_key: 'idemp_fixture_req_a',
      } as any)
      .select()
      .single();

    if (reqErr) throw new Error(`Failed seeding request: ${reqErr.message}`);
    testRequestIdA = (reqRow as any).id;

    // Match reservation for Listener A
    const { data: resRow, error: resErr } = await admin
      .from('match_reservations')
      .insert({
        request_id: testRequestIdA,
        listener_id: personas['listenerA'].listenerProfileId!,
        state: 'offered',
        score: 0.95,
        score_components: { language: 1.0 },
        expires_at: new Date(Date.now() + 60000).toISOString(),
      } as any)
      .select()
      .single();

    if (resErr) throw new Error(`Failed seeding reservation: ${resErr.message}`);
    testReservationIdA = (resRow as any).id;

    // Payment for User A
    const { data: payRow, error: payErr } = await admin
      .from('payments')
      .insert({
        user_id: personas['userA'].userId,
        provider: 'razorpay',
        provider_order_id: 'order_fixture_001',
        amount_paise: 50000,
        currency: 'INR',
        state: 'captured',
      } as any)
      .select()
      .single();

    if (payErr) throw new Error(`Failed seeding payment: ${payErr.message}`);
    testPaymentIdA = (payRow as any).id;

    // Ended Session between User A and Listener A
    const { data: sessEnded, error: sErr1 } = await admin
      .from('sessions')
      .insert({
        request_id: testRequestIdA,
        user_id: personas['userA'].userId,
        listener_id: personas['listenerA'].listenerProfileId!,
        state: 'ended',
        room_name: 'room_ended_fixture_001',
        started_at: new Date(Date.now() - 3600000).toISOString(),
        ended_at: new Date().toISOString(),
        duration_seconds: 2400,
      } as any)
      .select()
      .single();

    if (sErr1) throw new Error(`Failed seeding ended session: ${sErr1.message}`);
    testSessionEndedId = (sessEnded as any).id;

    // Active Session between User B and Listener B
    const { data: reqRowB } = await admin
      .from('support_requests')
      .insert({
        user_id: personas['userB'].userId,
        topic: 'general',
        language: 'Hindi',
        service_tier: 'listener',
        state: 'accepted',
        idempotency_key: 'idemp_fixture_req_b',
      } as any)
      .select()
      .single();

    const { data: sessActive, error: sErr2 } = await admin
      .from('sessions')
      .insert({
        request_id: (reqRowB as any).id,
        user_id: personas['userB'].userId,
        listener_id: personas['listenerB'].listenerProfileId!,
        state: 'active',
        room_name: 'room_active_fixture_002',
        started_at: new Date().toISOString(),
      } as any)
      .select()
      .single();

    if (sErr2) throw new Error(`Failed seeding active session: ${sErr2.message}`);
    testSessionActiveId = (sessActive as any).id;
  });

  afterAll(async () => {
    // Cleanup
    for (const key of Object.keys(personas)) {
      const p = personas[key];
      if (p.authUserId) {
        await admin.from('users').delete().eq('auth_user_id', p.authUserId);
        await admin.auth.admin.deleteUser(p.authUserId);
      }
    }
  });

  describe('1. Anon Persona Denials', () => {
    it('DENY: anon cannot select users table', async () => {
      const { data } = await personas['anon'].client.from('users').select('*');
      expect(data === null || data.length === 0).toBe(true);
    });

    it('DENY: anon cannot select support_requests', async () => {
      const { data } = await personas['anon'].client.from('support_requests').select('*');
      expect(data === null || data.length === 0).toBe(true);
    });

    it('DENY: anon cannot select sessions', async () => {
      const { data } = await personas['anon'].client.from('sessions').select('*');
      expect(data === null || data.length === 0).toBe(true);
    });

    it('DENY: anon cannot select sensitive ledger_entries table', async () => {
      const { data, error } = await personas['anon'].client.from('ledger_entries').select('*');
      expect(data === null || data.length === 0 || error !== null).toBe(true);
    });
  });

  describe('2. Users Table RLS & Privacy Invariants', () => {
    it('ALLOW: user A can read their own user record', async () => {
      const { data, error } = await personas['userA'].client
        .from('users')
        .select('*')
        .eq('id', personas['userA'].userId)
        .single();

      expect(error).toBeNull();
      expect(data).toBeDefined();
      expect((data as any).id).toBe(personas['userA'].userId);
    });

    it('DENY: user A cannot read user B user record', async () => {
      const { data } = await personas['userA'].client
        .from('users')
        .select('*')
        .eq('id', personas['userB'].userId);

      expect(data).toHaveLength(0);
    });

    it('DENY: listener A cannot read user A user record directly', async () => {
      const { data } = await personas['listenerA'].client
        .from('users')
        .select('*')
        .eq('id', personas['userA'].userId);

      expect(data).toHaveLength(0);
    });

    it('DENY: user A cannot directly UPDATE users table (revoked direct update)', async () => {
      const { error } = await (personas['userA'].client.from('users') as any)
        .update({ status: 'suspended' })
        .eq('id', personas['userA'].userId);

      expect(error).toBeDefined();
      expect(error?.message).toMatch(/permission denied/i);
    });
  });

  describe('3. Support Requests Table Isolation', () => {
    it('ALLOW: user A can read own support request', async () => {
      const { data, error } = await personas['userA'].client
        .from('support_requests')
        .select('*')
        .eq('id', testRequestIdA)
        .single();

      expect(error).toBeNull();
      expect((data as any).id).toBe(testRequestIdA);
    });

    it('DENY: user B cannot read user A support request', async () => {
      const { data } = await personas['userB'].client
        .from('support_requests')
        .select('*')
        .eq('id', testRequestIdA);

      expect(data).toHaveLength(0);
    });

    it('DENY: user B cannot insert request on behalf of user A (with check violation)', async () => {
      const { error } = await personas['userB'].client.from('support_requests').insert({
        user_id: personas['userA'].userId,
        topic: 'spoofed',
        language: 'English',
        service_tier: 'listener',
        idempotency_key: 'spoofed_key_001',
      } as any);

      expect(error).toBeDefined();
      expect(error?.message).toMatch(/row-level security policy/i);
    });

    it('DENY: user A cannot directly UPDATE support_requests (revoked direct update)', async () => {
      const { error } = await (personas['userA'].client.from('support_requests') as any)
        .update({ service_tier: 'counsellor' })
        .eq('id', testRequestIdA);

      expect(error).toBeDefined();
      expect(error?.message).toMatch(/permission denied/i);
    });
  });

  describe('4. Match Reservations Mutations Restricted', () => {
    it('ALLOW: listener A can read offered reservation', async () => {
      const { data, error } = await personas['listenerA'].client
        .from('match_reservations')
        .select('*')
        .eq('id', testReservationIdA)
        .single();

      expect(error).toBeNull();
      expect((data as any).id).toBe(testReservationIdA);
    });

    it('DENY: listener B cannot read listener A reservation', async () => {
      const { data } = await personas['listenerB'].client
        .from('match_reservations')
        .select('*')
        .eq('id', testReservationIdA);

      expect(data).toHaveLength(0);
    });

    it('DENY: listener A cannot directly mutate arbitrary columns on match_reservations', async () => {
      const { error } = await (personas['listenerA'].client.from('match_reservations') as any)
        .update({ score: 9.99, state: 'accepted' })
        .eq('id', testReservationIdA);

      expect(error).toBeDefined();
      expect(error?.message).toMatch(/permission denied/i);
    });
  });

  describe('5. Sessions Privacy & Cross-User Denial', () => {
    it('ALLOW: participants (user A and listener A) can select ended session', async () => {
      const resUser = await personas['userA'].client
        .from('sessions')
        .select('*')
        .eq('id', testSessionEndedId)
        .single();
      expect(resUser.error).toBeNull();

      const resListener = await personas['listenerA'].client
        .from('sessions')
        .select('*')
        .eq('id', testSessionEndedId)
        .single();
      expect(resListener.error).toBeNull();
    });

    it('DENY: third party (user B or listener B) cannot select session A', async () => {
      const resUserB = await personas['userB'].client
        .from('sessions')
        .select('*')
        .eq('id', testSessionEndedId);
      expect(resUserB.data).toHaveLength(0);

      const resListenerB = await personas['listenerB'].client
        .from('sessions')
        .select('*')
        .eq('id', testSessionEndedId);
      expect(resListenerB.data).toHaveLength(0);
    });
  });

  describe('6. Ratings Hardened Constraints', () => {
    it('DENY: user A cannot rate active (non-ended) session', async () => {
      const { error } = await personas['userA'].client.from('ratings').insert({
        session_id: testSessionActiveId,
        user_id: personas['userA'].userId,
        listener_id: personas['listenerA'].listenerProfileId!,
        stars: 5,
      } as any);

      expect(error).toBeDefined();
      expect(error?.message).toMatch(/row-level security policy/i);
    });

    it('DENY: user A cannot rate with mismatched listener_id', async () => {
      const { error } = await personas['userA'].client.from('ratings').insert({
        session_id: testSessionEndedId,
        user_id: personas['userA'].userId,
        listener_id: personas['listenerB'].listenerProfileId!, // Mismatched listener!
        stars: 5,
      } as any);

      expect(error).toBeDefined();
      expect(error?.message).toMatch(/row-level security policy/i);
    });

    it('ALLOW: user A can rate their own ended session with matching listener', async () => {
      const { error } = await personas['userA'].client.from('ratings').insert({
        session_id: testSessionEndedId,
        user_id: personas['userA'].userId,
        listener_id: personas['listenerA'].listenerProfileId!,
        stars: 5,
      } as any);

      expect(error).toBeNull();
    });

    it('DENY: duplicate rating on same session is blocked by DB unique constraint', async () => {
      const { error } = await personas['userA'].client.from('ratings').insert({
        session_id: testSessionEndedId,
        user_id: personas['userA'].userId,
        listener_id: personas['listenerA'].listenerProfileId!,
        stars: 4,
      } as any);

      expect(error).toBeDefined();
      expect(error?.message).toMatch(/ratings_session_id_key|duplicate/i);
    });
  });

  describe('7. Blocks Table Invariants', () => {
    it('DENY: user A cannot block themselves (DB check constraint)', async () => {
      const { error } = await personas['userA'].client.from('blocks').insert({
        blocker_id: personas['userA'].userId,
        blocked_id: personas['userA'].userId,
      } as any);

      expect(error).toBeDefined();
      expect(error?.message).toMatch(/blocks_check|check constraint/i);
    });

    it('DENY: user B cannot insert block claiming blocker is user A', async () => {
      const { error } = await personas['userB'].client.from('blocks').insert({
        blocker_id: personas['userA'].userId,
        blocked_id: personas['userB'].userId,
      } as any);

      expect(error).toBeDefined();
      expect(error?.message).toMatch(/row-level security policy/i);
    });

    it('ALLOW: user A can block user B', async () => {
      const { error } = await personas['userA'].client.from('blocks').insert({
        blocker_id: personas['userA'].userId,
        blocked_id: personas['userB'].userId,
      } as any);

      expect(error).toBeNull();
    });
  });

  describe('8. Payments Privacy', () => {
    it('ALLOW: user A can read own payment', async () => {
      const { data, error } = await personas['userA'].client
        .from('payments')
        .select('*')
        .eq('id', testPaymentIdA)
        .single();

      expect(error).toBeNull();
      expect((data as any).id).toBe(testPaymentIdA);
    });

    it('DENY: user B cannot read user A payment', async () => {
      const { data } = await personas['userB'].client
        .from('payments')
        .select('*')
        .eq('id', testPaymentIdA);

      expect(data).toHaveLength(0);
    });

    it('DENY: user A cannot insert payment directly (direct insert revoked)', async () => {
      const { error } = await personas['userA'].client.from('payments').insert({
        user_id: personas['userA'].userId,
        provider: 'razorpay',
        provider_order_id: 'fake_order_123',
        amount_paise: 1000,
        currency: 'INR',
        state: 'captured',
      } as any);

      expect(error).toBeDefined();
      expect(error?.message).toMatch(/permission denied/i);
    });
  });

  describe('9. Sensitive Tables Prohibited for Normal Users', () => {
    const sensitiveTables = ['ledger_entries', 'safety_cases', 'audit_events', 'idempotency_keys'];

    for (const table of sensitiveTables) {
      it(`DENY: user A cannot query ${table}`, async () => {
        const { data, error } = await (personas['userA'].client as any).from(table).select('*');
        expect(data === null || data.length === 0 || error !== null).toBe(true);
      });

      it(`DENY: listener A cannot query ${table}`, async () => {
        const { data, error } = await (personas['listenerA'].client as any).from(table).select('*');
        expect(data === null || data.length === 0 || error !== null).toBe(true);
      });
    }

    it('ALLOW: service role can access sensitive tables', async () => {
      const { data, error } = await (personas['service_role'].client as any)
        .from('ledger_entries')
        .select('*');
      expect(error).toBeNull();
      expect(Array.isArray(data)).toBe(true);
    });
  });
});
