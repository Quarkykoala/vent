-- Migration: 20260902000001_core_schema.sql
-- Description: Core tables, constraints, foreign keys, and indexes for Mental Health Funnel Marketplace

-- Enable UUID extension
create extension if not exists "pgcrypto";

-- 1. Users Table
create table if not exists public.users (
    id uuid primary key default gen_random_uuid(),
    auth_user_id uuid unique not null,
    handle text unique not null,
    age_verified_at timestamptz not null,
    status text not null default 'active' check (status in ('active', 'suspended', 'deletion_pending', 'deleted')),
    created_at timestamptz not null default timezone('utc', now())
);

create index if not exists idx_users_auth_user_id on public.users(auth_user_id);
create index if not exists idx_users_status on public.users(status);

-- 2. Listener Profiles Table
create table if not exists public.listener_profiles (
    id uuid primary key default gen_random_uuid(),
    user_id uuid unique not null references public.users(id) on delete cascade,
    display_name text not null,
    status text not null default 'applicant' check (status in ('applicant', 'training', 'active', 'paused', 'suspended', 'rejected')),
    tier text not null default 'listener' check (tier in ('listener', 'counsellor')),
    languages text[] not null,
    topics text[] not null,
    verified_at timestamptz null,
    training_expires_at timestamptz null,
    quality_prior numeric not null default 4.5 check (quality_prior >= 1.0 and quality_prior <= 5.0),
    created_at timestamptz not null default timezone('utc', now())
);

create index if not exists idx_listener_profiles_status on public.listener_profiles(status);
create index if not exists idx_listener_profiles_languages on public.listener_profiles using gin(languages);
create index if not exists idx_listener_profiles_topics on public.listener_profiles using gin(topics);

-- 3. Listener Presence Table
create table if not exists public.listener_presence (
    listener_id uuid primary key references public.listener_profiles(id) on delete cascade,
    state text not null default 'offline' check (state in ('offline', 'available', 'reserved', 'in_session')),
    heartbeat_at timestamptz not null default timezone('utc', now()),
    available_since timestamptz null,
    current_reservation_id uuid null,
    version bigint not null default 1
);

create index if not exists idx_listener_presence_state_heartbeat on public.listener_presence(state, heartbeat_at);

-- 4. Support Requests Table
create table if not exists public.support_requests (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references public.users(id) on delete cascade,
    topic text not null,
    language text not null,
    service_tier text not null default 'listener' check (service_tier in ('listener', 'counsellor')),
    state text not null default 'created' check (state in (
        'created', 'paid', 'queued', 'reserved', 'accepted', 'connected', 'completed',
        'payment_failed', 'cancelled', 'expired', 'declined', 'offer_expired',
        'technical_failed', 'safety_escalated'
    )),
    payment_order_id uuid null,
    created_at timestamptz not null default timezone('utc', now()),
    queued_at timestamptz null,
    matched_at timestamptz null,
    expires_at timestamptz null,
    idempotency_key text unique not null
);

create index if not exists idx_support_requests_user_id on public.support_requests(user_id);
create index if not exists idx_support_requests_state on public.support_requests(state);
create index if not exists idx_support_requests_queue on public.support_requests(state, created_at) where state = 'queued';

-- 5. Match Reservations Table
create table if not exists public.match_reservations (
    id uuid primary key default gen_random_uuid(),
    request_id uuid unique not null references public.support_requests(id) on delete cascade,
    listener_id uuid not null references public.listener_profiles(id) on delete cascade,
    state text not null default 'offered' check (state in ('offered', 'accepted', 'declined', 'expired', 'cancelled')),
    score numeric not null,
    score_components jsonb not null default '{}'::jsonb,
    offered_at timestamptz not null default timezone('utc', now()),
    expires_at timestamptz not null,
    accepted_at timestamptz null
);

create index if not exists idx_match_reservations_listener_state on public.match_reservations(listener_id, state);
create index if not exists idx_match_reservations_expires on public.match_reservations(expires_at) where state = 'offered';

-- 6. Sessions Table
create table if not exists public.sessions (
    id uuid primary key default gen_random_uuid(),
    request_id uuid unique not null references public.support_requests(id) on delete cascade,
    user_id uuid not null references public.users(id) on delete cascade,
    listener_id uuid not null references public.listener_profiles(id) on delete cascade,
    state text not null default 'created' check (state in ('created', 'connecting', 'active', 'ended', 'failed', 'safety_ended')),
    room_name text unique not null,
    started_at timestamptz null,
    ended_at timestamptz null,
    duration_seconds int check (duration_seconds is null or duration_seconds >= 0),
    end_reason text null
);

