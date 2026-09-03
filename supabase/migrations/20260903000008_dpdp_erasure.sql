-- Migration: 20260903000008_dpdp_erasure.sql
-- Description: DPDP 2025 compliant user erasure procedure preserving financial ledger integrity

create or replace function public.atomic_dpdp_user_erasure(
    p_user_id uuid,
    p_actor_id uuid,
    p_actor_role text
)
returns jsonb
language plpgsql
security definer
as $$
declare
    v_user record;
    v_active_sess_count int;
    v_now timestamptz;
    v_old_auth_id text;
begin
    v_now := timezone('utc', now());

    -- Step 1: Lock user record
    select id, auth_user_id, status into v_user
    from public.users
    where id = p_user_id
    for update;

    if not found then
        return jsonb_build_object(
            'success', false,
            'error', 'User not found',
            'code', 'USER_NOT_FOUND'
        );
    end if;

    if v_user.status = 'deleted' then
        return jsonb_build_object(
            'success', false,
            'error', 'User has already been erased',
            'code', 'ALREADY_ERASED'
        );
    end if;

    -- Step 2: Invariant Check - No active sessions
    select count(*) into v_active_sess_count
    from public.sessions
    where user_id = p_user_id
      and state in ('created', 'connecting', 'active');

    if v_active_sess_count > 0 then
        return jsonb_build_object(
            'success', false,
            'error', 'Cannot erase user account while a session is active',
            'code', 'ACTIVE_SESSION_EXISTS'
        );
    end if;

    v_old_auth_id := v_user.auth_user_id;

    -- Step 3: Scrub personal identifiers from users table
    update public.users
    set handle = 'deleted_' || substr(p_user_id::text, 1, 8),
        auth_user_id = gen_random_uuid(),
        status = 'deleted'
    where id = p_user_id;

    -- Step 4: Scrub sensitive free-text/topic info from support requests
    update public.support_requests
    set topic = 'erased',
        language = 'erased'
    where user_id = p_user_id;

    -- Step 5: Remove blocks associated with user
    delete from public.blocks
    where blocker_id = p_user_id or blocked_id = p_user_id;

    -- Step 6: Immutable audit log entry
    insert into public.audit_events (
        actor_id, actor_role, action, entity_type, entity_id, metadata, created_at
    ) values (
        p_actor_id,
        p_actor_role,
        'user_erased_dpdp',
        'user',
        p_user_id,
        jsonb_build_object('dpdp_compliance', true, 'retained_financial_records', true),
        v_now
    );

    return jsonb_build_object(
        'success', true,
        'user_id', p_user_id,
        'auth_user_id', v_old_auth_id,
        'erased_at', v_now
    );
end;
$$;
