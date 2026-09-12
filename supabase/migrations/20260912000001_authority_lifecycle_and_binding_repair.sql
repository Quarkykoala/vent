-- Migration: 20260912000001_authority_lifecycle_and_binding_repair.sql
-- Description: Review-lead repairs for database authority and lifecycle correctness.
--
-- 1. One captured payment authorizes exactly one support request.
--    Before this migration `atomic_capture_payment_webhook` fanned out to every
--    open request of the payer (`payment_order_id is null or = payment.id`), so a
--    single captured payment queued and funded two unrelated requests. The
--    transition is now bound to the request the order was created for, and a
--    partial unique index makes the relation constraint-backed.
-- 2. Privileged function ACL refresh. `atomic_accept_session_recovery` was
--    created after the 20260905 lockdown and only revoked anon/authenticated,
--    leaving the default PUBLIC EXECUTE grant in place: anonymous callers could
--    invoke a SECURITY DEFINER function. The whole schema is swept again.
-- 3. Terminal states are inert. Accept, reservation and recovery paths can no
--    longer mutate a request, session or presence once the session/request has
--    reached a terminal state.
-- 4. A finished session settles its reservation. Accepted reservations were
--    never released, and the partial unique index on (listener_id) treats
--    `accepted` as active forever, so a listener could serve exactly one session.
-- 5. Safety cases are participant-scoped and never resurrect terminal state.

-- ---------------------------------------------------------------------------
-- 1. One payment -> exactly one support request
--
-- Pre-migration data repair: the live local database carries the defect this
-- migration removes — one captured payment that queued two requests of the same
-- payer. Keep the binding on exactly one request per payment (the earliest
-- created) and return the surplus rows to their accurate unpaid state where
-- they never progressed past queueing. Rows that did progress keep their
-- lifecycle history and only lose the duplicate link.
-- ---------------------------------------------------------------------------
with ranked as (
    select
        sr.id,
        row_number() over (partition by sr.payment_order_id order by sr.created_at asc, sr.id asc) as rn
    from public.support_requests sr
    where sr.payment_order_id is not null
)
update public.support_requests sr
set payment_order_id = null,
    state = 'created',
    queued_at = null,
    matched_at = null
from ranked
where sr.id = ranked.id
  and ranked.rn > 1
  and not exists (select 1 from public.match_reservations r where r.request_id = sr.id)
  and not exists (select 1 from public.sessions s where s.request_id = sr.id);

with ranked as (
    select
        sr.id,
        row_number() over (partition by sr.payment_order_id order by sr.created_at asc, sr.id asc) as rn
    from public.support_requests sr
    where sr.payment_order_id is not null
)
update public.support_requests sr
set payment_order_id = null
from ranked
where sr.id = ranked.id
  and ranked.rn > 1;

create unique index if not exists idx_support_requests_payment_order_unique
    on public.support_requests(payment_order_id)
    where payment_order_id is not null;

create or replace function public.atomic_capture_payment_webhook(
    p_provider_order_id text,
    p_provider_payment_id text,
    p_amount_paise bigint,
    p_currency text,
    p_idempotency_key text,
    p_idempotency_response jsonb
)
returns jsonb
language plpgsql
security definer
as $$
declare
    v_pay record;
    v_req record;
    v_now timestamptz;
    v_event_id uuid;
    v_queued_request_id uuid;
