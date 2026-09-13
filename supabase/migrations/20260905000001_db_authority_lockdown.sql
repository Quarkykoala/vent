-- Migration: 20260905000001_db_authority_lockdown.sql
-- Description: F01 repair — privileged database authority lockdown.
-- 1. SECURITY DEFINER functions are no longer executable by anon/authenticated callers;
--    only the service role (used exclusively by the Next.js server) retains EXECUTE.
-- 2. Every public function gets a hardened search_path (public, pg_temp) to prevent
--    temp-object shadowing inside definer-rights bodies.
-- 3. payout_batches gains RLS + explicit grants revocation (was created after the
--    blanket revokes in 20260902000002 and inherited no access controls).
-- 4. support_requests INSERT policy rejects forged lifecycle state: users may only
--    insert their own row in state 'created' with no payment link or queue timestamps.
-- 5. Default privileges for future functions in schema public no longer grant EXECUTE
--    to PUBLIC (secure by default).

-- ---------------------------------------------------------------------------
-- 1. Secure default for future functions
-- ---------------------------------------------------------------------------
alter default privileges in schema public revoke execute on functions from public;

-- ---------------------------------------------------------------------------
-- 2. Lock down existing functions
-- ---------------------------------------------------------------------------
do $$
declare
    fn record;
    helper_names text[] := array['current_user_id', 'current_listener_id', 'current_user_role'];
begin
    for fn in
        select
            p.proname,
            pg_get_function_identity_arguments(p.oid) as identity_args
        from pg_proc p
        join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public'
          and p.prokind = 'f'
    loop
        -- Harden search path for every function (definer or invoker rights).
        execute format(
            'alter function public.%I(%s) set search_path = public, pg_temp',
            fn.proname, fn.identity_args
        );

        if not (fn.proname = any(helper_names)) then
            -- Privileged mutations: service role only.
            execute format('revoke execute on function public.%I(%s) from public', fn.proname, fn.identity_args);
            execute format('revoke execute on function public.%I(%s) from anon', fn.proname, fn.identity_args);
            execute format('revoke execute on function public.%I(%s) from authenticated', fn.proname, fn.identity_args);
            execute format('grant execute on function public.%I(%s) to service_role', fn.proname, fn.identity_args);
        else
            -- RLS helper functions are evaluated inside policies for every caller;
            -- keep them executable by anon/authenticated but not the ad-hoc PUBLIC role.
            execute format('revoke execute on function public.%I(%s) from public', fn.proname, fn.identity_args);
            execute format('grant execute on function public.%I(%s) to anon', fn.proname, fn.identity_args);
            execute format('grant execute on function public.%I(%s) to authenticated', fn.proname, fn.identity_args);
        end if;
    end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. payout_batches: enable RLS and revoke direct access
--    Finance operations flow exclusively through the server (service role).
-- ---------------------------------------------------------------------------
alter table public.payout_batches enable row level security;
alter table public.payout_batches force row level security;
revoke all on public.payout_batches from anon;
revoke all on public.payout_batches from authenticated;

-- ---------------------------------------------------------------------------
-- 4. support_requests: users may not forge lifecycle state on their own rows.
--    A client may only create a fresh unpaid request; every subsequent state
--    transition (paid/queued/reserved/...) is performed by the server via
--    service-role domain functions and atomic RPCs.
-- ---------------------------------------------------------------------------
drop policy if exists "support_requests_insert_own" on public.support_requests;

create policy "support_requests_insert_own" on public.support_requests
    for insert to authenticated
    with check (
        user_id = public.current_user_id()
        and state = 'created'
        and payment_order_id is null
        and queued_at is null
        and matched_at is null
    );
