-- Migration: 20260908000001_accept_session_recovery.sql
-- Description: R2 repair — failure after reservation acceptance must not strand
-- the request. This recovery RPC runs inside one transaction: it locks the
-- accepted reservation, returns the existing session when one was already
-- created for the request, and otherwise creates exactly one session row
-- (guarded by the UNIQUE(request_id) constraint) and advances the request to
-- connected. Retries converge on the same session instead of stranding or
-- duplicating it.

create or replace function public.atomic_accept_session_recovery(
    p_reservation_id uuid,
    p_listener_id uuid
)
returns jsonb
language plpgsql
security definer
as $$
declare
    v_res record;
    v_sess record;
    v_now timestamptz;
    v_room text;
begin
    v_now := timezone('utc', now());

    -- Lock the reservation so concurrent recoveries serialize.
    select id, request_id, listener_id, state into v_res
    from public.match_reservations
    where id = p_reservation_id
    for update;

    if not found then
        return jsonb_build_object('success', false, 'error', 'Reservation not found', 'code', 'RESERVATION_NOT_FOUND');
    end if;

    if v_res.listener_id <> p_listener_id then
        return jsonb_build_object('success', false, 'error', 'Reservation does not belong to this listener', 'code', 'LISTENER_MISMATCH');
    end if;

    if v_res.state <> 'accepted' then
        return jsonb_build_object('success', false, 'error', 'Reservation is not accepted (current: ' || v_res.state || ')', 'code', 'INVALID_STATE');
    end if;

    -- Durable recovery: a session created by an earlier attempt wins.
    select id, room_name into v_sess
    from public.sessions
    where request_id = v_res.request_id;

    if found then
        update public.support_requests
        set state = 'connected'
        where id = v_res.request_id and state = 'accepted';

        update public.listener_presence
        set state = 'reserved'
        where listener_id = v_res.listener_id and state <> 'reserved';

        return jsonb_build_object(
            'success', true,
            'recovered', true,
            'reservation_id', p_reservation_id,
            'request_id', v_res.request_id,
            'session_id', v_sess.id,
            'room_name', v_sess.room_name
        );
    end if;

    -- No session yet: create exactly one. The UNIQUE(request_id) constraint is
    -- the final guard if two recoveries race past the select above.
    v_room := 'room_' || replace(gen_random_uuid()::text, '-', '');

    begin
        insert into public.sessions (request_id, user_id, listener_id, room_name, state, started_at)
        select v_res.request_id, sr.user_id, v_res.listener_id, v_room, 'created', v_now
        from public.support_requests sr
        where sr.id = v_res.request_id
        returning id, room_name into v_sess;
    exception when unique_violation then
        select id, room_name into v_sess
        from public.sessions
        where request_id = v_res.request_id;

        update public.support_requests
        set state = 'connected'
        where id = v_res.request_id and state = 'accepted';

        return jsonb_build_object(
            'success', true,
            'recovered', true,
            'reservation_id', p_reservation_id,
            'request_id', v_res.request_id,
            'session_id', v_sess.id,
            'room_name', v_sess.room_name
        );
    end;

    update public.support_requests
    set state = 'connected'
    where id = v_res.request_id and state = 'accepted';

    update public.listener_presence
    set state = 'reserved'
    where listener_id = v_res.listener_id and state <> 'reserved';

    return jsonb_build_object(
        'success', true,
        'recovered', false,
        'reservation_id', p_reservation_id,
        'request_id', v_res.request_id,
        'session_id', v_sess.id,
        'room_name', v_sess.room_name
    );
end;
$$;

-- The recovery RPC is privileged server-side code: keep it out of direct
-- Data API reach like the other atomic_* functions.
revoke all on function public.atomic_accept_session_recovery(uuid, uuid) from anon, authenticated;
