-- Migration: 20260903000005_atomic_safety_cases.sql
-- Description: ACID transaction to create safety cases, terminate active sessions safely, release listeners, and write audit events

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
    v_case_id uuid;
    v_now timestamptz;
begin
    v_now := timezone('utc', now());

    -- Step 1: Check if active/open safety case already exists for this session (Idempotency)
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

    -- Step 2: Lock and inspect session
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

    -- Step 3: If session is active/connecting, immediately terminate with safety_ended
    if v_sess.state in ('created', 'connecting', 'active') then
        update public.sessions
        set state = 'safety_ended',
            ended_at = v_now,
            end_reason = 'safety_escalation'
        where id = v_sess.id;

        -- Release support request
        update public.support_requests
        set state = 'completed'
        where id = v_sess.request_id;

        -- Release listener presence back to available
        update public.listener_presence
        set state = 'available',
            current_reservation_id = null,
            heartbeat_at = v_now
        where listener_id = v_sess.listener_id;
    end if;

    -- Step 4: Insert new safety case
    v_case_id := gen_random_uuid();

    insert into public.safety_cases (
        id, session_id, opened_by, severity, state, reason_codes, opened_at
    ) values (
        v_case_id, p_session_id, p_reporter_user_id, p_severity, 'open', p_reason_codes, v_now
    );

    -- Step 5: Append-only audit log entry
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
