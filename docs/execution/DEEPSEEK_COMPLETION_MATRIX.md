# DeepSeek completion matrix — frozen acceptance inventory

Created 2026-09-12 (Asia/Calcutta) on branch `hardening/real-mvp-vertical-slice`.
Source of truth: `PRD.md` §12–§19, `IMPLEMENTATION_BACKLOG.md` phases 0–10, `SECURITY_SAFETY.md`
launch gates, `ACCEPTED_MVP_RISKS.md`, and the nine review leads in the DeepSeek mission.

## Status vocabulary (only these values)

`NOT_STARTED` · `IN_PROGRESS` · `IMPLEMENTED_UNVERIFIED` · `VERIFIED_LOCAL` ·
`VERIFIED_PROVIDER_SANDBOX` · `VERIFIED_DEPLOYED` · `HUMAN_APPROVED` · `BLOCKED_EXTERNAL` ·
`DEFERRED_NON_GOAL`

**Proof-level rule:** a route, RPC, component, HTTP 200, mocked receipt or passing test name is
not proof. `VERIFIED_LOCAL` requires an executed check against the real local application or
database boundary with the persisted postcondition inspected. Provider, deployment and human
gates are never inferred from local evidence.

## A. Review leads (mission §3)

| ID | Criterion | Proof needed | Status | Location | Evidence | Owner |
|---|---|---|---|---|---|---|
| L1 | One captured payment authorizes exactly one request; no client callback grants entitlement | DB + API + concurrency | VERIFIED_LOCAL | `20260912000001_authority_lifecycle_and_binding_repair.sql`, `api/payments/orders` | `tests/lifecycle-binding-authority.test.ts` (4 cases), unchanged review probe `actualQueuedRequests: 1` | Done |
| L2 | Recovery RPC privileges correct in the live DB | Real `has_function_privilege` + PostgREST DENY | VERIFIED_LOCAL | `20260912000001` §6 | `tests/db-authority.test.ts` 15/15 incl. new DENY case; probe `status 401 / 42501` | Done |
| L3 | Terminal acceptance replay inert | DB postcondition equality | VERIFIED_LOCAL | `20260912000001` §2–§3 | probe `accept-replay-after-end` passes unchanged; `tests/lifecycle-binding-authority.test.ts` | Done |
| L4 | Connected browser journey executes offer→accept→session→end→rating with two contexts | Playwright against real stack | VERIFIED_LOCAL | `apps/web/e2e/integrated-journey.spec.ts` | 17.8 s two-context journey; rating row inspected in Postgres; suite 4/4 (`logs/agent-runs/deepseek-completion/playwright-full.log`) | Done |
| L5 | Real provider Checkout interaction with server-owned order, cancel/fail/retry, fail-closed | Provider sandbox or explicit blocker | IMPLEMENTED_UNVERIFIED + BLOCKED_EXTERNAL | `features/payments/razorpay-checkout.ts`, `app/page.tsx` | Checkout.js wired (server-owned order, dismiss/failure states, no prefill, fail-closed when the key is a simulator or the script cannot load); 4/4 unit tests; **provider sandbox run impossible without credentials** | Human gate for sandbox |
| L6 | Audio proves media + session authority (cap, disconnect, timer, safety control, terminal denial) | LiveKit sandbox / server authority tests | VERIFIED_LOCAL (authority) / BLOCKED_EXTERNAL (media) | `app/session/[id]`, `api/sessions/[id]/token`, `AudioCallRoom`, `livekit-service.deleteRoom` | cap RPC + tests, countdown, always-available safety bar, terminal token denial, room teardown on end and on safety escalation | Human gate for media |
| L7 | Schedulers/workers actually run (idempotent, retrying, observable, restart-safe) | Real execution + restart proof | VERIFIED_LOCAL | `api/operations/cron`, `features/operations/worker.ts`, `scripts/operations-worker.mjs` | real process run + restart proof + 7/7 tests; jobs now also cover ledger integrity | Deployment registration |
| L8 | Safety and money outcomes truthful (pending/provider-accepted/delivered/failed/ambiguous) | Durable states + adapters + local receiver | VERIFIED_LOCAL (both halves) | `api/safety-cases`, `features/safety/alert-channels.ts`, `features/payments/razorpay-refunds.ts`, migration `20260912000003` | alert states + audit rows 6/6; refunds are pending→provider→settled with ledger posted only on settlement 8/8; agentic/env sandbox still BLOCKED_EXTERNAL | Human gate for provider settlement |
| L9 | Honest test + lint baseline | Repaired fixture, inventoried warnings | VERIFIED_LOCAL | `tests/auth-live-supabase.test.ts` | 6/6 (was a whole-suite `beforeAll` failure); lint 0 errors / 626 warnings, one rule | Done |

## B. Backlog phases 0–10