begin
    v_now := timezone('utc', now());

    -- Step 1: Idempotency guard check
    if exists (select 1 from public.idempotency_keys where key = p_idempotency_key) then
        select response into v_req from public.idempotency_keys where key = p_idempotency_key;
        select id into v_pay from public.payments where provider_order_id = p_provider_order_id;
        return jsonb_build_object(
            'success', true,
            'idempotent_replay', true,
            'payment_id', v_pay.id,
            'message', 'Webhook event already processed',
            'response', v_req.response
        );
    end if;

    -- Step 2: Lock payment record
    select id, user_id, provider_order_id, amount_paise, currency, state into v_pay
    from public.payments
    where provider_order_id = p_provider_order_id
    for update;

    if not found then
        return jsonb_build_object(
            'success', false,
            'error', 'Payment record not found for provider order ID: ' || p_provider_order_id,
            'code', 'PAYMENT_NOT_FOUND'
        );
    end if;

    -- Step 3: Validate amount and currency
    if v_pay.amount_paise <> p_amount_paise then
        return jsonb_build_object(
            'success', false,
            'error', 'Amount mismatch: expected ' || v_pay.amount_paise || ' paise, got ' || p_amount_paise,
            'code', 'AMOUNT_MISMATCH'
        );
    end if;

    if v_pay.currency <> p_currency then
        return jsonb_build_object(
            'success', false,
            'error', 'Currency mismatch: expected ' || v_pay.currency || ', got ' || p_currency,
            'code', 'CURRENCY_MISMATCH'
        );
    end if;

    -- Step 4: Check state
    if v_pay.state = 'captured' then
        insert into public.idempotency_keys (key, operation, response, created_at)
        values (p_idempotency_key, 'payment_capture_replay', p_idempotency_response, v_now)
        on conflict (key) do nothing;

        return jsonb_build_object(
            'success', true,
            'idempotent_replay', true,
            'payment_id', v_pay.id
        );
    end if;

    if v_pay.state not in ('created', 'authorized') then
        return jsonb_build_object(
            'success', false,
            'error', 'Invalid payment state for capture: ' || v_pay.state,
            'code', 'INVALID_PAYMENT_STATE'
        );
    end if;

    -- Step 5: Update payment state to captured
    update public.payments
    set state = 'captured',
        provider_payment_id = p_provider_payment_id,
        captured_at = v_now
    where id = v_pay.id;

    -- Step 6: Post balanced double-entry ledger entries
    v_event_id := gen_random_uuid();

    insert into public.ledger_entries (
        id, event_id, account_code, direction, amount_paise, currency, reference_type, reference_id, created_at
    ) values (
        gen_random_uuid(), v_event_id, 'cash_pg_clearing', 'debit', p_amount_paise, p_currency::bpchar, 'payment', v_pay.id, v_now
    );

    insert into public.ledger_entries (
        id, event_id, account_code, direction, amount_paise, currency, reference_type, reference_id, created_at
    ) values (
        gen_random_uuid(), v_event_id, 'customer_service_revenue', 'credit', p_amount_paise, p_currency::bpchar, 'payment', v_pay.id, v_now
    );

    -- Step 7: Queue EXACTLY the request this order was created for.
    -- The order-creation route binds `support_requests.payment_order_id` to the
    -- payment before the client can ever pay, so a capture may only entitle that
    -- single request. No fan-out to other open requests of the same payer.
    update public.support_requests
    set state = 'queued',
        queued_at = v_now
    where payment_order_id = v_pay.id
      and state in ('created', 'paid')
    returning id into v_queued_request_id;

    -- Step 8: Persist durable idempotency record
    insert into public.idempotency_keys (key, operation, response, created_at)
    values (p_idempotency_key, 'payment_capture', p_idempotency_response, v_now);

    return jsonb_build_object(
        'success', true,
        'payment_id', v_pay.id,
        'provider_order_id', p_provider_order_id,
        'provider_payment_id', p_provider_payment_id,
        'amount_paise', p_amount_paise,
        'state', 'captured',
        'event_id', v_event_id,
        'queued_request_id', v_queued_request_id,
        'entitlement_bound', v_queued_request_id is not null
    );
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. Terminal sessions are inert on reservation acceptance
-- ---------------------------------------------------------------------------
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
    v_req record;
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

    -- Lock the request. A terminal request can never be resurrected by an offer
    -- that outlived it (cancelled, expired, completed, safety-ended, ...).
    select id, state into v_req
    from public.support_requests
    where id = v_res.request_id
    for update;

    if not found then
        return jsonb_build_object('success', false, 'error', 'Support request not found', 'code', 'REQUEST_NOT_FOUND');
    end if;

    if v_req.state <> 'reserved' then
        return jsonb_build_object(
            'success', false,
            'error', 'Support request is not awaiting acceptance (current: ' || v_req.state || ')',
            'code', 'TERMINAL_STATE',
            'request_state', v_req.state
        );
    end if;

    -- Check if expired
    if v_now >= v_res.expires_at then
        update public.match_reservations set state = 'expired' where id = p_reservation_id;
        update public.support_requests set state = 'queued' where id = v_res.request_id and state = 'reserved';
        update public.listener_presence
        set state = 'available', current_reservation_id = null
        where listener_id = v_res.listener_id
          and state = 'reserved'
          and (current_reservation_id is null or current_reservation_id = p_reservation_id);
        return jsonb_build_object('success', false, 'error', 'Reservation offer has expired', 'code', 'OFFER_EXPIRED');
    end if;

    -- Accept transition
    update public.match_reservations
    set state = 'accepted',
        accepted_at = v_now
    where id = p_reservation_id;

    update public.support_requests
    set state = 'accepted'
    where id = v_res.request_id and state = 'reserved';

    -- Listener remains reserved ready for session room connection
    update public.listener_presence
    set state = 'reserved'
    where listener_id = v_res.listener_id
      and state in ('reserved', 'available');

    return jsonb_build_object(
        'success', true,
        'reservation_id', p_reservation_id,
        'request_id', v_res.request_id,
        'status', 'accepted'
    );
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. Session recovery is terminal-safe and presence-safe
-- ---------------------------------------------------------------------------
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
    v_req record;
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

    -- Lock the request and refuse to touch anything once it is terminal.
    select id, state, user_id into v_req
    from public.support_requests
    where id = v_res.request_id
    for update;

    if not found then
        return jsonb_build_object('success', false, 'error', 'Support request not found', 'code', 'REQUEST_NOT_FOUND');
    end if;

    if v_req.state not in ('accepted', 'connected') then
        return jsonb_build_object(
            'success', false,
            'error', 'Support request is not in a recoverable state (current: ' || v_req.state || ')',
            'code', 'TERMINAL_STATE',
            'request_state', v_req.state
        );
    end if;

    -- Durable recovery: a session created by an earlier attempt wins, but only
    -- while that session is itself still live.
    select id, room_name, state into v_sess
    from public.sessions
    where request_id = v_res.request_id;

    if found then
        if v_sess.state in ('ended', 'failed', 'safety_ended') then
            return jsonb_build_object(
                'success', false,
                'error', 'Session for this request has already finished (current: ' || v_sess.state || ')',
                'code', 'TERMINAL_STATE',
                'request_state', v_req.state,
                'session_id', v_sess.id,
                'session_state', v_sess.state
            );
        end if;

        update public.support_requests
        set state = 'connected'
        where id = v_res.request_id and state = 'accepted';

        update public.listener_presence
        set state = 'reserved'
        where listener_id = v_res.listener_id
          and state <> 'reserved'
          and (current_reservation_id is null or current_reservation_id = p_reservation_id);

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
        values (v_res.request_id, v_req.user_id, v_res.listener_id, v_room, 'created', v_now)
        returning id, room_name into v_sess;
    exception when unique_violation then
        select id, room_name, state into v_sess
        from public.sessions
        where request_id = v_res.request_id;

        if v_sess.state in ('ended', 'failed', 'safety_ended') then
            return jsonb_build_object(
                'success', false,
                'error', 'Session for this request has already finished (current: ' || v_sess.state || ')',
                'code', 'TERMINAL_STATE',
                'request_state', v_req.state,
                'session_id', v_sess.id,
                'session_state', v_sess.state
            );
        end if;

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
    where listener_id = v_res.listener_id
      and state <> 'reserved'
      and (current_reservation_id is null or current_reservation_id = p_reservation_id);

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

