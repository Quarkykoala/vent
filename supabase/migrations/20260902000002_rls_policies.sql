-- Migration: 20260902000002_rls_policies.sql
-- Description: Row Level Security (RLS) policies and least-privilege grants

-- Step 1: Enable RLS on all tables
alter table public.users enable row level security;
alter table public.listener_profiles enable row level security;
alter table public.listener_presence enable row level security;
alter table public.support_requests enable row level security;
alter table public.match_reservations enable row level security;
alter table public.sessions enable row level security;
alter table public.ratings enable row level security;
alter table public.blocks enable row level security;
alter table public.payments enable row level security;
alter table public.ledger_entries enable row level security;
alter table public.safety_cases enable row level security;
alter table public.audit_events enable row level security;
alter table public.idempotency_keys enable row level security;

-- Step 2: Revoke default permissions from public and anon
revoke all on all tables in schema public from anon;
revoke all on all tables in schema public from authenticated;

-- Helper function: get internal user id from auth.uid()
create or replace function public.current_user_id()
returns uuid
language sql
stable
security definer
as $$
  select id from public.users where auth_user_id = auth.uid() limit 1;
$$;

-- Helper function: get listener id from auth.uid()
create or replace function public.current_listener_id()
returns uuid
language sql
stable
security definer
as $$
  select lp.id from public.listener_profiles lp
  join public.users u on lp.user_id = u.id
  where u.auth_user_id = auth.uid()
  limit 1;
$$;

-- Step 3: Grants for authenticated users
grant select, update on public.users to authenticated;
grant select on public.listener_profiles to authenticated;
grant select, update on public.listener_presence to authenticated;
grant select, insert, update on public.support_requests to authenticated;
grant select, update on public.match_reservations to authenticated;
grant select on public.sessions to authenticated;
grant select, insert on public.ratings to authenticated;
grant select, insert, delete on public.blocks to authenticated;
grant select on public.payments to authenticated;

-- Step 4: Define RLS policies

-- Users policies
create policy "users_select_own" on public.users
    for select to authenticated
    using (auth_user_id = auth.uid());

create policy "users_update_own" on public.users
    for update to authenticated
    using (auth_user_id = auth.uid())
    with check (auth_user_id = auth.uid());

-- Listener profiles policies
create policy "listener_profiles_select_active" on public.listener_profiles
    for select to authenticated
    using (status = 'active' or user_id = public.current_user_id());

-- Listener presence policies
create policy "listener_presence_select" on public.listener_presence
    for select to authenticated
    using (listener_id = public.current_listener_id());

create policy "listener_presence_update_own" on public.listener_presence
    for update to authenticated
    using (listener_id = public.current_listener_id())
    with check (listener_id = public.current_listener_id());

-- Support requests policies
create policy "support_requests_select_own" on public.support_requests
    for select to authenticated
    using (user_id = public.current_user_id());

create policy "support_requests_insert_own" on public.support_requests
    for insert to authenticated
    with check (user_id = public.current_user_id());

create policy "support_requests_cancel_own" on public.support_requests
    for update to authenticated
    using (user_id = public.current_user_id())
    with check (user_id = public.current_user_id() and state = 'cancelled');

-- Match reservations policies
create policy "match_reservations_select_listener" on public.match_reservations
    for select to authenticated
    using (
        listener_id = public.current_listener_id()
        or request_id in (select id from public.support_requests where user_id = public.current_user_id())
    );

create policy "match_reservations_update_listener" on public.match_reservations
    for update to authenticated
    using (listener_id = public.current_listener_id())
    with check (listener_id = public.current_listener_id());

-- Sessions policies (Only user and assigned listener can select)
create policy "sessions_select_participants" on public.sessions
    for select to authenticated
    using (
        user_id = public.current_user_id()
        or listener_id = public.current_listener_id()
    );

-- Ratings policies (Only session user can rate)
create policy "ratings_select_participants" on public.ratings
    for select to authenticated
    using (
        user_id = public.current_user_id()
        or listener_id = public.current_listener_id()
    );

create policy "ratings_insert_own_session" on public.ratings
    for insert to authenticated
    with check (user_id = public.current_user_id());

-- Blocks policies
create policy "blocks_select_own" on public.blocks
    for select to authenticated
    using (blocker_id = public.current_user_id());

create policy "blocks_insert_own" on public.blocks
    for insert to authenticated
    with check (blocker_id = public.current_user_id());

create policy "blocks_delete_own" on public.blocks
    for delete to authenticated
    using (blocker_id = public.current_user_id());

-- Payments policies (Users can only view their own payments)
create policy "payments_select_own" on public.payments
    for select to authenticated
    using (user_id = public.current_user_id());

-- Strictly NO user access to sensitive tables:
-- ledger_entries, safety_cases, audit_events, idempotency_keys
-- (Service role retains bypassrls access by default)