| ID | Backlog item | Proof needed | Status | Location / note |
|---|---|---|---|---|
| P0.1 | Bootstrap: pnpm, lint, format, typecheck, Vitest, Playwright, env validation, CI | Commands reproducible | VERIFIED_LOCAL | root scripts; `pnpm typecheck` clean; CI workflow present (hosted run = BLOCKED_EXTERNAL) |
| P0.2 | Domain enums + state machines, invalid transitions fail | Unit tests | VERIFIED_LOCAL | `packages/domain` 80 tests pass |
| P0.3 | Core tables, constraints, indexes; migrate from empty DB | Fresh-DB migrate | IN_PROGRESS | 13 migrations; fresh-DB run pending in this mission |
| P0.4 | RLS policies + grants; allow/deny tests | Real DB allow/deny | VERIFIED_LOCAL | `rls-hardening-11-personas`, `db-authority` |
| P1.1 | User OTP, pseudonymous handle, age gate | Browser + DB evidence | VERIFIED_LOCAL | `phone-signin.spec.ts`, `age-evidence.test.ts` |
| P1.2 | Staff/listener roles, MFA for admin, separate staff routes | Role matrix E2E | IN_PROGRESS | role claims exist; MFA is claim-checked only — real MFA enrolment BLOCKED_EXTERNAL |
| P2.1 | Listener profile create/review, languages/topics, training expiry, status | Authorized staff action | VERIFIED_LOCAL | `api/listeners/review` + audit |
| P2.2 | Presence toggle, heartbeat, stale TTL, active session never killed | Real DB | VERIFIED_LOCAL (sweep trigger path = L7) | `presence-persistence.test.ts` |
| P3.1 | Server-created order, checkout | Provider sandbox | IN_PROGRESS | real Razorpay Orders call exists; browser checkout = L5 |
| P3.2 | Webhook signature, idempotency, payment state | Replay + forgery tests | VERIFIED_LOCAL | `payment-webhook`, `webhook-route-security` |
| P3.3 | Balanced journal + capture/refund | Property test | VERIFIED_LOCAL | ledger balance asserted in billing/refund tests; immutability not trigger-enforced |
| P4.1 | Request creation with paid entitlement | Browser + DB | VERIFIED_LOCAL | `support-request-flow`, `page.tsx` |
| P4.2 | Hard filters then deterministic score; components persisted; atomic reservation | Concurrency tests | VERIFIED_LOCAL | `matching-concurrency`, `matching-coordinator` |
| P4.3 | Offer timeout/rematch, decline, worker retry/restart | Deterministic coordination | IN_PROGRESS | lazy expiry + ops route; no scheduler (L7) |
| P5.1 | Server-only scoped short-lived room token, exact room | Third-party denial test | VERIFIED_LOCAL | `audio-call.test.ts`, `security-adversarial.test.ts` |
| P5.2 | Call UI: mic permission, mute, timer, reconnect, end | Browser | IN_PROGRESS | timer + reconnect missing (L6) |
| P5.3 | No recording/egress/transcription | Config + code proof | IMPLEMENTED_UNVERIFIED | structurally absent; provider-config proof needs credentials |
| P6.1 | Server-authoritative end, duration, reason | Real DB | VERIFIED_LOCAL | `atomic_end_session` + settlement fix |
| P6.2 | Structured rating, one per session, owner-only | DB constraint + tests | VERIFIED_LOCAL | `completion-ratings-blocks` |
| P6.3 | Block is a hard matching constraint | Rematch denial test | VERIFIED_LOCAL | `completion-ratings-blocks`, coordinator block filter |
| P7.1 | Safety button, reason codes, supervisor alert | In-session UI + dispatch | IN_PROGRESS | API exists; no in-session control; delivery faked (L6, L8) |
| P7.2 | Supervisor console: acknowledge, escalate, resolve, audit | Real records | IN_PROGRESS | ack/resolve wired; resolve code invalid; no transition guards; actor role hard-coded |
| P7.3 | Crisis resources always accessible | Public page | VERIFIED_LOCAL | `/crisis`, public by design |
| P8.1 | Refund console with authoritative eligibility | Provider sandbox | IN_PROGRESS | local ledger only, no provider refund call (L8) |
| P8.2 | Payout proposal from real earnings, immutable history | Real computation | IN_PROGRESS | proposal takes caller-supplied amount |
| P8.3 | Human finance approval gate in SQL | DB-level proof | VERIFIED_LOCAL | `atomic_execute_payout_batch` refuses unapproved |
| P8.4 | Reconciliation vs provider, no destructive auto-correct | Provider sandbox | IN_PROGRESS | trial balance only; provider diff orphaned (L8) |
| P9.1 | Verified counsellor supply, credential status | Real supply | BLOCKED_EXTERNAL | fail-closed 503; no supply exists |
| P9.2 | Referral with consent + attribution | Funnel evidence | IMPLEMENTED_UNVERIFIED | `counselling-funnel` tests; no real supply |
| P9.3 | Scheduling with real slots | Real supply | BLOCKED_EXTERNAL | no fabricated slots |
| P10.1 | Minimized analytics, pseudonymous ids, no sensitive text | Event validation + proof | IN_PROGRESS | `/api/analytics/events` persists nothing while returning `ingested` |
| P10.2 | Deferred experiments gated by real milestones | n/a | DEFERRED_NON_GOAL | PRD §17 |

## C. PRD §19 definition of product done

| ID | Criterion | Status |
|---|---|---|
| DOD-1 | user can pay → queue → match → connect → complete → rate | VERIFIED_LOCAL (provider boundary simulated) |
| DOD-2 | listener can onboard → go online → accept → connect → finish | VERIFIED_LOCAL |
| DOD-3 | admin can refund, suspend, review incident, reconcile payout | IN_PROGRESS |
| DOD-4 | safety escalation tabletop-tested | HUMAN_APPROVED gate (clinical) |
| DOD-5 | security review passes | BLOCKED_EXTERNAL / HUMAN_APPROVED |
| DOD-6 | RLS tests pass | VERIFIED_LOCAL |
| DOD-7 | payment webhook replay tests pass | VERIFIED_LOCAL |
| DOD-8 | no recordings/transcripts created | IMPLEMENTED_UNVERIFIED (provider config proof pending) |
| DOD-9 | on-call runbook exists | IN_PROGRESS |

## D. Freeze rule

This inventory is frozen as of the run start. Newly discovered requirements are **added** with a
new ID and a note; no mandatory criterion is ever removed, relabelled or re-scored to improve the
completion percentage.