create index if not exists idx_sessions_user_id on public.sessions(user_id);
create index if not exists idx_sessions_listener_id on public.sessions(listener_id);
create index if not exists idx_sessions_state on public.sessions(state);

-- 7. Ratings Table (One per session)
create table if not exists public.ratings (
    id uuid primary key default gen_random_uuid(),
    session_id uuid unique not null references public.sessions(id) on delete cascade,
    user_id uuid not null references public.users(id) on delete cascade,
    listener_id uuid not null references public.listener_profiles(id) on delete cascade,
    stars smallint not null check (stars between 1 and 5),
    reason_tags text[] not null default '{}',
    created_at timestamptz not null default timezone('utc', now())
);

create index if not exists idx_ratings_listener_id on public.ratings(listener_id);

-- 8. Blocks Table (Pairwise constraint)
create table if not exists public.blocks (
    blocker_id uuid not null references public.users(id) on delete cascade,
    blocked_id uuid not null references public.users(id) on delete cascade,
    reason_code text null,
    created_at timestamptz not null default timezone('utc', now()),
    primary key (blocker_id, blocked_id),
    check (blocker_id <> blocked_id)
);

create index if not exists idx_blocks_blocker on public.blocks(blocker_id);
create index if not exists idx_blocks_blocked on public.blocks(blocked_id);

-- 9. Payments Table
create table if not exists public.payments (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references public.users(id) on delete cascade,
    provider text not null default 'razorpay',
    provider_order_id text unique not null,
    provider_payment_id text unique null,
    amount_paise bigint not null check (amount_paise > 0),
    currency char(3) not null default 'INR',
    state text not null default 'created' check (state in ('created', 'authorized', 'captured', 'failed', 'refunded', 'partially_refunded')),
    created_at timestamptz not null default timezone('utc', now()),
    captured_at timestamptz null
);

create index if not exists idx_payments_user_id on public.payments(user_id);
create index if not exists idx_payments_order_id on public.payments(provider_order_id);
create index if not exists idx_payments_state on public.payments(state);

-- 10. Ledger Entries Table (Double-entry immutable ledger)
create table if not exists public.ledger_entries (
    id uuid primary key default gen_random_uuid(),
    event_id uuid not null,
    account_code text not null check (account_code in (
        'cash_pg_clearing',
        'customer_service_revenue',
        'listener_payable',
        'payment_processing_expense',
        'refund_liability',
        'tax_payable'
    )),
    direction text not null check (direction in ('debit', 'credit')),
    amount_paise bigint not null check (amount_paise > 0),
    currency char(3) not null default 'INR',
    reference_type text not null,
    reference_id uuid not null,
    created_at timestamptz not null default timezone('utc', now())
);

create index if not exists idx_ledger_entries_event_id on public.ledger_entries(event_id);
create index if not exists idx_ledger_entries_account on public.ledger_entries(account_code);
create index if not exists idx_ledger_entries_reference on public.ledger_entries(reference_type, reference_id);

-- 11. Safety Cases Table
create table if not exists public.safety_cases (
    id uuid primary key default gen_random_uuid(),
    session_id uuid not null references public.sessions(id) on delete cascade,
    opened_by uuid not null references public.users(id),
    severity text not null check (severity in ('review', 'urgent', 'emergency')),
    state text not null default 'open' check (state in ('open', 'acknowledged', 'escalated', 'resolved')),
    reason_codes text[] not null,
    supervisor_id uuid null references public.users(id),
    opened_at timestamptz not null default timezone('utc', now()),
    acknowledged_at timestamptz null,
    resolved_at timestamptz null,
    resolution_code text null
);

create index if not exists idx_safety_cases_session_id on public.safety_cases(session_id);
create index if not exists idx_safety_cases_state_severity on public.safety_cases(state, severity);

-- 12. Audit Events Table (Append-only)
create table if not exists public.audit_events (
    id bigserial primary key,
    actor_id uuid null references public.users(id),
    actor_role text not null,
    action text not null,
    entity_type text not null,
    entity_id uuid not null,
    metadata jsonb not null default '{}'::jsonb,
    ip_hash text null,
    created_at timestamptz not null default timezone('utc', now())
);

create index if not exists idx_audit_events_entity on public.audit_events(entity_type, entity_id);
create index if not exists idx_audit_events_created on public.audit_events(created_at);

-- 13. Idempotency Keys Table
create table if not exists public.idempotency_keys (
    key text primary key,
    operation text not null,
    response jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default timezone('utc', now())
);

create index if not exists idx_idempotency_created on public.idempotency_keys(created_at);
