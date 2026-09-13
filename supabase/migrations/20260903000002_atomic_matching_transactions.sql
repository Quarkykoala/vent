-- Migration: 20260903000002_atomic_matching_transactions.sql
-- Description: ACID transactional stored procedures for matching, reservation, acceptance, and decline

-- 1. Atomic Match Reservation Function
create or replace function public.atomic_reserve_match(
    p_request_id uuid,
    p_listener_id uuid,
    p_score numeric,
    p_score_components jsonb default '{}'::jsonb,
    p_ttl_seconds integer default 45
)
returns jsonb
language plpgsql
security definer
as $$
declare
    v_req record;
    v_profile record;
    v_presence record;
    v_now timestamptz;
    v_expires_at timestamptz;
    v_res_id uuid;
begin
    v_now := timezone('utc', now());

    -- Step 1: Lock Support Request row
    select id, user_id, topic, language, state into v_req
    from public.support_requests
    where id = p_request_id
    for update;

    if not found then
        return jsonb_build_object('success', false, 'error', 'Support request not found', 'code', 'REQUEST_NOT_FOUND');
    end if;

    if v_req.state <> 'queued' then
        return jsonb_build_object('success', false, 'error', 'Request is not queued (current state: ' || v_req.state || ')', 'code', 'REQUEST_NOT_QUEUED');
    end if;

    -- Step 2: Lock Listener Profile and Presence rows
    select id, user_id, status, languages, topics into v_profile
    from public.listener_profiles
    where id = p_listener_id
    for update;

    if not found or v_profile.status <> 'active' then
        return jsonb_build_object('success', false, 'error', 'Listener profile not found or not active', 'code', 'LISTENER_NOT_ACTIVE');
    end if;

    select listener_id, state, heartbeat_at into v_presence
    from public.listener_presence
    where listener_id = p_listener_id
    for update;

    if not found then
        return jsonb_build_object('success', false, 'error', 'Listener presence not found', 'code', 'PRESENCE_NOT_FOUND');
    end if;

    -- Step 3: Verify listener is available
    if v_presence.state <> 'available' then
        return jsonb_build_object('success', false, 'error', 'Listener is not available (current state: ' || v_presence.state || ')', 'code', 'LISTENER_NOT_AVAILABLE');
    end if;

    -- Step 4: Verify heartbeat is fresh (< 30 seconds)
    if v_presence.heartbeat_at < (v_now - interval '30 seconds') then
        return jsonb_build_object('success', false, 'error', 'Listener presence heartbeat is stale', 'code', 'PRESENCE_STALE');
    end if;

    -- Step 5: Verify no active block in either direction
    if exists (
        select 1 from public.blocks
        where (blocker_id = v_req.user_id and blocked_id = v_profile.user_id)
           or (blocker_id = v_profile.user_id and blocked_id = v_req.user_id)
    ) then
        return jsonb_build_object('success', false, 'error', 'Matching blocked due to user block constraint', 'code', 'BLOCKED_PAIR');
    end if;

    -- Step 6: Verify language and topic match
    if not (v_req.language = any(v_profile.languages)) then
        return jsonb_build_object('success', false, 'error', 'Language mismatch', 'code', 'LANGUAGE_MISMATCH');
    end if;

    if not (v_req.topic = any(v_profile.topics)) then
        return jsonb_build_object('success', false, 'error', 'Topic mismatch', 'code', 'TOPIC_MISMATCH');
    end if;

    -- Step 7: Check for active reservations
    if exists (
        select 1 from public.match_reservations
        where request_id = p_request_id and state in ('offered', 'accepted')
    ) then
        return jsonb_build_object('success', false, 'error', 'Request already has an active reservation', 'code', 'REQUEST_ALREADY_RESERVED');
    end if;

    if exists (
        select 1 from public.match_reservations
        where listener_id = p_listener_id and state in ('offered', 'accepted')
    ) then
        return jsonb_build_object('success', false, 'error', 'Listener already has an active reservation', 'code', 'LISTENER_ALREADY_RESERVED');
    end if;

    -- Step 8: Perform atomic mutations
    v_expires_at := v_now + (p_ttl_seconds || ' seconds')::interval;
    v_res_id := gen_random_uuid();

    insert into public.match_reservations (
        id,
        request_id,
        listener_id,
        state,
        score,
        score_components,
        offered_at,
        expires_at
    ) values (
        v_res_id,
        p_request_id,
        p_listener_id,
        'offered',
        p_score,
        p_score_components,
        v_now,
        v_expires_at
    );

    update public.listener_presence
    set state = 'reserved',
        current_reservation_id = v_res_id
    where listener_id = p_listener_id;

    update public.support_requests
    set state = 'reserved',
        matched_at = v_now
    where id = p_request_id;

    return jsonb_build_object(
        'success', true,
        'reservation_id', v_res_id,
        'request_id', p_request_id,
        'listener_id', p_listener_id,
        'expires_at', v_expires_at
    );
