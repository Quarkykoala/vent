-- Migration: 20260903000007_counselling_funnel.sql
-- Description: Licensed counselling partners and referral funnel tracking with privacy invariants

create table if not exists public.counselling_partners (
    id uuid primary key default gen_random_uuid(),
    name text not null,
    license_number text not null,
    status text not null check (status in ('active', 'inactive', 'suspended')),
    contact_email text not null,
    created_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.counselling_referrals (
    id uuid primary key default gen_random_uuid(),
    session_id uuid not null references public.sessions(id) on delete cascade,
    user_id uuid not null references public.users(id) on delete cascade,
    referred_by_listener_id uuid references public.listener_profiles(id),
    partner_id uuid references public.counselling_partners(id),
    category text not null check (category in ('stress_management', 'grief_support', 'relationship_counselling', 'career_guidance', 'emotional_regulation')),
    state text not null check (state in ('offered', 'accepted', 'declined', 'transferred')),
    user_consented boolean not null default false,
    consented_contact text,
    transferred_at timestamptz,
    created_at timestamptz not null default timezone('utc', now()),
    updated_at timestamptz not null default timezone('utc', now())
);

create index if not exists idx_counselling_referrals_user on public.counselling_referrals(user_id);
create index if not exists idx_counselling_referrals_session on public.counselling_referrals(session_id);
create index if not exists idx_counselling_referrals_state on public.counselling_referrals(state);

-- Enable RLS
alter table public.counselling_partners enable row level security;
alter table public.counselling_referrals enable row level security;

-- Policies for counselling_partners: authenticated users can read active partners
create policy "partners_select_active"
    on public.counselling_partners
    for select
    to authenticated
    using (status = 'active');

-- Policies for counselling_referrals: user can read own, listener can read referred
create policy "referrals_select_user"
    on public.counselling_referrals
    for select
    to authenticated
    using (user_id = current_user_id() or referred_by_listener_id = current_listener_id());

revoke all on public.counselling_partners from anon;
revoke all on public.counselling_referrals from anon;
