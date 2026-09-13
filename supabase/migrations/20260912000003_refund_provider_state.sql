-- Migration: 20260912000003_refund_provider_state.sql
-- Description: Truthful refund lifecycle.
--
-- Before this migration a refund flipped `payments.state` to 'refunded' and
-- posted the compensating ledger journal in one local step, with no provider
-- call anywhere in the codebase. The platform could therefore report a refund
-- the payment provider never performed, and the ledger recorded money movement
-- that had not happened.
--
-- Refunds are now a two-step, provider-aware lifecycle:
--   request  -> refunds row in 'pending_provider', payment 'refund_pending', no ledger effect
--   settle   -> only when the provider (or a human finance owner) confirms:
--               compensating ledger entries + payment 'refunded' / 'partially_refunded'
--   failure  -> payment returns to 'captured' (or 'partially_refunded'), no ledger effect
--   ambiguous/provider_accepted -> recorded as such, still not settled
--
-- Human finance approval remains mandatory for payouts, unchanged.

-- ---------------------------------------------------------------------------
-- 1. payments gains the explicit pending state
-- ---------------------------------------------------------------------------
alter table public.payments drop constraint if exists payments_state_check;
alter table public.payments add constraint payments_state_check
    check (state in ('created', 'authorized', 'captured', 'failed', 'refunded',
                     'partially_refunded', 'refund_pending'));

-- ---------------------------------------------------------------------------
-- 2. refunds table
-- ---------------------------------------------------------------------------
create table if not exists public.refunds (
    id uuid primary key default gen_random_uuid(),
    payment_id uuid not null references public.payments(id) on delete cascade,
    amount_paise bigint not null check (amount_paise > 0),
    currency char(3) not null default 'INR',
    state text not null default 'pending_provider' check (state in (
        'pending_provider', 'provider_accepted', 'settled', 'failed', 'ambiguous'
    )),
    reason text not null,
    provider_refund_id text null,
    provider_detail text null,
    requested_by uuid null references public.users(id),
    requested_by_role text null,
    requested_at timestamptz not null default timezone('utc', now()),
    updated_at timestamptz not null default timezone('utc', now()),
    settled_at timestamptz null
);

create index if not exists idx_refunds_payment on public.refunds(payment_id);
create index if not exists idx_refunds_state on public.refunds(state);

alter table public.refunds enable row level security;
alter table public.refunds force row level security;
revoke all on public.refunds from anon;
revoke all on public.refunds from authenticated;

-- ---------------------------------------------------------------------------
-- 3. Request a refund (no money moves, no ledger effect yet)
-- ---------------------------------------------------------------------------
create or replace function public.atomic_request_refund(
    p_payment_id uuid,
    p_refund_amount_paise bigint,
    p_reason text,
    p_actor_id uuid,
    p_actor_role text
)
returns jsonb
language plpgsql
security definer
as $$
declare
    v_pay record;
    v_now timestamptz;
    v_refund_id uuid;
    v_already_settled bigint;
begin
    v_now := timezone('utc', now());

    select id, user_id, amount_paise, currency, state
    into v_pay
    from public.payments
    where id = p_payment_id
    for update;

    if not found then
        return jsonb_build_object('success', false, 'error', 'Payment not found', 'code', 'PAYMENT_NOT_FOUND');
    end if;

    if v_pay.state in ('refunded') then
        return jsonb_build_object('success', false, 'error', 'Payment has already been refunded', 'code', 'ALREADY_REFUNDED');
    end if;

    if v_pay.state not in ('captured', 'partially_refunded') then
        return jsonb_build_object(
            'success', false,
            'error', 'Cannot refund payment in state: ' || v_pay.state,
            'code', 'INVALID_PAYMENT_STATE'
        );
    end if;

    -- A second in-flight refund for the same payment would double-refund.
    if exists (
        select 1 from public.refunds
        where payment_id = v_pay.id
          and state in ('pending_provider', 'provider_accepted', 'ambiguous')
    ) then
        return jsonb_build_object(
            'success', false,
            'error', 'A refund for this payment is already in flight',
            'code', 'REFUND_IN_FLIGHT'
        );
    end if;

    select coalesce(sum(amount_paise), 0) into v_already_settled
    from public.refunds
    where payment_id = v_pay.id and state = 'settled';

    if p_refund_amount_paise <= 0
       or p_refund_amount_paise + v_already_settled > v_pay.amount_paise then
        return jsonb_build_object(
            'success', false,
            'error', 'Invalid refund amount (would exceed the captured amount)',
            'code', 'INVALID_REFUND_AMOUNT'
        );
    end if;

    v_refund_id := gen_random_uuid();

    insert into public.refunds (
        id, payment_id, amount_paise, currency, state, reason,
        requested_by, requested_by_role, requested_at, updated_at
    ) values (
        v_refund_id, v_pay.id, p_refund_amount_paise, v_pay.currency, 'pending_provider', p_reason,
        p_actor_id, p_actor_role, v_now, v_now
    );

    update public.payments
    set state = 'refund_pending'
    where id = v_pay.id;

    insert into public.audit_events (
        actor_id, actor_role, action, entity_type, entity_id, metadata, created_at
    ) values (
        p_actor_id,
        p_actor_role,
        'payment_refund_requested',
        'payment',
        v_pay.id,
        jsonb_build_object(
            'refund_id', v_refund_id,
            'refund_amount_paise', p_refund_amount_paise,
            'reason', p_reason
        ),
        v_now
    );

    return jsonb_build_object(
        'success', true,
        'payment_id', v_pay.id,
        'refund_id', v_refund_id,
        'refund_amount_paise', p_refund_amount_paise,
        'state', 'pending_provider',
        'requested_at', v_now
    );
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. Record what the provider (or a human finance owner) actually reported.
--    The ledger journal is posted only when the refund settles.
-- ---------------------------------------------------------------------------
create or replace function public.atomic_mark_refund_state(
    p_refund_id uuid,
    p_state text,
    p_provider_refund_id text default null,
    p_detail text default null,
    p_actor_id uuid default null,
    p_actor_role text default 'system'
)
returns jsonb
language plpgsql
security definer
as $$
declare
    v_refund record;
    v_pay record;
    v_now timestamptz;
    v_event_id uuid;
    v_total_settled bigint;