end;
$$;

-- 2. Atomic Accept Reservation Function
create or replace function public.atomic_accept_reservation(
    p_reservation_id uuid,
    p_listener_id uuid
)
returns jsonb
language plpgsql
security definer
as $$
declare
    v_res record;
    v_now timestamptz;
begin
    v_now := timezone('utc', now());

    -- Lock reservation
    select id, request_id, listener_id, state, expires_at into v_res
    from public.match_reservations
    where id = p_reservation_id
    for update;

    if not found then
        return jsonb_build_object('success', false, 'error', 'Reservation not found', 'code', 'RESERVATION_NOT_FOUND');
    end if;

    if v_res.listener_id <> p_listener_id then
        return jsonb_build_object('success', false, 'error', 'Reservation does not belong to this listener', 'code', 'LISTENER_MISMATCH');
    end if;

    if v_res.state <> 'offered' then
        return jsonb_build_object('success', false, 'error', 'Reservation is not in offered state (current: ' || v_res.state || ')', 'code', 'INVALID_STATE');
    end if;

    -- Check if expired
    if v_now >= v_res.expires_at then
        -- Deterministic transition to expired
        update public.match_reservations set state = 'expired' where id = p_reservation_id;
        update public.support_requests set state = 'queued' where id = v_res.request_id and state = 'reserved';
        update public.listener_presence set state = 'available', current_reservation_id = null where listener_id = v_res.listener_id and state = 'reserved';
        return jsonb_build_object('success', false, 'error', 'Reservation offer has expired', 'code', 'OFFER_EXPIRED');
    end if;

    -- Accept transition
    update public.match_reservations
    set state = 'accepted',
        accepted_at = v_now
    where id = p_reservation_id;

    update public.support_requests
    set state = 'accepted'
    where id = v_res.request_id;

    -- Listener remains reserved ready for session room connection
    update public.listener_presence
    set state = 'reserved'
    where listener_id = v_res.listener_id;

    return jsonb_build_object(
        'success', true,
        'reservation_id', p_reservation_id,
        'request_id', v_res.request_id,
        'status', 'accepted'
    );
end;
$$;

-- 3. Atomic Decline Reservation Function
create or replace function public.atomic_decline_reservation(
    p_reservation_id uuid,
    p_listener_id uuid
)
returns jsonb
language plpgsql
security definer
as $$
declare
    v_res record;
begin
    -- Lock reservation
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

    if v_res.state <> 'offered' then
        return jsonb_build_object('success', false, 'error', 'Reservation is not offered (current: ' || v_res.state || ')', 'code', 'INVALID_STATE');
    end if;

    -- Atomic transition: reservation declined, request back to queued, listener back to available
    update public.match_reservations
    set state = 'declined'
    where id = p_reservation_id;

    update public.support_requests
    set state = 'queued'
    where id = v_res.request_id;

    update public.listener_presence
    set state = 'available',
        current_reservation_id = null
    where listener_id = v_res.listener_id;

    return jsonb_build_object(
        'success', true,
        'reservation_id', p_reservation_id,
        'request_id', v_res.request_id,
        'status', 'declined'
    );
end;
$$;

-- 4. Atomic Expire Reservation Function
create or replace function public.atomic_expire_reservation(
    p_reservation_id uuid
)
returns jsonb
language plpgsql
security definer
as $$
declare
    v_res record;
begin
    -- Lock reservation
    select id, request_id, listener_id, state into v_res
    from public.match_reservations
    where id = p_reservation_id
    for update;

    if not found then
        return jsonb_build_object('success', false, 'error', 'Reservation not found', 'code', 'RESERVATION_NOT_FOUND');
    end if;

    if v_res.state <> 'offered' then
        return jsonb_build_object('success', false, 'error', 'Reservation is not offered (already ' || v_res.state || ')', 'code', 'INVALID_STATE');
    end if;

    update public.match_reservations
    set state = 'expired'
    where id = p_reservation_id;

    update public.support_requests
    set state = 'queued'
    where id = v_res.request_id;

    update public.listener_presence
    set state = 'available',
        current_reservation_id = null
    where listener_id = v_res.listener_id;

    return jsonb_build_object(
        'success', true,
        'reservation_id', p_reservation_id,
        'request_id', v_res.request_id,
        'status', 'expired'
    );
end;
$$;