-- ---------------------------------------------------------------------------
-- 4. Ending a session settles its reservation
--    `accepted` reservations are "active" for the partial unique indexes; a
--    session that ends without settling them makes the listener permanently
--    un-reservable. The reservation is closed, presence released, and the
--    terminal state is never reopened.
-- ---------------------------------------------------------------------------
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
    if v_sess.state in ('ended', 'safety_ended', 'failed') then
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

    -- Step 7: Transition support request to completed (never from a terminal state)
    update public.support_requests
    set state = 'completed'
    where id = v_sess.request_id
      and state not in ('completed', 'cancelled', 'expired', 'declined', 'payment_failed',
                        'offer_expired', 'technical_failed', 'safety_escalated');

    -- Step 8: Release listener presence back to available
    update public.listener_presence
    set state = 'available',
        current_reservation_id = null,
        heartbeat_at = v_now
    where listener_id = v_sess.listener_id
      and state in ('reserved', 'in_session');

    -- Step 9: Settle the reservation so the listener is matchable again
    update public.match_reservations
    set state = 'cancelled'
    where request_id = v_sess.request_id
      and state in ('offered', 'accepted');

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

-- ---------------------------------------------------------------------------
-- 5. Safety cases: participant-scoped, idempotent under concurrency, and
--    never resurrecting a finished session.
-- ---------------------------------------------------------------------------
create or replace function public.atomic_create_safety_case(
    p_session_id uuid,
    p_reporter_user_id uuid,
    p_severity text,
    p_reason_codes text[],
    p_reporter_role text default 'listener'
)
returns jsonb
language plpgsql
security definer
as $$
declare
    v_sess record;
    v_existing record;
    v_listener_user_id uuid;
    v_case_id uuid;
    v_now timestamptz;
