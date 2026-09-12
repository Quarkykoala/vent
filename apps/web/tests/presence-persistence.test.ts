import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { NextRequest } from 'next/server';
import { UserRole, type UserRoleType } from '@vent/domain';
import {
  getSupabaseAdmin,
  getSupabaseServerUrl,
  getSupabaseAnonKey,
} from '../src/lib/supabase-server';
import { createSupabaseClient, ListenerRepository } from '@vent/db';
import { POST as toggleHandler } from '../src/app/api/listeners/presence/toggle/route';
import { POST as heartbeatHandler } from '../src/app/api/listeners/presence/heartbeat/route';
import { POST as maintenanceHandler } from '../src/app/api/operations/maintenance/route';

/**
 * F02 scope (P2.2): presence toggle and heartbeat persist durable state for the
 * authenticated listener, and the stale-presence sweep executes against the
 * database without ever terminating active sessions.
 */

interface Actor {
  userId: string;
  authUserId: string;
  token: string;
  listenerProfileId?: string;
}

describe('F02/P2.2 — Durable listener presence + stale sweep', () => {
  const admin = getSupabaseAdmin();
  const url = getSupabaseServerUrl();
  const anonKey = getSupabaseAnonKey();
  const repo = new ListenerRepository(admin);

  const listener: Actor = { userId: '', authUserId: '', token: '' };
  const plainUser: Actor = { userId: '', authUserId: '', token: '' };
  const ops: Actor = { userId: '', authUserId: '', token: '' };

  let runNonce = 0;

  function randomPhone(): string {
    // Valid Indian E.164 (+91 + 10 digits starting 9); unique per run to avoid
    // collisions between parallel live-DB suites and stale auth users.
    runNonce += 1;
    const tail = `${Date.now().toString().slice(-6)}${Math.floor(100 + Math.random() * 900)}${runNonce}`;
    return `+919${tail.slice(0, 9)}`;
  }

  async function provision(
    phone: string,
    role: UserRoleType,
    handlePrefix: string,
    needsProfile: boolean
  ): Promise<Actor> {
    const { data: existing } = await admin.auth.admin.listUsers({ perPage: 200 });
    for (const u of existing?.users || []) {
      if (u.phone === phone) {
        await admin.from('users').delete().eq('auth_user_id', u.id);
        await admin.auth.admin.deleteUser(u.id);
      }
    }

    let authUserIdLocal = '';
    let lastCreateErr: string | null = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      const { data: created, error: createErr } = await admin.auth.admin.createUser({
        phone,
        phone_confirm: true,
        password: 'Password123!',
        app_metadata: { role },
      });
      if (!createErr && created.user) {
        authUserIdLocal = created.user.id;
        break;
      }
      lastCreateErr = createErr?.message ?? 'unknown';
      // Stale auth user beyond the paginated listing: purge by phone and retry.
      const { data: stale } = await admin.auth.admin.listUsers({ perPage: 200 });
      for (const u of stale?.users || []) {
        if (u.phone === phone) {
          await admin.from('users').delete().eq('auth_user_id', u.id);
          await admin.auth.admin.deleteUser(u.id);
        }
      }
    }
    if (!authUserIdLocal) {
      throw new Error(`provision ${handlePrefix}: ${lastCreateErr}`);
    }

    const { data: userRow, error: userErr } = await admin
      .from('users')
      .insert({
        auth_user_id: authUserIdLocal,
        handle: `${handlePrefix}_${Date.now()}_${Math.floor(Math.random() * 10000)}`,
        age_verified_at: new Date().toISOString(),
        status: 'active',
      } as any)
      .select()
      .single();
    if (userErr || !userRow) throw new Error(`users row ${handlePrefix}: ${userErr?.message}`);

    const loginClient = createSupabaseClient({ supabaseUrl: url, supabaseAnonKey: anonKey });
    const { data: signIn, error: signInErr } = await loginClient.auth.signInWithPassword({
      phone,
      password: 'Password123!',
    });
    if (signInErr || !signIn.session) throw new Error(`login ${handlePrefix}: ${signInErr?.message}`);

    const actor: Actor = {
      userId: (userRow as any).id,
      authUserId: authUserIdLocal,
      token: signIn.session.access_token,
    };

    if (needsProfile) {
      const profile = await repo.createProfile({
        userId: actor.userId,
        displayName: `Presence ${handlePrefix}`,
        languages: ['English'],
        topics: ['Work & Career Stress'],
      });
      actor.listenerProfileId = profile.id;
    }

    return actor;
  }

  beforeAll(async () => {
    listener.token = '';
    const l = await provision(randomPhone(), UserRole.LISTENER, 'PresenceListener', true);
    listener.userId = l.userId;
    listener.authUserId = l.authUserId;
    listener.token = l.token;
    listener.listenerProfileId = l.listenerProfileId;
    await (admin.from('listener_profiles') as any).update({ status: 'active' }).eq('id', listener.listenerProfileId);

    const p = await provision(randomPhone(), UserRole.USER, 'PresencePlainUser', false);
    plainUser.userId = p.userId;
    plainUser.authUserId = p.authUserId;
    plainUser.token = p.token;

    const o = await provision(randomPhone(), UserRole.LISTENER_OPS, 'PresenceOps', false);
    ops.userId = o.userId;
    ops.authUserId = o.authUserId;
    ops.token = o.token;
  });

  afterAll(async () => {
    await admin.from('users').delete().in('id', [listener.userId, plainUser.userId, ops.userId]);
  });

  function presencePost(
    path: string,
    handler: typeof toggleHandler,
    body: unknown,
    token?: string
  ) {
    return handler(
      new NextRequest(`http://localhost:3000${path}`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(token ? { authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify(body),
      })
    );
  }

  it('returns 401 for an unauthenticated toggle', async () => {
    const res = await presencePost('/api/listeners/presence/toggle', toggleHandler, {
      listenerId: listener.listenerProfileId,
      desiredState: 'available',
    });
    expect(res.status).toBe(401);
  });

  it('returns 403 for a caller without the listener role', async () => {
    const res = await presencePost(
      '/api/listeners/presence/toggle',
      toggleHandler,
      { listenerId: crypto.randomUUID(), desiredState: 'available' },
      plainUser.token
    );
    expect(res.status).toBe(403);
  });

  it('returns 403 when toggling a listener ID that is not owned by the caller', async () => {
    const res = await presencePost(
      '/api/listeners/presence/toggle',
      toggleHandler,
      { listenerId: crypto.randomUUID(), desiredState: 'available' },
      listener.token
    );
    expect(res.status).toBe(403);
  });

  it('persists an authenticated toggle to available with available_since set', async () => {
    const res = await presencePost(
      '/api/listeners/presence/toggle',
      toggleHandler,
      { listenerId: listener.listenerProfileId, desiredState: 'available' },
      listener.token
    );
    expect(res.status).toBe(200);

    const presence = await repo.getPresence(listener.listenerProfileId!);
    expect(presence!.state).toBe('available');
    expect(presence!.available_since).not.toBeNull();
  });

  it('persists heartbeats and advances heartbeat_at for the authenticated listener', async () => {
    const oldHeartbeat = new Date(Date.now() - 20_000).toISOString();
    await (admin.from('listener_presence') as any)
      .update({ heartbeat_at: oldHeartbeat })
      .eq('listener_id', listener.listenerProfileId);

    const res = await presencePost('/api/listeners/presence/heartbeat', heartbeatHandler, {}, listener.token);
    expect(res.status).toBe(200);

    const presence = await repo.getPresence(listener.listenerProfileId!);
    expect(new Date(presence!.heartbeat_at).getTime()).toBeGreaterThan(
      new Date(oldHeartbeat).getTime()
    );
  });

  it('rejects an invalid transition (available -> available) with 409 without mutating state', async () => {
    const res = await presencePost(
      '/api/listeners/presence/toggle',
      toggleHandler,
      { listenerId: listener.listenerProfileId, desiredState: 'available' },
      listener.token
    );
    expect(res.status).toBe(409);

    const presence = await repo.getPresence(listener.listenerProfileId!);
    expect(presence!.state).toBe('available');
  });

  it('persists the toggle back to offline with available_since cleared', async () => {
    const res = await presencePost(
      '/api/listeners/presence/toggle',
      toggleHandler,
      { listenerId: listener.listenerProfileId, desiredState: 'offline' },
      listener.token
    );
    expect(res.status).toBe(200);

    const presence = await repo.getPresence(listener.listenerProfileId!);
    expect(presence!.state).toBe('offline');
    expect(presence!.available_since).toBeNull();
  });

  it('sweeps stale available listeners to offline and never touches in_session listeners', async () => {
    // Listener A: available with a stale heartbeat (must be swept).
    await (admin.from('listener_presence') as any)
      .update({ state: 'available', heartbeat_at: new Date(Date.now() - 120_000).toISOString() })
      .eq('listener_id', listener.listenerProfileId);

    // Listener B: in_session with an equally stale heartbeat (must be preserved).
    const { data: otherProfile } = await admin
      .from('listener_profiles')
      .insert({
        user_id: ops.userId,
        display_name: 'Presence InSession Guard',
        status: 'active',
        tier: 'listener',
        languages: ['English'],
        topics: ['Work & Career Stress'],
        quality_prior: 4.0,
      } as any)
      .select()
      .single();
    const otherProfileId = (otherProfile as any).id;
    await (admin.from('listener_presence') as any).upsert({
      listener_id: otherProfileId,
      state: 'in_session',
      heartbeat_at: new Date(Date.now() - 120_000).toISOString(),
    });

    const res = await presencePost(
      '/api/operations/maintenance',
      maintenanceHandler,
      { staleSeconds: 30 },
      ops.token
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.swept).toBeGreaterThanOrEqual(1);

    const swept = await repo.getPresence(listener.listenerProfileId!);
    expect(swept!.state).toBe('offline');

    const preserved = await repo.getPresence(otherProfileId);
    expect(preserved!.state).toBe('in_session');

    await admin.from('listener_presence').delete().eq('listener_id', otherProfileId);
    await admin.from('listener_profiles').delete().eq('id', otherProfileId);
  });
});
