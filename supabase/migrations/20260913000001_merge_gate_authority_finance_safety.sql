-- Migration: 20260913000001_merge_gate_authority_finance_safety.sql
-- Purpose: close the remaining pre-merge trust-boundary gaps without rewriting history.
--
-- Guarantees introduced here:
--  * safety acknowledge/resolve + audit are one transaction with state CAS
--  * each newly-completed payable session creates one immutable listener earning
--    and one balanced compensation/payable journal
--  * payout batches claim earnings exactly once and enforce maker/checker approval
--  * a payout cannot clear listener_payable without external/manual settlement evidence
--  * payment-order orchestration has a durable pre-provider intent and atomic local bind
--  * privacy erasure has a durable cross-system job record

-- ---------------------------------------------------------------------------
-- 1. Finance configuration and listener sub-ledger
-- ---------------------------------------------------------------------------
create table if not exists public.finance_settings (
    singleton boolean primary key default true check (singleton),
    listener_earning_paise bigint not null check (listener_earning_paise > 0),
    currency char(3) not null default 'INR',
    updated_at timestamptz not null default timezone('utc', now())
);

insert into public.finance_settings (singleton, listener_earning_paise, currency)
values (true, 10000, 'INR')
on conflict (singleton) do nothing;

alter table public.ledger_entries
    drop constraint if exists ledger_entries_account_code_check;
alter table public.ledger_entries
    add constraint ledger_entries_account_code_check check (account_code in (
        'cash_pg_clearing',
        'customer_service_revenue',
        'listener_payable',
        'listener_compensation_expense',
        'payment_processing_expense',
        'refund_liability',
        'tax_payable'
    ));

create table if not exists public.listener_earnings (
    id uuid primary key default gen_random_uuid(),
    session_id uuid not null unique references public.sessions(id) on delete restrict,
    listener_id uuid not null references public.listener_profiles(id) on delete restrict,
    amount_paise bigint not null check (amount_paise > 0),
    currency char(3) not null default 'INR',
    state text not null default 'earned' check (state in ('earned', 'held', 'batched', 'paid', 'reversed')),
    hold_reason text null,
    payout_batch_id uuid null,
    earned_at timestamptz not null default timezone('utc', now()),
    paid_at timestamptz null,
    created_at timestamptz not null default timezone('utc', now())
);

create index if not exists idx_listener_earnings_listener_state
    on public.listener_earnings(listener_id, state, earned_at);
create index if not exists idx_listener_earnings_batch
    on public.listener_earnings(payout_batch_id) where payout_batch_id is not null;

alter table public.payout_batches
    drop constraint if exists payout_batches_status_check;
alter table public.payout_batches
    add constraint payout_batches_status_check check (status in (
        'draft', 'pending_approval', 'approved', 'submission_pending', 'processing',
        'settled', 'failed', 'reversed', 'rejected', 'cancelled'
    ));

alter table public.payout_batches
    add column if not exists settlement_reference text null,
    add column if not exists settlement_recorded_by uuid null references public.users(id),
    add column if not exists settled_at timestamptz null,
    add column if not exists failure_reason text null;

create table if not exists public.payout_batch_items (
    id uuid primary key default gen_random_uuid(),
    batch_id uuid not null references public.payout_batches(id) on delete restrict,
    earning_id uuid not null unique references public.listener_earnings(id) on delete restrict,
    session_id uuid not null references public.sessions(id) on delete restrict,
    listener_id uuid not null references public.listener_profiles(id) on delete restrict,
    amount_paise bigint not null check (amount_paise > 0),
    state text not null default 'batched' check (state in ('batched', 'held', 'settled', 'reversed')),
    created_at timestamptz not null default timezone('utc', now()),
    settled_at timestamptz null,
    unique (batch_id, earning_id)
);

create index if not exists idx_payout_batch_items_batch on public.payout_batch_items(batch_id);
create index if not exists idx_payout_batch_items_listener on public.payout_batch_items(listener_id);

alter table public.listener_earnings
    drop constraint if exists listener_earnings_payout_batch_id_fkey;
