-- Migration: 20260903000004_atomic_session_completion.sql
-- Description: ACID transaction to complete an active audio session, release listener presence, and complete support request

create or replace function public.atomic_end_session(
    p_session_id uuid,
    p_caller_user_id uuid,
    p_end_reason text default 'normal_completion'
)
returns jsonb
language plpgsql
security definer
as $$
declare
    v_sess record;
    v_listener_user_id uuid;
    v_now timestamptz;
    v_duration integer;
begin
    v_now := timezone('utc', now());

    -- Step 1: Lock and retrieve session
    select id, request_id, user_id, listener_id, state, started_at
    into v_sess
    from public.sessions
    where id = p_session_id
    for update;

    if not found then
        return jsonb_build_object(
            'success', false,
            'error', 'Session not found',
            'code', 'SESSION_NOT_FOUND'
        );
    end if;

    -- Step 2: Retrieve listener user_id
    select user_id into v_listener_user_id
    from public.listener_profiles
    where id = v_sess.listener_id;

    -- Step 3: Verify caller is an authorized participant
    if p_caller_user_id <> v_sess.user_id and p_caller_user_id <> v_listener_user_id then
        return jsonb_build_object(
            'success', false,
            'error', 'Forbidden: Caller is not a participant in this session',
            'code', 'UNAUTHORIZED_CALLER'
        );
    end if;

    -- Step 4: Validate session state
    if v_sess.state in ('ended', 'safety_ended') then
        return jsonb_build_object(
            'success', true,
            'session_id', v_sess.id,
            'state', v_sess.state,
            'already_ended', true,
            'message', 'Session is already completed'
        );
    end if;

    -- Step 5: Calculate duration in seconds
    if v_sess.started_at is not null then
        v_duration := extract(epoch from (v_now - v_sess.started_at))::integer;
        if v_duration < 0 then
            v_duration := 0;
        end if;
    else
        v_duration := 0;
    end if;

    -- Step 6: Transition session to ended
    update public.sessions
    set state = 'ended',
        ended_at = v_now,
        duration_seconds = v_duration,
        end_reason = p_end_reason
    where id = v_sess.id;

    -- Step 7: Transition support request to completed
    update public.support_requests
    set state = 'completed'
    where id = v_sess.request_id;

    -- Step 8: Release listener presence back to available
    update public.listener_presence
    set state = 'available',
        current_reservation_id = null,
        heartbeat_at = v_now
    where listener_id = v_sess.listener_id;

    return jsonb_build_object(
        'success', true,
        'session_id', v_sess.id,
        'state', 'ended',
        'duration_seconds', v_duration,
        'end_reason', p_end_reason,
        'ended_at', v_now
    );
end;
$$;
