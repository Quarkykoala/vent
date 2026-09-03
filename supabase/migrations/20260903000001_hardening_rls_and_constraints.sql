-- Migration: 20260903000001_hardening_rls_and_constraints.sql
-- Description: Hardened RLS policies, least-privilege revokes, and partial unique index fixes

-- 1. Fix match_reservations: replace rigid UNIQUE(request_id) with partial unique indexes
-- This allows historical declined/expired reservations to be retained while strictly preventing multiple concurrent active offers.
alter table public.match_reservations drop constraint if exists match_reservations_request_id_key;

create unique index if not exists idx_match_reservations_active_request
    on public.match_reservations(request_id)
    where state in ('offered', 'accepted');

create unique index if not exists idx_match_reservations_active_listener
    on public.match_reservations(listener_id)
    where state in ('offered', 'accepted');

-- 2. Revoke arbitrary UPDATE on match_reservations from authenticated
-- State transitions must occur exclusively via controlled server-side operations.
revoke update on public.match_reservations from authenticated;
drop policy if exists "match_reservations_update_listener" on public.match_reservations;

-- 3. Revoke direct UPDATE on users from authenticated
-- Prevents clients from altering status or auth mappings via direct SQL.
revoke update on public.users from authenticated;
drop policy if exists "users_update_own" on public.users;

-- 4. Harden support_requests update: revoke direct update
-- Cancellation and lifecycle transitions must use controlled domain functions.
revoke update on public.support_requests from authenticated;
drop policy if exists "support_requests_cancel_own" on public.support_requests;

-- 5. Harden ratings policy: user can ONLY rate their own COMPLETED session with matching listener
drop policy if exists "ratings_insert_own_session" on public.ratings;

create policy "ratings_insert_own_session" on public.ratings
    for insert to authenticated
    with check (
        user_id = public.current_user_id()
        and exists (
            select 1 from public.sessions s
            where s.id = ratings.session_id
            and s.user_id = public.current_user_id()
            and s.listener_id = ratings.listener_id
            and s.state = 'ended'
        )
    );

-- 6. Helper function to extract user role from JWT claims
create or replace function public.current_user_role()
returns text
language sql
stable
as $$
  select coalesce(
    nullif(current_setting('request.jwt.claims', true)::jsonb -> 'app_metadata' ->> 'role', ''),
    'user'
  );
$$;

-- 7. Ensure no table grants for anon on any table
revoke all on all tables in schema public from anon;