alter table public.listener_earnings
    add constraint listener_earnings_payout_batch_id_fkey
    foreign key (payout_batch_id) references public.payout_batches(id) on delete restrict;

-- RLS: these are finance-internal tables. Application routes use service_role
-- after explicit server-side permission checks; ordinary authenticated clients
-- receive no direct policies.
alter table public.finance_settings enable row level security;
alter table public.listener_earnings enable row level security;
alter table public.payout_batch_items enable row level security;

-- ---------------------------------------------------------------------------
-- 2. Session completion now snapshots listener earnings exactly once.
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
    v_earning_paise bigint;
    v_currency char(3);
    v_earning_id uuid;
    v_event_id uuid;
begin
    v_now := timezone('utc', now());

    select id, request_id, user_id, listener_id, state, started_at
    into v_sess
    from public.sessions
    where id = p_session_id
    for update;

    if not found then
        return jsonb_build_object('success', false, 'error', 'Session not found', 'code', 'SESSION_NOT_FOUND');
    end if;

    select user_id into v_listener_user_id
    from public.listener_profiles
    where id = v_sess.listener_id;

    if p_caller_user_id <> v_sess.user_id and p_caller_user_id <> v_listener_user_id then
        return jsonb_build_object('success', false, 'error', 'Forbidden: Caller is not a participant in this session', 'code', 'UNAUTHORIZED_CALLER');
    end if;

    if v_sess.state in ('ended', 'safety_ended', 'failed') then
        select id into v_earning_id from public.listener_earnings where session_id = v_sess.id;
        return jsonb_build_object(
            'success', true,
            'session_id', v_sess.id,
            'state', v_sess.state,
            'already_ended', true,
            'earning_id', v_earning_id,
            'message', 'Session is already completed'
        );
    end if;

    if p_end_reason not in ('normal_completion', 'user_left', 'listener_left', 'technical_failure') then
        return jsonb_build_object('success', false, 'error', 'Invalid end reason', 'code', 'INVALID_END_REASON');
    end if;

    if v_sess.started_at is not null then
        v_duration := greatest(0, extract(epoch from (v_now - v_sess.started_at))::integer);
    else
        v_duration := 0;
    end if;

    update public.sessions
    set state = 'ended', ended_at = v_now, duration_seconds = v_duration, end_reason = p_end_reason
    where id = v_sess.id;

    update public.support_requests
    set state = 'completed'
    where id = v_sess.request_id
      and state not in ('completed', 'cancelled', 'expired', 'declined', 'payment_failed',
                        'offer_expired', 'technical_failed', 'safety_escalated');

    update public.listener_presence
    set state = 'available', current_reservation_id = null, heartbeat_at = v_now
    where listener_id = v_sess.listener_id and state in ('reserved', 'in_session');

    update public.match_reservations
    set state = 'cancelled'
    where request_id = v_sess.request_id and state in ('offered', 'accepted');

    select listener_earning_paise, currency into v_earning_paise, v_currency
    from public.finance_settings where singleton = true;

    insert into public.listener_earnings (
        session_id, listener_id, amount_paise, currency, state, earned_at
    ) values (
        v_sess.id, v_sess.listener_id, v_earning_paise, v_currency, 'earned', v_now
    )
    on conflict (session_id) do nothing
    returning id into v_earning_id;

    if v_earning_id is not null then
        v_event_id := gen_random_uuid();
        insert into public.ledger_entries (
            id, event_id, account_code, direction, amount_paise, currency,
            reference_type, reference_id, created_at
        ) values
        (gen_random_uuid(), v_event_id, 'listener_compensation_expense', 'debit', v_earning_paise, v_currency, 'listener_earning', v_earning_id, v_now),
        (gen_random_uuid(), v_event_id, 'listener_payable', 'credit', v_earning_paise, v_currency, 'listener_earning', v_earning_id, v_now);
    else
        select id into v_earning_id from public.listener_earnings where session_id = v_sess.id;
    end if;

    return jsonb_build_object(
        'success', true,
        'session_id', v_sess.id,
        'state', 'ended',
        'duration_seconds', v_duration,
        'end_reason', p_end_reason,
        'ended_at', v_now,
        'earning_id', v_earning_id
    );
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. Safety state transitions + audit are atomic.
-- ---------------------------------------------------------------------------
create or replace function public.atomic_acknowledge_safety_case(
    p_case_id uuid,
    p_supervisor_id uuid,
    p_actor_role text default 'clinical_supervisor'
)
returns jsonb
language plpgsql
security definer
as $$
declare
    v_case record;
    v_now timestamptz := timezone('utc', now());
