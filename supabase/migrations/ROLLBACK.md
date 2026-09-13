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

### Reverting 20260905000001_db_authority_lockdown.sql:
```sql
-- Restore support_requests insert policy (pre-hardening shape)
drop policy if exists "support_requests_insert_own" on public.support_requests;
create policy "support_requests_insert_own" on public.support_requests
    for insert to authenticated
    with check (user_id = public.current_user_id());

-- Remove payout_batches access controls (restore pre-hardening exposure)
alter table public.payout_batches disable row level security;
grant all on public.payout_batches to anon, authenticated;

-- Restore default function privileges (pre-hardening exposure)
do $$
declare
    fn record;
begin
    for fn in
        select p.proname, pg_get_function_identity_arguments(p.oid) as identity_args
        from pg_proc p
        join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.prokind = 'f'
    loop
        execute format('revoke execute on function public.%I(%s) from anon', fn.proname, fn.identity_args);
        execute format('revoke execute on function public.%I(%s) from authenticated', fn.proname, fn.identity_args);
        execute format('revoke execute on function public.%I(%s) from service_role', fn.proname, fn.identity_args);
        execute format('grant execute on function public.%I(%s) to public', fn.proname, fn.identity_args);
    end loop;
end;
$$;
alter default privileges in schema public grant execute on functions to public;
```

### Reverting 20260905000002_age_evidence_nullability.sql:
```sql
-- Restore NOT NULL only after confirming no rows have NULL age_verified_at:
-- update public.users set age_verified_at = timezone('utc', now()) where age_verified_at is null;
alter table public.users alter column age_verified_at set not null;
```

### Reverting 20260908000001_accept_session_recovery.sql:
```sql
drop function if exists public.atomic_accept_session_recovery(uuid, uuid);
```

### Reverting 20260912000001_authority_lifecycle_and_binding_repair.sql:
```sql
-- Forward-only in production: re-applying 20260903000003/2/4/5 restores the
-- previous bodies. The only schema object to drop is the binding index, and it
-- must only be dropped after confirming no duplicate binding is reintroduced.
drop index if exists public.idx_support_requests_payment_order_unique;
-- Re-apply the previous function bodies (they are preserved verbatim in
-- 20260903000003_atomic_payment_capture.sql, 20260903000002_atomic_matching_transactions.sql,
-- 20260903000004_atomic_session_completion.sql and 20260903000005_atomic_safety_cases.sql)
-- and then re-run the ACL sweep as it exists in 20260905000001 to keep the
-- PUBLIC EXECUTE grant off privileged functions.
```
Note: reverting this migration reintroduces three verified defects — a capture
that funds every open request of the payer, an anonymously executable recovery
RPC, and a reservation that never releases the listener. Treat it as
roll-forward only.

### Reverting 20260912000002_session_cap_and_worker_rpcs.sql:
```sql
drop function if exists public.atomic_expire_session_cap(uuid, integer, text);
drop function if exists public.list_cap_expired_sessions(integer, integer);
drop function if exists public.list_ttl_expired_reservations(integer);
```
Reverting removes the server-owned session cap (RISK-006): sessions would run
indefinitely. Roll forward instead.

### Reverting 20260912000003_refund_provider_state.sql:
```sql
-- Forward-only. `atomic_execute_refund` was dropped deliberately: it claimed a
-- provider outcome it never obtained. To restore the old behaviour you must
-- re-create it from 20260903000006 and accept that refunds will report
-- 'refunded' without any provider call.
drop table if exists public.refunds;
alter table public.payments drop constraint if exists payments_state_check;
alter table public.payments add constraint payments_state_check
    check (state in ('created', 'authorized', 'captured', 'failed', 'refunded', 'partially_refunded'));
```

### Reverting 20260912000004_ledger_immutability_and_payout_approval.sql:
```sql
drop trigger if exists trg_ledger_entries_append_only on public.ledger_entries;
drop trigger if exists trg_audit_events_append_only on public.audit_events;
drop function if exists public.prevent_ledger_mutation();
drop function if exists public.prevent_audit_event_mutation();
drop function if exists public.atomic_approve_payout_batch(uuid, uuid, text);
```
Reverting removes append-only enforcement on financial history. Roll forward
instead.

## Production Roll-Forward Policy
In production, never run destructive DROPs. Always apply a compensating forward migration with pre-tested data preservation.
