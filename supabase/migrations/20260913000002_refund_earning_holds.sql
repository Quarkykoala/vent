-- Migration: 20260913000002_refund_earning_holds.sql
-- A refund and a listener payout touch the same economic session. They must not
-- race independently. Refund request now places an unpaid listener earning on
-- hold in the same transaction; already-batched earnings require human finance
-- reconciliation instead of silently moving both payments.

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
    v_now timestamptz := timezone('utc', now());
    v_refund_id uuid;
    v_already_settled bigint;
    v_earning record;
begin
    select id, user_id, amount_paise, currency, state
    into v_pay
    from public.payments
    where id = p_payment_id
    for update;

    if not found then
        return jsonb_build_object('success', false, 'error', 'Payment not found', 'code', 'PAYMENT_NOT_FOUND');
    end if;

    if v_pay.state = 'refunded' then
        return jsonb_build_object('success', false, 'error', 'Payment has already been refunded', 'code', 'ALREADY_REFUNDED');
    end if;

    if v_pay.state not in ('captured', 'partially_refunded') then
        return jsonb_build_object('success', false, 'error', 'Cannot refund payment in state: ' || v_pay.state, 'code', 'INVALID_PAYMENT_STATE');
    end if;

    if exists (
        select 1 from public.refunds
        where payment_id = v_pay.id
          and state in ('pending_provider', 'provider_accepted', 'ambiguous')
    ) then
        return jsonb_build_object('success', false, 'error', 'A refund for this payment is already in flight', 'code', 'REFUND_IN_FLIGHT');
    end if;

    select coalesce(sum(amount_paise), 0) into v_already_settled
    from public.refunds
    where payment_id = v_pay.id and state = 'settled';

    if p_refund_amount_paise <= 0
       or p_refund_amount_paise + v_already_settled > v_pay.amount_paise then
        return jsonb_build_object('success', false, 'error', 'Invalid refund amount (would exceed the captured amount)', 'code', 'INVALID_REFUND_AMOUNT');
    end if;

    -- Lock any earning tied to this payment before deciding whether the refund
    -- may proceed. If a payout batch has already claimed it, automatic refund
    -- is unsafe: finance must reconcile the two external cash movements.
    select e.id, e.state, e.payout_batch_id
    into v_earning
    from public.listener_earnings e
    join public.sessions s on s.id = e.session_id
    join public.support_requests sr on sr.id = s.request_id
    where sr.payment_order_id = v_pay.id
    for update of e;

    if found and v_earning.state in ('batched', 'paid') then
        return jsonb_build_object(
            'success', false,
            'error', 'Listener earning is already in payout settlement; finance reconciliation is required before refunding.',
            'code', 'PAYOUT_IN_FLIGHT',
            'payout_batch_id', v_earning.payout_batch_id
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

    if v_earning.id is not null and v_earning.state = 'earned' then
        update public.listener_earnings
        set state = 'held', hold_reason = 'refund:' || v_refund_id::text
        where id = v_earning.id and state = 'earned';
    end if;

    update public.payments set state = 'refund_pending' where id = v_pay.id;

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
            'reason', p_reason,
            'listener_earning_id', v_earning.id,
            'listener_earning_held', coalesce(v_earning.state = 'earned', false)
        ),
        v_now
    );

    return jsonb_build_object(
        'success', true,
        'payment_id', v_pay.id,
        'refund_id', v_refund_id,
        'refund_amount_paise', p_refund_amount_paise,
        'state', 'pending_provider',
        'listener_earning_id', v_earning.id,
        'requested_at', v_now
    );
end;
$$;

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
    v_now timestamptz := timezone('utc', now());
    v_event_id uuid;
    v_total_settled bigint;
    v_earning_id uuid;