begin
    select id, state, supervisor_id, acknowledged_at into v_case
    from public.safety_cases where id = p_case_id for update;

    if not found then
        return jsonb_build_object('success', false, 'code', 'CASE_NOT_FOUND', 'error', 'Safety case not found');
    end if;

    if v_case.state = 'acknowledged' and v_case.supervisor_id = p_supervisor_id then
        return jsonb_build_object('success', true, 'idempotent_replay', true, 'acknowledged_at', v_case.acknowledged_at);
    end if;

    if v_case.state <> 'open' then
        return jsonb_build_object('success', false, 'code', 'INVALID_STATE', 'error', 'Safety case cannot be acknowledged from state ' || v_case.state);
    end if;

    update public.safety_cases
    set state = 'acknowledged', supervisor_id = p_supervisor_id, acknowledged_at = v_now
    where id = p_case_id and state = 'open';

    insert into public.audit_events (actor_id, actor_role, action, entity_type, entity_id, metadata, created_at)
    values (p_supervisor_id, p_actor_role, 'safety_case_acknowledged', 'safety_case', p_case_id,
            jsonb_build_object('supervisorId', p_supervisor_id), v_now);

    return jsonb_build_object('success', true, 'idempotent_replay', false, 'acknowledged_at', v_now);
end;
$$;

create or replace function public.atomic_resolve_safety_case(
    p_case_id uuid,
    p_supervisor_id uuid,
    p_resolution_code text,
    p_actor_role text default 'clinical_supervisor'
)
returns jsonb
language plpgsql
security definer
as $$
declare
    v_case record;
    v_now timestamptz := timezone('utc', now());
begin
    select id, state, supervisor_id, resolution_code, resolved_at into v_case
    from public.safety_cases where id = p_case_id for update;

    if not found then
        return jsonb_build_object('success', false, 'code', 'CASE_NOT_FOUND', 'error', 'Safety case not found');
    end if;

    if v_case.state = 'resolved'
       and v_case.supervisor_id = p_supervisor_id
       and v_case.resolution_code = p_resolution_code then
        return jsonb_build_object('success', true, 'idempotent_replay', true, 'resolved_at', v_case.resolved_at);
    end if;

    if v_case.state <> 'acknowledged' then
        return jsonb_build_object('success', false, 'code', 'INVALID_STATE', 'error', 'Safety case must be acknowledged before resolution');
    end if;

    if v_case.supervisor_id is distinct from p_supervisor_id then
        return jsonb_build_object('success', false, 'code', 'SUPERVISOR_MISMATCH', 'error', 'Safety case is assigned to another supervisor');
    end if;

    update public.safety_cases
    set state = 'resolved', resolved_at = v_now, resolution_code = p_resolution_code
    where id = p_case_id and state = 'acknowledged' and supervisor_id = p_supervisor_id;

    insert into public.audit_events (actor_id, actor_role, action, entity_type, entity_id, metadata, created_at)
    values (p_supervisor_id, p_actor_role, 'safety_case_resolved', 'safety_case', p_case_id,
            jsonb_build_object('resolutionCode', p_resolution_code), v_now);

    return jsonb_build_object('success', true, 'idempotent_replay', false, 'resolved_at', v_now);
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. Payout batches are built from immutable earnings, not today's pricing.
-- ---------------------------------------------------------------------------
create or replace function public.atomic_create_payout_batch(
    p_period_start timestamptz,
    p_period_end timestamptz,
    p_creator_id uuid,
    p_creator_role text default 'finance'
)
returns jsonb
language plpgsql
security definer
as $$
declare
    v_ids uuid[];
    v_total bigint;
    v_count integer;
    v_listener_count integer;
    v_batch_id uuid;
    v_now timestamptz := timezone('utc', now());
