-- Migration: 20260912000002_session_cap_and_worker_rpcs.sql
-- Description: Server-owned session duration cap (RISK-006) plus the system
-- entrypoints the operations worker needs. Every function here is
-- service-role only (see the ACL sweep at the end).

-- ---------------------------------------------------------------------------
-- 1. Cap-driven session termination
--    The server owns duration: a session that has run past the approved cap is
--    ended, its support request completed, its listener presence released and
--    its reservation settled — in one transaction, idempotently. Callers
--    cannot extend a session or end one early through this path: a session
--    inside its cap is reported as `due: false` and left untouched.
-- ---------------------------------------------------------------------------
create or replace function public.atomic_expire_session_cap(
    p_session_id uuid,
    p_cap_seconds integer default 1200,
    p_end_reason text default 'duration_cap'
)
returns jsonb
language plpgsql
security definer
as $$
declare
    v_sess record;
    v_now timestamptz;
    v_duration integer;
begin
    v_now := timezone('utc', now());

    if p_cap_seconds is null or p_cap_seconds <= 0 then
        return jsonb_build_object('success', false, 'error', 'Invalid cap', 'code', 'INVALID_CAP');
    end if;

    select id, request_id, user_id, listener_id, state, started_at
    into v_sess
    from public.sessions
    where id = p_session_id
    for update;

    if not found then
        return jsonb_build_object('success', false, 'error', 'Session not found', 'code', 'SESSION_NOT_FOUND');
    end if;

    -- Already terminal (or never started serving): nothing to enforce.
    if v_sess.state not in ('created', 'connecting', 'active') then
        return jsonb_build_object(
            'success', true,
            'due', false,
            'session_id', v_sess.id,
            'state', v_sess.state,
            'reason', 'TERMINAL_OR_INACTIVE'
        );
    end if;

    if v_sess.started_at is null then
        return jsonb_build_object(
            'success', true,
            'due', false,
            'session_id', v_sess.id,
            'state', v_sess.state,
            'reason', 'NOT_STARTED'
        );
    end if;

    v_duration := extract(epoch from (v_now - v_sess.started_at))::integer;
    if v_duration < p_cap_seconds then
        return jsonb_build_object(
            'success', true,
            'due', false,
            'session_id', v_sess.id,
            'state', v_sess.state,
            'elapsed_seconds', v_duration,
            'remaining_seconds', p_cap_seconds - v_duration,
            'reason', 'WITHIN_CAP'
        );
    end if;

    update public.sessions
    set state = 'ended',
        ended_at = v_now,
        duration_seconds = v_duration,
        end_reason = p_end_reason
    where id = v_sess.id;

    update public.support_requests
    set state = 'completed'
    where id = v_sess.request_id
      and state not in ('completed', 'cancelled', 'expired', 'declined', 'payment_failed',
                        'offer_expired', 'technical_failed', 'safety_escalated');

    update public.listener_presence
    set state = 'available',
        current_reservation_id = null,
        heartbeat_at = v_now
    where listener_id = v_sess.listener_id
      and state in ('reserved', 'in_session');

    update public.match_reservations
    set state = 'cancelled'
    where request_id = v_sess.request_id
      and state in ('offered', 'accepted');

    return jsonb_build_object(
        'success', true,
        'due', true,
        'session_id', v_sess.id,
        'state', 'ended',
        'duration_seconds', v_duration,
        'cap_seconds', p_cap_seconds,
        'end_reason', p_end_reason,
        'ended_at', v_now
    );
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. Sessions currently past their cap (worker read path)
-- ---------------------------------------------------------------------------
create or replace function public.list_cap_expired_sessions(
    p_cap_seconds integer default 1200,
    p_limit integer default 100
)
returns table (session_id uuid, request_id uuid, listener_id uuid, elapsed_seconds integer)
language sql
stable
security definer
as $$
    select
        s.id as session_id,
        s.request_id,
        s.listener_id,
        extract(epoch from (timezone('utc', now()) - s.started_at))::integer as elapsed_seconds
    from public.sessions s
    where s.state in ('created', 'connecting', 'active')
      and s.started_at is not null
      and s.started_at <= timezone('utc', now()) - make_interval(secs => greatest(p_cap_seconds, 1))
    order by s.started_at asc
    limit least(greatest(p_limit, 1), 500);
$$;

-- ---------------------------------------------------------------------------
-- 3. Offers past their TTL (worker read path). The state transition still goes
--    through atomic_expire_reservation so the listener release is atomic.
-- ---------------------------------------------------------------------------
create or replace function public.list_ttl_expired_reservations(
    p_limit integer default 200
)
returns table (reservation_id uuid, request_id uuid, listener_id uuid, expired_at timestamptz)
language sql
stable
security definer
as $$
    select
        r.id as reservation_id,
        r.request_id,
        r.listener_id,
        r.expires_at as expired_at
    from public.match_reservations r
    where r.state = 'offered'
      and r.expires_at <= timezone('utc', now())
    order by r.expires_at asc
    limit least(greatest(p_limit, 1), 500);
$$;

-- ---------------------------------------------------------------------------
-- 4. ACL sweep (same policy as 20260912000001): service role only.
-- ---------------------------------------------------------------------------
do $$
declare
    fn record;
    helper_names text[] := array['current_user_id', 'current_listener_id', 'current_user_role'];
begin
    for fn in
        select p.proname, pg_get_function_identity_arguments(p.oid) as identity_args
        from pg_proc p
        join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.prokind = 'f'
    loop
        execute format('alter function public.%I(%s) set search_path = public, pg_temp', fn.proname, fn.identity_args);

        if not (fn.proname = any(helper_names)) then
            execute format('revoke all on function public.%I(%s) from public', fn.proname, fn.identity_args);
            execute format('revoke all on function public.%I(%s) from anon', fn.proname, fn.identity_args);
            execute format('revoke all on function public.%I(%s) from authenticated', fn.proname, fn.identity_args);
            execute format('grant execute on function public.%I(%s) to service_role', fn.proname, fn.identity_args);
        else
            execute format('revoke all on function public.%I(%s) from public', fn.proname, fn.identity_args);
            execute format('grant execute on function public.%I(%s) to anon', fn.proname, fn.identity_args);
            execute format('grant execute on function public.%I(%s) to authenticated', fn.proname, fn.identity_args);
        end if;
    end loop;
end;
$$;
