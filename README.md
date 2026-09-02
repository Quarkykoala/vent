# Mental Health Funnel — Build Pack

**Purpose:** A bounded, implementation-ready specification for an India-first emotional-support marketplace that starts with low-friction human listening and escalates users, when appropriate, to counselling or therapy.

**Product thesis:**  
`Need to talk now → trained listener → counsellor → therapist`

The MVP is deliberately **not** an AI therapist, not a social network, not a medical-record platform, and not a crisis service.

## What is inside

1. `PRD.md` — product requirements, personas, flows, metrics, non-goals, acceptance criteria.
2. `TECHNICAL_PLAN.md` — architecture, data model, APIs, matching, payments, audio, jobs, security, deployment, testing.
3. `SOP.md` — operating procedures for listeners, supervisors, support, payments, incidents, privacy, and crisis escalation.
4. `AGENTS.md` — instructions for coding agents; scope boundaries, sequencing, quality gates, prohibited shortcuts.
5. `IMPLEMENTATION_BACKLOG.md` — phase-by-phase work packages and definition of done.
6. `SECURITY_SAFETY.md` — threat model, privacy design, safety controls, abuse handling, incident response.
7. `RESEARCH_AND_DECISIONS.md` — evidence, competitor lessons, open-source options, architecture decisions, and source list.

## MVP in one sentence

A user chooses what is bothering them, pays, is matched anonymously to a vetted trained listener, speaks over private browser audio, rates the session, and can optionally escalate to a qualified counsellor.

## Hard boundaries

- Adults only (18+) in MVP.
- India only in MVP.
- Audio only; no video.
- No session recording.
- No AI-generated counselling.
- No diagnosis, prescription, medication advice, or treatment plan from listeners.
- No community feed, DMs, group rooms, journaling, courses, or social graph.
- No minors.
- No international launch.
- No insurance billing.
- No automated suicide-risk classification.
- No storing free-form session transcripts.
- No direct exchange of phone numbers or social handles between user and listener.
- No “marketplace wallet” complexity in v1 unless required by payment provider.

## Recommended stack

- Web: Next.js + TypeScript
- DB/Auth: Supabase Postgres + Auth + RLS
- Realtime audio: LiveKit Cloud first; self-host only after scale/privacy economics justify it
- Payments: Razorpay Checkout; internal immutable ledger; manual/approved listener payouts initially
- Durable jobs: Trigger.dev
- Analytics: privacy-minimized PostHog or equivalent; no session replay on support/call/payment/health-related surfaces
- Errors: Sentry with PII scrubbing
- Email/SMS/WhatsApp: provider abstraction; start with email + transactional SMS only
- Hosting: Vercel for web + Supabase managed DB; move only when a specific constraint appears

## Operating principle

**Use managed infrastructure for undifferentiated complexity. Build only the marketplace, safety workflow, matching, trust layer, and care funnel.**

## Validation gates

Do not build later phases merely because the roadmap says so. Unlock them only when the previous phase meets measurable gates.

- Gate A: 100 paid sessions, >4.5/5 CSAT, <10% payment/refund failure, no unresolved P0 safety incident.
- Gate B: 1,000 paid sessions, repeat rate measurable, median match time <3 min during staffed hours.
- Gate C: 10,000 paid sessions before ML matching, community, native apps, or self-hosted RTC are considered.

## Legal note

This is a technical/product specification, not legal or clinical advice. Before launch, Indian counsel and a qualified clinical lead must approve the terms, privacy notice, scope-of-practice language, crisis SOP, retention schedule, listener contract, and professional escalation rules.