begin
    if p_period_end <= p_period_start then
        return jsonb_build_object('success', false, 'code', 'INVALID_PERIOD', 'error', 'periodEnd must be after periodStart');
    end if;

    select array_agg(id), coalesce(sum(amount_paise), 0), count(*), count(distinct listener_id)
    into v_ids, v_total, v_count, v_listener_count
    from (
        select id, amount_paise, listener_id
        from public.listener_earnings
        where state = 'earned'
          and earned_at >= p_period_start
          and earned_at < p_period_end
        order by earned_at, id
        for update
    ) eligible;

    if v_count = 0 or v_total <= 0 then
        return jsonb_build_object('success', false, 'code', 'NO_ELIGIBLE_EARNINGS', 'error', 'No unpaid listener earnings in this period');
    end if;

    insert into public.payout_batches (
        period_start, period_end, total_paise, status, created_by, details
    ) values (
        p_period_start, p_period_end, v_total, 'pending_approval', p_creator_id,
        jsonb_build_object('computedFrom', 'listener_earnings', 'earningCount', v_count, 'listenerCount', v_listener_count)
    ) returning id into v_batch_id;

    insert into public.payout_batch_items (batch_id, earning_id, session_id, listener_id, amount_paise, state)
    select v_batch_id, id, session_id, listener_id, amount_paise, 'batched'
    from public.listener_earnings
    where id = any(v_ids);

    update public.listener_earnings
    set state = 'batched', payout_batch_id = v_batch_id
    where id = any(v_ids) and state = 'earned';

    insert into public.audit_events (actor_id, actor_role, action, entity_type, entity_id, metadata, created_at)
    values (p_creator_id, p_creator_role, 'payout_batch_proposed', 'payout_batch', v_batch_id,
            jsonb_build_object('total_paise', v_total, 'earning_count', v_count), v_now);

    return jsonb_build_object(
        'success', true,
        'batch_id', v_batch_id,
        'status', 'pending_approval',
        'total_paise', v_total,
        'eligible_earnings_count', v_count,
        'listener_count', v_listener_count
    );
end;
$$;

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
    v_now timestamptz := timezone('utc', now());
begin
    select id, status, total_paise, created_by, approved_by into v_batch
    from public.payout_batches where id = p_batch_id for update;

    if not found then
        return jsonb_build_object('success', false, 'code', 'BATCH_NOT_FOUND', 'error', 'Payout batch not found');
    end if;
    if v_batch.status = 'approved' and v_batch.approved_by = p_approver_id then
        return jsonb_build_object('success', true, 'idempotent_replay', true, 'batch_id', v_batch.id,
                                  'status', 'approved', 'total_paise', v_batch.total_paise,
                                  'approved_by', v_batch.approved_by);
    end if;
    if v_batch.status <> 'pending_approval' then
        return jsonb_build_object('success', false, 'code', 'INVALID_BATCH_STATE', 'error', 'Only pending payout batches can be approved');
    end if;
    if v_batch.created_by is not null and v_batch.created_by = p_approver_id then
        return jsonb_build_object('success', false, 'code', 'SEPARATION_OF_DUTIES_REQUIRED', 'error', 'Payout creator cannot approve the same batch');
    end if;

    update public.payout_batches
    set status = 'approved', approved_by = p_approver_id, approved_at = v_now
    where id = p_batch_id and status = 'pending_approval';

    insert into public.audit_events (actor_id, actor_role, action, entity_type, entity_id, metadata, created_at)
    values (p_approver_id, p_approver_role, 'payout_batch_approved', 'payout_batch', p_batch_id,
            jsonb_build_object('total_paise', v_batch.total_paise, 'created_by', v_batch.created_by), v_now);

    return jsonb_build_object('success', true, 'idempotent_replay', false, 'batch_id', p_batch_id,
                              'status', 'approved', 'total_paise', v_batch.total_paise,
                              'approved_by', p_approver_id, 'approved_at', v_now);
end;
$$;