begin
    v_now := timezone('utc', now());

    -- Step 1: Lock and inspect session FIRST so concurrent reporters serialize
    -- before the duplicate check (the previous order had a TOCTOU race).
    select id, request_id, user_id, listener_id, state
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

    -- Step 2: The reporter must be a participant of THIS session. Room or
    -- session UUID knowledge is not authorization to terminate someone else's
    -- session.
    select user_id into v_listener_user_id
    from public.listener_profiles
    where id = v_sess.listener_id;

    if p_reporter_user_id <> v_sess.user_id
       and (v_listener_user_id is null or p_reporter_user_id <> v_listener_user_id)
    then
        return jsonb_build_object(
            'success', false,
            'error', 'Forbidden: Reporter is not a participant in this session',
            'code', 'UNAUTHORIZED_REPORTER'
        );
    end if;

    -- Step 3: Idempotency — one live case per session.
    select id, severity, state, opened_at into v_existing
    from public.safety_cases
    where session_id = p_session_id
      and state in ('open', 'acknowledged', 'escalated')
    order by opened_at desc
    limit 1;

    if found then
        return jsonb_build_object(
            'success', true,
            'case_id', v_existing.id,
            'session_id', p_session_id,
            'severity', v_existing.severity,
            'state', v_existing.state,
            'idempotent_replay', true,
            'message', 'Safety case already open for this session'
        );
    end if;

    -- Step 4: If the session is live, terminate it with safety_ended. Terminal
    -- sessions are never reopened or re-terminated.
    if v_sess.state in ('created', 'connecting', 'active') then
        update public.sessions
        set state = 'safety_ended',
            ended_at = v_now,
            end_reason = 'safety_escalation'
        where id = v_sess.id;

        update public.support_requests
        set state = 'safety_escalated'
        where id = v_sess.request_id
          and state not in ('completed', 'cancelled', 'expired', 'declined', 'payment_failed',
                            'offer_expired', 'technical_failed');

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
    end if;

    -- Step 5: Insert new safety case
    v_case_id := gen_random_uuid();

    insert into public.safety_cases (
        id, session_id, opened_by, severity, state, reason_codes, opened_at
    ) values (
        v_case_id, p_session_id, p_reporter_user_id, p_severity, 'open', p_reason_codes, v_now
    );

    -- Step 6: Append-only audit log entry
    insert into public.audit_events (
        actor_id, actor_role, action, entity_type, entity_id, metadata, created_at
    ) values (
        p_reporter_user_id,
        p_reporter_role,
        'safety_case_created',
        'safety_case',
        v_case_id,
        jsonb_build_object(
            'session_id', p_session_id,
            'severity', p_severity,
            'reason_codes', p_reason_codes
        ),
        v_now
    );

    return jsonb_build_object(
        'success', true,
        'case_id', v_case_id,
        'session_id', p_session_id,
        'severity', p_severity,
        'state', 'open',
        'reason_codes', p_reason_codes,
        'created_at', v_now
    );
end;
$$;

-- ---------------------------------------------------------------------------
-- 6. Privileged function ACL refresh
--    Every function in public keeps only the grants it needs: RLS helpers stay
--    callable by anon/authenticated, everything else is service-role only, and
--    PUBLIC never retains the default EXECUTE grant.
-- ---------------------------------------------------------------------------
alter default privileges in schema public revoke execute on functions from public;

do $$
declare
    fn record;
    helper_names text[] := array['current_user_id', 'current_listener_id', 'current_user_role'];
begin
    for fn in
        select
            p.proname,
            pg_get_function_identity_arguments(p.oid) as identity_args
        from pg_proc p
        join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public'
          and p.prokind = 'f'
    loop
        execute format(
            'alter function public.%I(%s) set search_path = public, pg_temp',
            fn.proname, fn.identity_args
        );

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