begin
    if p_state not in ('provider_accepted', 'settled', 'failed', 'ambiguous') then
        return jsonb_build_object('success', false, 'error', 'Unsupported refund state: ' || p_state, 'code', 'INVALID_REFUND_STATE');
    end if;

    select id, payment_id, amount_paise, currency, state into v_refund
    from public.refunds where id = p_refund_id for update;

    if not found then
        return jsonb_build_object('success', false, 'error', 'Refund not found', 'code', 'REFUND_NOT_FOUND');
    end if;

    if v_refund.state = 'settled' then
        return jsonb_build_object('success', true, 'refund_id', v_refund.id, 'state', 'settled', 'idempotent_replay', true);
    end if;

    if v_refund.state = 'failed' then
        return jsonb_build_object('success', false, 'error', 'Refund has already been marked failed', 'code', 'REFUND_ALREADY_FAILED');
    end if;

    select id, user_id, amount_paise, state into v_pay
    from public.payments where id = v_refund.payment_id for update;

    if not found then
        return jsonb_build_object('success', false, 'error', 'Payment not found', 'code', 'PAYMENT_NOT_FOUND');
    end if;

    select e.id into v_earning_id
    from public.listener_earnings e
    join public.sessions s on s.id = e.session_id
    join public.support_requests sr on sr.id = s.request_id
    where sr.payment_order_id = v_pay.id
    for update of e;

    update public.refunds
    set state = p_state,
        provider_refund_id = coalesce(p_provider_refund_id, provider_refund_id),
        provider_detail = coalesce(p_detail, provider_detail),
        updated_at = v_now,
        settled_at = case when p_state = 'settled' then v_now else settled_at end
    where id = v_refund.id;

    if p_state = 'settled' then
        v_event_id := gen_random_uuid();
        insert into public.ledger_entries (
            id, event_id, account_code, direction, amount_paise, currency, reference_type, reference_id, created_at
        ) values
          (gen_random_uuid(), v_event_id, 'customer_service_revenue', 'debit', v_refund.amount_paise, v_refund.currency, 'refund', v_pay.id, v_now),
          (gen_random_uuid(), v_event_id, 'cash_pg_clearing', 'credit', v_refund.amount_paise, v_refund.currency, 'refund', v_pay.id, v_now);

        select coalesce(sum(amount_paise), 0) into v_total_settled
        from public.refunds where payment_id = v_pay.id and state = 'settled';

        update public.payments
        set state = case when v_total_settled >= v_pay.amount_paise then 'refunded' else 'partially_refunded' end
        where id = v_pay.id;

        -- Refund settlement does not guess whether the listener forfeits their
        -- earned compensation. Keep the liability held until an explicit finance
        -- disposition is recorded; this is economically truthful and prevents an
        -- automatic double-payment race.
        if v_earning_id is not null then
            update public.listener_earnings
            set state = 'held', hold_reason = 'refund_settled:' || v_refund.id::text || ':finance_disposition_required'
            where id = v_earning_id and state = 'held';
        end if;

        insert into public.audit_events (
            actor_id, actor_role, action, entity_type, entity_id, metadata, created_at
        ) values (
            p_actor_id, p_actor_role, 'payment_refunded', 'payment', v_pay.id,
            jsonb_build_object(
                'refund_id', v_refund.id,
                'refund_amount_paise', v_refund.amount_paise,
                'provider_refund_id', p_provider_refund_id,
                'total_settled_paise', v_total_settled,
                'listener_earning_id', v_earning_id,
                'listener_earning_disposition', case when v_earning_id is null then 'none' else 'held_for_finance_review' end
            ),
            v_now
        );
    elsif p_state = 'failed' then
        update public.payments
        set state = case
            when exists (select 1 from public.refunds r where r.payment_id = v_pay.id and r.state = 'settled')
                then 'partially_refunded'
            else 'captured'
        end
        where id = v_pay.id;

        if v_earning_id is not null then
            update public.listener_earnings
            set state = 'earned', hold_reason = null
            where id = v_earning_id
              and state = 'held'
              and hold_reason = 'refund:' || v_refund.id::text;
        end if;

        insert into public.audit_events (
            actor_id, actor_role, action, entity_type, entity_id, metadata, created_at
        ) values (
            p_actor_id, p_actor_role, 'payment_refund_failed', 'payment', v_pay.id,
            jsonb_build_object('refund_id', v_refund.id, 'detail', p_detail, 'listener_earning_released', v_earning_id),
            v_now
        );
    elsif p_state = 'ambiguous' then
        insert into public.audit_events (
            actor_id, actor_role, action, entity_type, entity_id, metadata, created_at
        ) values (
            p_actor_id, p_actor_role, 'payment_refund_ambiguous', 'payment', v_pay.id,
            jsonb_build_object('refund_id', v_refund.id, 'detail', p_detail, 'listener_earning_id', v_earning_id),
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
        'listener_earning_id', v_earning_id,
        'updated_at', v_now
    );
end;
$$;

-- Refresh ACLs for the replaced SECURITY DEFINER functions.
do $$
declare
    fn record;
begin
    for fn in
        select p.proname, pg_get_function_identity_arguments(p.oid) as identity_args
        from pg_proc p
        join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public'
          and p.proname in ('atomic_request_refund', 'atomic_mark_refund_state')
    loop
        execute format('alter function public.%I(%s) set search_path = public, pg_temp', fn.proname, fn.identity_args);
        execute format('revoke all on function public.%I(%s) from public', fn.proname, fn.identity_args);
        execute format('revoke all on function public.%I(%s) from anon', fn.proname, fn.identity_args);
        execute format('revoke all on function public.%I(%s) from authenticated', fn.proname, fn.identity_args);
        execute format('grant execute on function public.%I(%s) to service_role', fn.proname, fn.identity_args);
    end loop;
end;
$$;