-- Existing /execute endpoint is kept for compatibility, but it now requires
-- settlement evidence and only then clears the payable. It is a manual-settlement
-- adapter until a provider payout integration is enabled.
drop function if exists public.atomic_execute_payout_batch(uuid, uuid, text);
create function public.atomic_execute_payout_batch(
    p_batch_id uuid,
    p_executor_id uuid,
    p_executor_role text,
    p_settlement_reference text
)
returns jsonb
language plpgsql
security definer
as $$
declare
    v_batch record;
    v_now timestamptz := timezone('utc', now());
    v_event_id uuid;
begin
    if p_settlement_reference is null or length(trim(p_settlement_reference)) < 4 then
        return jsonb_build_object('success', false, 'code', 'SETTLEMENT_EVIDENCE_REQUIRED', 'error', 'External settlement reference is required');
    end if;

    select id, total_paise, status, approved_by, settlement_reference, settled_at into v_batch
    from public.payout_batches where id = p_batch_id for update;

    if not found then
        return jsonb_build_object('success', false, 'code', 'BATCH_NOT_FOUND', 'error', 'Payout batch not found');
    end if;

    if v_batch.status = 'settled' then
        if v_batch.settlement_reference = p_settlement_reference then
            return jsonb_build_object('success', true, 'idempotent_replay', true, 'batch_id', v_batch.id,
                                      'status', 'settled', 'total_paise', v_batch.total_paise,
                                      'settled_at', v_batch.settled_at);
        end if;
        return jsonb_build_object('success', false, 'code', 'ALREADY_SETTLED', 'error', 'Payout batch already settled with different evidence');
    end if;

    if v_batch.status <> 'approved' or v_batch.approved_by is null then
        return jsonb_build_object('success', false, 'code', 'HUMAN_APPROVAL_REQUIRED', 'error', 'Payout batch requires prior independent approval');
    end if;

    if not exists (select 1 from public.payout_batch_items where batch_id = p_batch_id and state = 'batched') then
        return jsonb_build_object('success', false, 'code', 'EMPTY_BATCH', 'error', 'Payout batch has no unsettled earnings');
    end if;

    v_event_id := gen_random_uuid();
    insert into public.ledger_entries (
        id, event_id, account_code, direction, amount_paise, currency, reference_type, reference_id, created_at
    ) values
      (gen_random_uuid(), v_event_id, 'listener_payable', 'debit', v_batch.total_paise, 'INR', 'payout', v_batch.id, v_now),
      (gen_random_uuid(), v_event_id, 'cash_pg_clearing', 'credit', v_batch.total_paise, 'INR', 'payout', v_batch.id, v_now);

    update public.payout_batch_items
    set state = 'settled', settled_at = v_now
    where batch_id = p_batch_id and state = 'batched';

    update public.listener_earnings e
    set state = 'paid', paid_at = v_now
    where e.id in (select earning_id from public.payout_batch_items where batch_id = p_batch_id);

    update public.payout_batches
    set status = 'settled', settlement_reference = trim(p_settlement_reference),
        settlement_recorded_by = p_executor_id, settled_at = v_now, executed_at = v_now
    where id = p_batch_id;

    insert into public.audit_events (actor_id, actor_role, action, entity_type, entity_id, metadata, created_at)
    values (p_executor_id, p_executor_role, 'payout_batch_settled', 'payout_batch', p_batch_id,
            jsonb_build_object('total_paise', v_batch.total_paise, 'settlement_reference', trim(p_settlement_reference),
                               'approved_by', v_batch.approved_by), v_now);

    return jsonb_build_object('success', true, 'idempotent_replay', false, 'batch_id', p_batch_id,
                              'status', 'settled', 'total_paise', v_batch.total_paise,
                              'settled_at', v_now, 'settlement_reference', trim(p_settlement_reference));
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. Durable payment-order intent and atomic local binding.
-- ---------------------------------------------------------------------------
create table if not exists public.payment_order_intents (
    request_id uuid primary key references public.support_requests(id) on delete restrict,
    user_id uuid not null references public.users(id) on delete restrict,
    amount_paise bigint not null check (amount_paise > 0),
    currency char(3) not null default 'INR',
    state text not null default 'reserved' check (state in ('reserved', 'submitting', 'bound', 'reconciliation_required', 'failed')),
    provider_order_id text unique null,
    payment_id uuid unique null references public.payments(id) on delete restrict,
    last_error text null,
    created_at timestamptz not null default timezone('utc', now()),
    updated_at timestamptz not null default timezone('utc', now())
);

