-- Local review fixture only. No provider call; every write is rolled back.
begin;
do $$
declare
  auth_id uuid := gen_random_uuid();
  user_id uuid := gen_random_uuid();
  payment_id uuid := gen_random_uuid();
  first_id uuid := gen_random_uuid();
  second_id uuid := gen_random_uuid();
  order_id text := 'order_codex_review_' || replace(gen_random_uuid()::text, '-', '');
  result jsonb;
  queued integer;
  bound integer;
begin
  insert into auth.users (id, aud, role) values (auth_id, 'authenticated', 'authenticated');
  insert into public.users (id, auth_user_id, handle, age_verified_at, status)
    values (user_id, auth_id, 'Review_' || left(user_id::text, 8), now(), 'active');
  insert into public.payments (id, user_id, provider, provider_order_id, amount_paise, currency, state)
    values (payment_id, user_id, 'razorpay', order_id, 19900, 'INR', 'created');
  insert into public.support_requests (id, user_id, topic, language, service_tier, state, idempotency_key, payment_order_id)
    values (first_id, user_id, 'Work & Career Stress', 'English', 'listener', 'created', gen_random_uuid(), payment_id),
           (second_id, user_id, 'Work & Career Stress', 'English', 'listener', 'created', gen_random_uuid(), null);
  result := public.atomic_capture_payment_webhook(order_id, 'pay_' || order_id, 19900, 'INR', 'evt_' || order_id, '{}'::jsonb);
  select count(*) into queued from public.support_requests r where r.id in (first_id, second_id) and r.state = 'queued';
  select count(*) into bound from public.support_requests r where r.id in (first_id, second_id) and r.payment_order_id = payment_id;
  raise notice '%', jsonb_build_object('probe', 'one-capture-one-request', 'captureSuccess', result->'success', 'expectedQueuedRequests', 1, 'actualQueuedRequests', queued, 'requestsBoundToOnePayment', bound);
end;
$$;
rollback;