begin
    v_now := timezone('utc', now());

    if p_state not in ('provider_accepted', 'settled', 'failed', 'ambiguous') then
        return jsonb_build_object('success', false, 'error', 'Unsupported refund state: ' || p_state, 'code', 'INVALID_REFUND_STATE');
    end if;

    select id, payment_id, amount_paise, currency, state into v_refund
    from public.refunds
    where id = p_refund_id
    for update;

    if not found then
        return jsonb_build_object('success', false, 'error', 'Refund not found', 'code', 'REFUND_NOT_FOUND');
    end if;

    if v_refund.state = 'settled' then
        return jsonb_build_object(
            'success', true,
            'refund_id', v_refund.id,
            'state', 'settled',
            'idempotent_replay', true
        );
    end if;

    if v_refund.state = 'failed' then
        return jsonb_build_object(
            'success', false,
            'error', 'Refund has already been marked failed',
            'code', 'REFUND_ALREADY_FAILED'
        );
    end if;

    select id, user_id, amount_paise, state into v_pay
    from public.payments
    where id = v_refund.payment_id
    for update;

    if not found then
        return jsonb_build_object('success', false, 'error', 'Payment not found', 'code', 'PAYMENT_NOT_FOUND');
    end if;

    update public.refunds
    set state = p_state,
        provider_refund_id = coalesce(p_provider_refund_id, provider_refund_id),
        provider_detail = coalesce(p_detail, provider_detail),
        updated_at = v_now,
        settled_at = case when p_state = 'settled' then v_now else settled_at end
    where id = v_refund.id;

    if p_state = 'settled' then
        -- Compensating balanced journal, posted once, only on real settlement.
        v_event_id := gen_random_uuid();

        insert into public.ledger_entries (
            id, event_id, account_code, direction, amount_paise, currency, reference_type, reference_id, created_at
        ) values (
            gen_random_uuid(), v_event_id, 'customer_service_revenue', 'debit', v_refund.amount_paise, v_refund.currency, 'refund', v_pay.id, v_now
        );

        insert into public.ledger_entries (
            id, event_id, account_code, direction, amount_paise, currency, reference_type, reference_id, created_at
        ) values (
            gen_random_uuid(), v_event_id, 'cash_pg_clearing', 'credit', v_refund.amount_paise, v_refund.currency, 'refund', v_pay.id, v_now
        );

        select coalesce(sum(amount_paise), 0) into v_total_settled
        from public.refunds
        where payment_id = v_pay.id and state = 'settled';

        update public.payments
        set state = case when v_total_settled >= v_pay.amount_paise then 'refunded' else 'partially_refunded' end
        where id = v_pay.id;

        insert into public.audit_events (
            actor_id, actor_role, action, entity_type, entity_id, metadata, created_at
        ) values (
            p_actor_id, p_actor_role, 'payment_refunded', 'payment', v_pay.id,
            jsonb_build_object(
                'refund_id', v_refund.id,
                'refund_amount_paise', v_refund.amount_paise,
                'provider_refund_id', p_provider_refund_id,
                'total_settled_paise', v_total_settled
            ),
            v_now
        );
    elsif p_state = 'failed' then
        -- No money moved: the payment returns to its captured state so the
        -- books and the operator view stay truthful.
        update public.payments
        set state = case
            when exists (select 1 from public.refunds r where r.payment_id = v_pay.id and r.state = 'settled')
                then 'partially_refunded'
            else 'captured'
        end
        where id = v_pay.id;

        insert into public.audit_events (
            actor_id, actor_role, action, entity_type, entity_id, metadata, created_at
        ) values (
            p_actor_id, p_actor_role, 'payment_refund_failed', 'payment', v_pay.id,
            jsonb_build_object('refund_id', v_refund.id, 'detail', p_detail),
            v_now
        );
    elsif p_state = 'ambiguous' then
        insert into public.audit_events (
            actor_id, actor_role, action, entity_type, entity_id, metadata, created_at
        ) values (
            p_actor_id, p_actor_role, 'payment_refund_ambiguous', 'payment', v_pay.id,
            jsonb_build_object('refund_id', v_refund.id, 'detail', p_detail),
            v_now
        );
    end if;

    return jsonb_build_object(
        'success', true,
        'refund_id', v_refund.id,
        'payment_id', v_pay.id,
        'refund_amount_paise', v_refund.amount_paise,
        'state', p_state,
        'provider_refund_id', p_provider_refund_id,
        'payment_state', (select state from public.payments where id = v_pay.id),
        'updated_at', v_now
    );
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. `atomic_execute_refund` no longer exists: it claimed a provider outcome it
--    never obtained. Callers must request a refund and then record the real
--    provider result.
-- ---------------------------------------------------------------------------
drop function if exists public.atomic_execute_refund(uuid, bigint, text, uuid, text);

-- ---------------------------------------------------------------------------
-- 6. ACL sweep — service role only.
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
