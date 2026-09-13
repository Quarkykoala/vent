-- Migration: 20260903000006_finance_refunds_payouts.sql
-- Description: Refund execution atomic procedure, payout_batches table, and human approval enforcement

-- 1. Create payout_batches table
create table if not exists public.payout_batches (
    id uuid primary key default gen_random_uuid(),
    period_start timestamptz not null,
    period_end timestamptz not null,
    total_paise bigint not null check (total_paise >= 0),
    status text not null check (status in ('draft', 'pending_approval', 'approved', 'executed', 'rejected')),
    created_by uuid references public.users(id),
    approved_by uuid references public.users(id),
    approved_at timestamptz,
    executed_at timestamptz,
    details jsonb not null default '{}',
    created_at timestamptz not null default timezone('utc', now())
);

create index if not exists idx_payout_batches_status on public.payout_batches(status);

-- 2. Atomic refund procedure
create or replace function public.atomic_execute_refund(
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
    v_event_id uuid;
begin
    v_now := timezone('utc', now());

    -- Lock and inspect payment
    select id, user_id, amount_paise, currency, state
    into v_pay
    from public.payments
    where id = p_payment_id
    for update;

    if not found then
        return jsonb_build_object(
            'success', false,
            'error', 'Payment not found',
            'code', 'PAYMENT_NOT_FOUND'
        );
    end if;

    if v_pay.state = 'refunded' then
        return jsonb_build_object(
            'success', false,
            'error', 'Payment has already been refunded',
            'code', 'ALREADY_REFUNDED'
        );
    end if;

    if v_pay.state <> 'captured' then
        return jsonb_build_object(
            'success', false,
            'error', 'Cannot refund payment in state: ' || v_pay.state,
            'code', 'INVALID_PAYMENT_STATE'
        );
    end if;

    if p_refund_amount_paise <= 0 or p_refund_amount_paise > v_pay.amount_paise then
        return jsonb_build_object(
            'success', false,
            'error', 'Invalid refund amount',
            'code', 'INVALID_REFUND_AMOUNT'
        );
    end if;

    -- Update payment record
    update public.payments
    set state = 'refunded'
    where id = v_pay.id;

    -- Compensating balanced double-entry ledger journal
    v_event_id := gen_random_uuid();

    -- Entry 1: Debit Revenue (Decreases revenue)
    insert into public.ledger_entries (
        id, event_id, account_code, direction, amount_paise, currency, reference_type, reference_id, created_at
    ) values (
        gen_random_uuid(), v_event_id, 'customer_service_revenue', 'debit', p_refund_amount_paise, v_pay.currency, 'refund', v_pay.id, v_now
    );

    -- Entry 2: Credit Cash PG Clearing (Decreases asset/cash balance)
    insert into public.ledger_entries (
        id, event_id, account_code, direction, amount_paise, currency, reference_type, reference_id, created_at
    ) values (
        gen_random_uuid(), v_event_id, 'cash_pg_clearing', 'credit', p_refund_amount_paise, v_pay.currency, 'refund', v_pay.id, v_now
    );

    -- Update related support requests
    update public.support_requests
    set state = 'cancelled'
    where payment_order_id = v_pay.id;

    -- Immutable audit log
    insert into public.audit_events (
        actor_id, actor_role, action, entity_type, entity_id, metadata, created_at
    ) values (
        p_actor_id,
        p_actor_role,
        'payment_refunded',
        'payment',
        v_pay.id,
        jsonb_build_object(
            'refund_amount_paise', p_refund_amount_paise,
            'reason', p_reason
        ),
        v_now
    );

    return jsonb_build_object(
        'success', true,
        'payment_id', v_pay.id,
        'refund_amount_paise', p_refund_amount_paise,
        'state', 'refunded',
        'event_id', v_event_id,
        'refunded_at', v_now
    );
end;
$$;

-- 3. Atomic payout execution procedure with STRICT HUMAN APPROVAL GUARD
create or replace function public.atomic_execute_payout_batch(
    p_batch_id uuid,
    p_executor_id uuid,
    p_executor_role text
)
returns jsonb
language plpgsql
security definer
as $$
declare
    v_batch record;
    v_now timestamptz;
    v_event_id uuid;
begin
    v_now := timezone('utc', now());

    -- Lock and inspect batch
    select id, total_paise, status, approved_by, approved_at
    into v_batch
    from public.payout_batches
    where id = p_batch_id
    for update;

    if not found then
        return jsonb_build_object(
            'success', false,
            'error', 'Payout batch not found',
            'code', 'BATCH_NOT_FOUND'
        );
    end if;

    -- STRICT AGENTS.MD INVARIANT: No automated listener payout without human finance approval!
    if v_batch.status <> 'approved' or v_batch.approved_by is null then
        return jsonb_build_object(
            'success', false,
            'error', 'Strict Invariant Violation: Payout batch requires prior human finance approval before execution.',
            'code', 'HUMAN_APPROVAL_REQUIRED'
        );
    end if;

    -- Transition batch to executed
    update public.payout_batches
    set status = 'executed',
        executed_at = v_now
    where id = v_batch.id;

    -- Post balanced double-entry ledger entries for payout settlement
    v_event_id := gen_random_uuid();

    -- Entry 1: Debit Listener Payable (Reduces liability)
    insert into public.ledger_entries (
        id, event_id, account_code, direction, amount_paise, currency, reference_type, reference_id, created_at
    ) values (
        gen_random_uuid(), v_event_id, 'listener_payable', 'debit', v_batch.total_paise, 'INR', 'payout', v_batch.id, v_now
    );

    -- Entry 2: Credit Cash PG Clearing (Reduces cash asset)
    insert into public.ledger_entries (
        id, event_id, account_code, direction, amount_paise, currency, reference_type, reference_id, created_at
    ) values (
        gen_random_uuid(), v_event_id, 'cash_pg_clearing', 'credit', v_batch.total_paise, 'INR', 'payout', v_batch.id, v_now
    );

    -- Audit log entry
    insert into public.audit_events (
        actor_id, actor_role, action, entity_type, entity_id, metadata, created_at
    ) values (
        p_executor_id,
        p_executor_role,
        'payout_batch_executed',
        'payout_batch',
        v_batch.id,
        jsonb_build_object(
            'total_paise', v_batch.total_paise,
            'approved_by', v_batch.approved_by
        ),
        v_now
    );

    return jsonb_build_object(
        'success', true,
        'batch_id', v_batch.id,
        'status', 'executed',
        'total_paise', v_batch.total_paise,
        'executed_at', v_now
    );
end;
$$;
