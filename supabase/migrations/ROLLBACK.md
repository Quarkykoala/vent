# Database Migration Rollback Strategy

## Invariant
Migrations are immutable once deployed to production. If an emergency rollback is required in staging or local development, execute the reverse steps in inverse chronological order:

### Reverting 20260902000002_rls_policies.sql:
```sql
drop policy if exists "payments_select_own" on public.payments;
drop policy if exists "blocks_delete_own" on public.blocks;
drop policy if exists "blocks_insert_own" on public.blocks;
drop policy if exists "blocks_select_own" on public.blocks;
drop policy if exists "ratings_insert_own_session" on public.ratings;
drop policy if exists "ratings_select_participants" on public.ratings;
drop policy if exists "sessions_select_participants" on public.sessions;
drop policy if exists "match_reservations_update_listener" on public.match_reservations;
drop policy if exists "match_reservations_select_listener" on public.match_reservations;
drop policy if exists "support_requests_cancel_own" on public.support_requests;
drop policy if exists "support_requests_insert_own" on public.support_requests;
drop policy if exists "support_requests_select_own" on public.support_requests;
drop policy if exists "listener_presence_update_own" on public.listener_presence;
drop policy if exists "listener_presence_select" on public.listener_presence;
drop policy if exists "listener_profiles_select_active" on public.listener_profiles;
drop policy if exists "users_update_own" on public.users;
drop policy if exists "users_select_own" on public.users;
drop function if exists public.current_listener_id();
drop function if exists public.current_user_id();
```

### Reverting 20260902000001_core_schema.sql:
```sql
drop table if exists public.idempotency_keys cascade;
drop table if exists public.audit_events cascade;
drop table if exists public.safety_cases cascade;
drop table if exists public.ledger_entries cascade;
drop table if exists public.payments cascade;
drop table if exists public.blocks cascade;
drop table if exists public.ratings cascade;
drop table if exists public.sessions cascade;
drop table if exists public.match_reservations cascade;
drop table if exists public.support_requests cascade;
drop table if exists public.listener_presence cascade;
drop table if exists public.listener_profiles cascade;
drop table if exists public.users cascade;
```

## Production Roll-Forward Policy
In production, never run destructive DROPs. Always apply a compensating forward migration with pre-tested data preservation.