alter table public.payment_order_intents enable row level security;

create or replace function public.atomic_reserve_payment_order_intent(
    p_request_id uuid,
    p_user_id uuid,
    p_amount_paise bigint,
    p_currency text
)
returns jsonb
language plpgsql
security definer
as $$
declare
    v_req record;
    v_intent record;
begin
    select id, user_id, state, payment_order_id into v_req
    from public.support_requests where id = p_request_id for update;

    if not found or v_req.user_id <> p_user_id then
        return jsonb_build_object('success', false, 'code', 'REQUEST_NOT_FOUND', 'error', 'Support request not found or unauthorized');
    end if;

    if v_req.payment_order_id is not null then
        return jsonb_build_object('success', true, 'already_bound', true, 'payment_id', v_req.payment_order_id);
    end if;

    if v_req.state not in ('created', 'payment_failed') then
        return jsonb_build_object('success', false, 'code', 'REQUEST_NOT_PAYABLE', 'error', 'Support request is not payable in state ' || v_req.state);
    end if;

    insert into public.payment_order_intents (request_id, user_id, amount_paise, currency)
    values (p_request_id, p_user_id, p_amount_paise, p_currency::char(3))
    on conflict (request_id) do nothing;

    select * into v_intent from public.payment_order_intents where request_id = p_request_id for update;

    if v_intent.user_id <> p_user_id or v_intent.amount_paise <> p_amount_paise or v_intent.currency <> p_currency::char(3) then
        return jsonb_build_object('success', false, 'code', 'INTENT_MISMATCH', 'error', 'Existing payment intent does not match current request pricing');
    end if;

    return jsonb_build_object('success', true, 'already_bound', false, 'state', v_intent.state,
                              'provider_order_id', v_intent.provider_order_id, 'payment_id', v_intent.payment_id);
end;
$$;

create or replace function public.atomic_mark_payment_order_submitting(
    p_request_id uuid,
    p_user_id uuid
)
returns jsonb
language plpgsql
security definer
as $$
declare v_intent record;
begin
    select * into v_intent from public.payment_order_intents where request_id = p_request_id for update;
    if not found or v_intent.user_id <> p_user_id then
        return jsonb_build_object('success', false, 'code', 'INTENT_NOT_FOUND', 'error', 'Payment intent not found');
    end if;
    if v_intent.state = 'bound' then
        return jsonb_build_object('success', true, 'already_bound', true, 'payment_id', v_intent.payment_id, 'provider_order_id', v_intent.provider_order_id);
    end if;
    if v_intent.state <> 'reserved' and v_intent.state <> 'failed' then
        return jsonb_build_object('success', false, 'code', 'RECONCILIATION_REQUIRED', 'error', 'A previous provider submission is unresolved; reconcile it before retrying');
    end if;
    update public.payment_order_intents set state = 'submitting', updated_at = timezone('utc', now()), last_error = null
    where request_id = p_request_id;
    return jsonb_build_object('success', true, 'state', 'submitting');
end;
$$;

create or replace function public.atomic_bind_payment_order(
    p_request_id uuid,
    p_user_id uuid,
    p_provider_order_id text,
    p_amount_paise bigint,
    p_currency text
)
returns jsonb
language plpgsql
security definer
as $$
declare
    v_req record;
    v_intent record;
    v_payment record;
