-- Worker execution proof fixture (synthetic; cleaned up by the companion
-- cleanup script). Creates one offer that is already past its TTL so the
-- operations worker has real work to do.
do $$
declare
  v_user uuid := gen_random_uuid();
  v_listener_user uuid := gen_random_uuid();
  v_listener uuid := gen_random_uuid();
  v_request uuid := gen_random_uuid();
  v_reservation uuid := gen_random_uuid();
begin
  insert into public.users (id, auth_user_id, handle, age_verified_at, status)
  values (v_user, gen_random_uuid(), 'WorkerProofUser_' || left(v_user::text, 6), now(), 'active'),
         (v_listener_user, gen_random_uuid(), 'WorkerProofListener_' || left(v_listener_user::text, 6), now(), 'active');

  insert into public.listener_profiles (id, user_id, display_name, status, tier, languages, topics, verified_at, training_expires_at)
  values (v_listener, v_listener_user, 'Worker Proof Listener', 'active', 'listener',
          array['English'], array['Work & Career Stress'], now(), now() + interval '30 days');

  insert into public.listener_presence (listener_id, state, heartbeat_at, available_since, current_reservation_id)
  values (v_listener, 'reserved', now(), now(), v_reservation);

  insert into public.support_requests (id, user_id, topic, language, service_tier, state, idempotency_key, matched_at)
  values (v_request, v_user, 'Work & Career Stress', 'English', 'listener', 'reserved',
          'worker_proof_' || gen_random_uuid(), now());

  insert into public.match_reservations (id, request_id, listener_id, state, score, score_components, offered_at, expires_at)
  values (v_reservation, v_request, v_listener, 'offered', 0.5, '{}'::jsonb,
          now() - interval '10 minutes', now() - interval '5 minutes');

  raise notice 'worker-proof fixture: %|%|%|%', v_user, v_listener_user, v_listener, v_request;
end;
$$;

select r.id as reservation_id, r.state as reservation_state, r.expires_at,
       sr.id as request_id, sr.state as request_state,
       lp.state as presence_state, lp.listener_id
from public.match_reservations r
join public.support_requests sr on sr.id = r.request_id
join public.listener_presence lp on lp.listener_id = r.listener_id
join public.users u on u.id = sr.user_id
where u.handle like 'WorkerProofUser_%';
