-- Migration: 20260903000003_atomic_payment_capture.sql
-- Description: ACID transactional procedure for Razorpay webhook payment capture, ledger journaling, and idempotency

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

    -- Step 7: Transition support request
    update public.support_requests
    set state = 'queued',
        queued_at = v_now,
        payment_order_id = v_pay.id
    where user_id = v_pay.user_id
      and state in ('created', 'paid')
      and (payment_order_id is null or payment_order_id = v_pay.id);

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
        'event_id', v_event_id
    );
end;
$$;
