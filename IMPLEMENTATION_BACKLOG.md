# Implementation Backlog — Bounded Work Packages

## Execution rule

Agents work phase by phase. They do not start Phase N+1 until the acceptance gate for Phase N is green.

---

# Phase 0 — Repository + invariants

## P0.1 Bootstrap
- Next.js TypeScript repo
- pnpm
- lint/format/typecheck
- Vitest
- Playwright
- env validation
- CI

Acceptance:
- clean install
- CI green
- no secrets committed

## P0.2 Domain enums/state machines
Implement typed states for:
- support request
- reservation
- session
- payment
- safety case

Acceptance:
- invalid transitions fail unit tests
- no UI direct mutation

## P0.3 Database migrations
Core tables + constraints + indexes.

Acceptance:
- migrate from empty DB
- rollback strategy documented
- constraints tested

## P0.4 RLS
Policies and grants.

Acceptance:
- allow tests
- deny tests
- user cannot read another user
- listener cannot read user contact
- anon cannot read private tables

---

# Phase 1 — Auth + roles

## P1.1 User OTP
- sign-in
- pseudonymous handle
- age gate timestamp

## P1.2 Staff/listener auth
- role claims
- MFA for admin
- separate staff routes

Acceptance:
- role matrix E2E tests

---

# Phase 2 — Listener onboarding/presence

## P2.1 Listener profile
- admin creates/reviews
- language/topic
- training expiry
- status

## P2.2 Presence
- available/offline
- heartbeat
- stale TTL

Acceptance:
- stale available listener automatically becomes unavailable
- active session not accidentally killed

---

# Phase 3 — Payments

## P3.1 Razorpay order
- server-created amount
- checkout

## P3.2 Webhook
- signature verification
- idempotency
- payment state

## P3.3 Ledger
- balanced journal
- capture/refund

Acceptance:
- duplicate webhook produces one capture
- forged webhook rejected
- ledger property test balances

---

# Phase 4 — Queue and matching

## P4.1 Create support request
- topic/language
- paid entitlement

## P4.2 Matcher
- hard filters
- deterministic score
- atomic reservation

## P4.3 Offer timeout/rematch
- Trigger.dev expiry
- listener accept/decline

Acceptance:
- no double reservation
- blocked pair never matches
- decline returns user to queue
- retry idempotent

---

# Phase 5 — Live audio

## P5.1 Room token
- scoped/short lived
- exact room

## P5.2 Call UI
- mic permission
- mute
- timer
- reconnect
- end

## P5.3 No-recording guard
- configuration/test proving egress not enabled

Acceptance:
- two valid participants connect
- third unauthorized token cannot join
- expired token fails
- reconnect works

---

# Phase 6 — Completion/quality

## P6.1 End session
- server authoritative
- duration
- end reason

## P6.2 Rating
- structured

## P6.3 Block
- persistent hard constraint

Acceptance:
- rating only by session owner
- one rating/session
- block excludes future match

---

# Phase 7 — Safety

## P7.1 Safety case
- button
- reason codes
- supervisor alert

## P7.2 Supervisor console
- acknowledge
- escalate
- resolve
- audit

## P7.3 Crisis resources
- configurable content
- last-verified date

Acceptance:
- tabletop all scenarios
- safety alert delivered through primary + backup channel
- no AI in decision path

---

# Phase 8 — Refunds/payouts

## P8.1 Refund console
## P8.2 payout proposal
## P8.3 finance approval
## P8.4 reconciliation

Acceptance:
- no automated payout without approval
- historical compensation immutable
- dispute hold works

---

# Phase 9 — Counselling funnel

Only after listener MVP is stable.

## P9.1 Counsellor tier
- credential verification status
- availability
- pricing

## P9.2 Referral
- offer after listener session
- attribution

## P9.3 Scheduling
Build simple slots internally before importing a large scheduling platform.

Acceptance:
- referral funnel measurable end to end

---

# Phase 10 — Analytics/experiments

## Events
Define schema in code.

No sensitive free text.

Acceptance:
- event validation
- user/session IDs pseudonymized in analytics
- no auth identifiers
- opt-out/consent behavior as approved

---

# Deferred backlog

Do not pull into MVP:
- chat
- video
- native app
- community
- AI
- ML matching
- B2B
- groups
- self-host LiveKit
- Redis
- Kafka
- microservices
- data warehouse