begin
    select * into v_intent from public.payment_order_intents where request_id = p_request_id for update;
    select id, user_id, payment_order_id into v_req from public.support_requests where id = p_request_id for update;

    if not found or v_req.user_id <> p_user_id or v_intent.request_id is null then
        return jsonb_build_object('success', false, 'code', 'INTENT_NOT_FOUND', 'error', 'Payment intent/request not found');
    end if;

    if v_intent.state = 'bound' and v_intent.payment_id is not null then
        return jsonb_build_object('success', true, 'idempotent_replay', true, 'payment_id', v_intent.payment_id,
                                  'provider_order_id', v_intent.provider_order_id);
    end if;

    if v_intent.state <> 'submitting' then
        return jsonb_build_object('success', false, 'code', 'INVALID_INTENT_STATE', 'error', 'Payment intent is not awaiting provider binding');
    end if;

    if v_intent.amount_paise <> p_amount_paise or v_intent.currency <> p_currency::char(3) then
        return jsonb_build_object('success', false, 'code', 'INTENT_MISMATCH', 'error', 'Payment intent amount/currency mismatch');
    end if;

    select * into v_payment from public.payments where provider_order_id = p_provider_order_id;
    if not found then
        insert into public.payments (user_id, provider, provider_order_id, amount_paise, currency, state)
        values (p_user_id, 'razorpay', p_provider_order_id, p_amount_paise, p_currency::char(3), 'created')
        returning * into v_payment;
    end if;

    if v_payment.user_id <> p_user_id or v_payment.amount_paise <> p_amount_paise then
        return jsonb_build_object('success', false, 'code', 'PROVIDER_ORDER_COLLISION', 'error', 'Provider order is already bound to different payment facts');
    end if;

    if v_req.payment_order_id is not null and v_req.payment_order_id <> v_payment.id then
        return jsonb_build_object('success', false, 'code', 'REQUEST_ALREADY_BOUND', 'error', 'Support request is already bound to another payment');
    end if;

    update public.support_requests set payment_order_id = v_payment.id where id = p_request_id;
    update public.payment_order_intents
    set state = 'bound', provider_order_id = p_provider_order_id, payment_id = v_payment.id,
        updated_at = timezone('utc', now()), last_error = null
    where request_id = p_request_id;

    return jsonb_build_object('success', true, 'idempotent_replay', false,
                              'payment_id', v_payment.id, 'provider_order_id', p_provider_order_id);
end;
$$;

-- ---------------------------------------------------------------------------
-- 6. Durable privacy erasure coordination across Postgres and Supabase Auth.
-- ---------------------------------------------------------------------------
create table if not exists public.privacy_erasure_jobs (
    user_id uuid primary key references public.users(id) on delete restrict,
    original_auth_user_id uuid not null,
    requested_by uuid null references public.users(id) on delete set null,
    status text not null default 'requested' check (status in ('requested', 'db_scrubbed', 'auth_purge_pending', 'partial_failure', 'completed', 'legal_hold')),
    last_error text null,
    requested_at timestamptz not null default timezone('utc', now()),
    updated_at timestamptz not null default timezone('utc', now()),
    completed_at timestamptz null
);

alter table public.privacy_erasure_jobs enable row level security;

-- ---------------------------------------------------------------------------
-- 7. Lock down every new SECURITY DEFINER function. No PUBLIC execute defaults.
-- ---------------------------------------------------------------------------
do $$
declare
    fn record;
begin
    for fn in
        select p.proname, pg_get_function_identity_arguments(p.oid) as identity_args
        from pg_proc p
        join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public'
          and p.proname = any(array[
              'atomic_end_session',
              'atomic_acknowledge_safety_case',
              'atomic_resolve_safety_case',
              'atomic_create_payout_batch',
              'atomic_approve_payout_batch',
              'atomic_execute_payout_batch',
              'atomic_reserve_payment_order_intent',
              'atomic_mark_payment_order_submitting',
              'atomic_bind_payment_order'
          ])
    loop
        execute format('alter function public.%I(%s) set search_path = public, pg_temp', fn.proname, fn.identity_args);
        execute format('revoke all on function public.%I(%s) from public', fn.proname, fn.identity_args);
        execute format('revoke all on function public.%I(%s) from anon', fn.proname, fn.identity_args);
        execute format('revoke all on function public.%I(%s) from authenticated', fn.proname, fn.identity_args);
        execute format('grant execute on function public.%I(%s) to service_role', fn.proname, fn.identity_args);
    end loop;
end;
$$;
