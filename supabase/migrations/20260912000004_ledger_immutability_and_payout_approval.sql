-- Migration: 20260912000004_ledger_immutability_and_payout_approval.sql
-- Description: Two database-level guarantees the code previously only claimed.
--
-- 1. The ledger is append-only for real: an UPDATE or DELETE on
--    `ledger_entries` raises, so no code path (or operator) can rewrite
--    financial history. Corrections are compensating entries.
-- 2. Payout approval has a state precondition: only a batch in
--    `pending_approval` with no approver can be approved. Re-approving an
--    executed or rejected batch is refused instead of silently rewriting an
--    audited decision.
--    Separation of duties (approver <> creator) is deliberately NOT enforced at
--    MVP scale; the creator/approver pair is recorded in the audit trail for
--    review, and it remains an explicit launch-gate item.

-- ---------------------------------------------------------------------------
-- 1. Append-only ledger
-- ---------------------------------------------------------------------------
create or replace function public.prevent_ledger_mutation()
returns trigger
language plpgsql
as $$
begin
    raise exception 'ledger_entries is append-only: % is not permitted (post a compensating entry instead)', tg_op
        using errcode = 'restrict_violation';
end;
$$;

drop trigger if exists trg_ledger_entries_append_only on public.ledger_entries;

create trigger trg_ledger_entries_append_only
    before update or delete on public.ledger_entries
    for each row execute function public.prevent_ledger_mutation();

-- The same guarantee for the audit trail: it must never be rewritten.
create or replace function public.prevent_audit_event_mutation()
returns trigger
language plpgsql
as $$
begin
    raise exception 'audit_events is append-only: % is not permitted', tg_op
        using errcode = 'restrict_violation';
end;
$$;

drop trigger if exists trg_audit_events_append_only on public.audit_events;

create trigger trg_audit_events_append_only
    before update or delete on public.audit_events
    for each row execute function public.prevent_audit_event_mutation();

-- ---------------------------------------------------------------------------
-- 2. Payout approval with a state precondition
-- ---------------------------------------------------------------------------
create or replace function public.atomic_approve_payout_batch(
    p_batch_id uuid,
    p_approver_id uuid,
    p_approver_role text default 'finance'
)
returns jsonb
language plpgsql
security definer
as $$
declare
    v_batch record;
    v_now timestamptz;
begin
    v_now := timezone('utc', now());

    select id, status, total_paise, created_by, approved_by into v_batch
    from public.payout_batches
    where id = p_batch_id
    for update;

    if not found then
        return jsonb_build_object('success', false, 'error', 'Payout batch not found', 'code', 'BATCH_NOT_FOUND');
    end if;

    if v_batch.status = 'approved' then
        return jsonb_build_object(
            'success', false,
            'error', 'Payout batch has already been approved',
            'code', 'ALREADY_APPROVED'
        );
    end if;

    if v_batch.status <> 'pending_approval' then
        return jsonb_build_object(
            'success', false,
            'error', 'Only a batch pending approval can be approved (current: ' || v_batch.status || ')',
            'code', 'INVALID_BATCH_STATE'
        );
    end if;

    update public.payout_batches
    set status = 'approved',
        approved_by = p_approver_id,
        approved_at = v_now
    where id = v_batch.id;

    insert into public.audit_events (
        actor_id, actor_role, action, entity_type, entity_id, metadata, created_at
    ) values (
        p_approver_id,
        p_approver_role,
        'payout_batch_approved',
        'payout_batch',
        v_batch.id,
        jsonb_build_object(
            'total_paise', v_batch.total_paise,
            'created_by', v_batch.created_by,
            'approved_by', p_approver_id,
            'same_person_as_creator', v_batch.created_by is not distinct from p_approver_id
        ),
        v_now
    );

    return jsonb_build_object(
        'success', true,
        'batch_id', v_batch.id,
        'status', 'approved',
        'total_paise', v_batch.total_paise,
        'approved_by', p_approver_id,
        'approved_at', v_now
    );
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. ACL sweep — service role only.
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
