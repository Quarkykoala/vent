# GLM Completion Matrix — Vent MVP

Maintained by the GLM completion mission. Criteria are frozen from the source documents; discoveries are added transparently. Statuses: NOT_STARTED, IN_PROGRESS, IMPLEMENTED_UNVERIFIED, VERIFIED_LOCAL, VERIFIED_EXTERNAL, HUMAN_APPROVED, BLOCKED.

**Source snapshot for all current evidence:** branch `hardening/real-mvp-vertical-slice`, commit `d3ca22b` + uncommitted working tree (F03 webhook route fix `apps/web/src/app/api/webhooks/razorpay/route.ts`, new `apps/web/tests/webhook-route-security.test.ts`, and mission docs).

**Baseline (run-1, 2026-09-05):** local Supabase stack `*_vent` running on loopback (54321 API / 54322 PG / 54323 Studio). `pnpm typecheck` PASS (4 pkgs). Package tests 99 PASS (domain 80, validation 14, db 5). Web tests **154 PASS / 0 failed / 24 files** (incl. live-DB suites; earlier review's 12 setup failures did not reproduce — local stack was running). `pnpm build` PASS. Logs: `logs/agent-runs/glm-completion/run-1/`.

**Counts are kept at the bottom. Engineering coverage ≠ launch readiness.**

## Phase 0 — Repository, invariants, database authority

| ID | Criterion (source) | Proof required | Status | Evidence / notes |
|---|---|---|---|---|
| P0.1a | Clean install, typecheck, build reproducible (P0.1) | Local run | VERIFIED_LOCAL | run-1 logs; node 24.11.1 / pnpm 11.25.0 |
| P0.1b | Independent lint analysis, not `tsc --noEmit` repeat (P0.1; mission A) | Lint runs real static analysis in CI+local | VERIFIED_LOCAL | ESLint 10 + typescript-eslint 8 flat config; root+package `lint` = `eslint .`; CI Lint step added; 25 pre-existing errors fixed; 422 `no-explicit-any` warnings tracked as follow-up tightening. Evidence: run-1/lint-after-fix.log |
| P0.1c | CI runs full gates incl. DB provisioning; no silent skips (P0.1; mission A) | CI config provisions Supabase; CI run | IN_PROGRESS | Lint step wired (ci.yml); Supabase provisioning + DB/RLS gates in CI still missing; hosted run = external lane |
| P0.1d | No secrets committed (P0.1) | Secret scan clean | NOT_STARTED | `.env.example` has placeholder values only |
| P0.2 | Typed state machines; invalid transitions fail tests; no UI direct mutation (P0.2) | Unit tests + code review | VERIFIED_LOCAL | domain 80 tests incl. 18 state-machine tests; UI mutation review pending F02 rework |
| P0.3a | Migration chain runs from empty DB (P0.3) | Fresh `db reset` evidence | VERIFIED_LOCAL | Two full fresh resets (run-1/db-reset.log, db-reset-f01.log); 10 migrations incl. authority lockdown; live suites pass on reset DB |
| P0.3b | Rollback strategy documented per migration (P0.3) | Doc | VERIFIED_LOCAL | `supabase/migrations/ROLLBACK.md`: reverse steps + production roll-forward policy; extended for new migration; each future migration appends its section |
| P0.3c | Constraints tested (P0.3) | DB tests | IN_PROGRESS | Live suites pass; constraint-specific tests pending |
| P0.4a | RLS allow tests (P0.4) | Real DB execution | VERIFIED_LOCAL | `rls-hardening-11-personas.test.ts` passes vs local DB |
| P0.4b | RLS deny tests incl. cross-user, listener PII denial, anon denial (P0.4) | Real DB execution | VERIFIED_LOCAL | 11-persona suite + F01 direct-RPC/payout_batches denials in db-authority.test.ts |
| F01.1 | SECURITY DEFINER functions not executable by anon/authenticated callers; trusted caller authority restricted; safe search_path (mission A) | Direct-RPC deny tests on real DB | VERIFIED_LOCAL | Migration 20260905000001: REVOKE/GRANT via catalog DO block + default privileges + search_path hardening; 14 real-DB tests in db-authority.test.ts (PGRST202/42501 denials; service-role ALLOW) |
| F01.2 | `payout_batches` has RLS + explicit grants (mission A) | DB catalog + deny tests | VERIFIED_LOCAL | RLS enabled + forced, grants revoked (anon/authenticated); deny tests pass |
| F01.3 | Users cannot INSERT forged lifecycle state on own `support_requests` row (mission A) | DB deny test | VERIFIED_LOCAL | Hardened INSERT policy (state='created', no payment link/timestamps); forged queued/paid-link inserts denied; legit created insert allowed |
| F01.4 | Privileged ops use restricted trusted role; anon/authenticated cannot acquire it via IDs/role strings (mission A) | Tests | VERIFIED_LOCAL | All RPC callers verified to use service-role admin client; direct callers cannot execute privileged RPCs (client-supplied actor/role strings reach nothing) |

## Phase 1 — Auth + roles

| ID | Criterion | Proof | Status | Evidence / notes |
|---|---|---|---|---|
| P1.1a | User OTP sign-in works end-to-end (P1.1) | DB-backed test | VERIFIED_LOCAL | supabase-auth-service + auth-guard tests pass |
| P1.1b | Pseudonymous handle | Tests | VERIFIED_LOCAL | Same |
| P1.1c | Durable age-confirmation evidence; F08 fixed (no fabricated 18+ timestamp) | Test proving no-confirmation ⇒ no age_verified_at | VERIFIED_LOCAL | Migration 20260905000002 (nullable evidence column); token provisioning no longer writes a timestamp; support-request creation gated on evidence (403); 3 live-DB tests in age-evidence.test.ts. Evidence: run-1/f08-run1.log |
| P1.2a | Role claims enforced server-side | Role matrix tests | IN_PROGRESS | Adversarial suite covers some denials |
| P1.2b | MFA for admin/staff (P1.2) | Config + test | NOT_STARTED | |
| P1.2c | Separate staff routes + denial behavior; sensitive routes verified independently of UI | Route-level tests | IN_PROGRESS | Partial (Package 12 suite) |

## Phase 2 — Listener onboarding/presence

| ID | Criterion | Proof | Status | Evidence / notes |
|---|---|---|---|---|
| P2.1a | Admin creates/reviews listener; status/languages/topics/training expiry persisted | DB-backed test | NOT_STARTED | Domain/validation logic exists; admin surface missing |
| P2.2a | Presence toggle/heartbeat persisted (F02 scope) | DB-backed test | VERIFIED_LOCAL | Routes authenticate listener role, enforce profile ownership/active status, run domain transition + CAS write; ops sweep route executes sweepStalePresence; 8 live-DB tests in presence-persistence.test.ts incl. 409 invalid-transition and in_session preservation. Evidence: run-1/wp6-run2.log, full-tests-wp6-final.log |
| P2.2b | Stale listener auto-unavailable; active session not killed (P2.2) | Sweeper test | IN_PROGRESS | Sweep verified executing on demand via authenticated ops route (real caller); automatic periodic scheduling pending WP-7 runtime wiring |

## Phase 3 — Payments

| ID | Criterion | Proof | Status | Evidence / notes |
|---|---|---|---|---|
| P3.1 | Server-created order from authoritative pricing; checkout flow | Tests | IN_PROGRESS | Order route exists; F07 gaps |
| P3.2a | Webhook signature verification, idempotency, state (P3.2) | Real-handler tests | VERIFIED_LOCAL | 24 route tests + live suites (154-test baseline) |
| P3.2b | F03 fully closed: exactly-64-hex signature validation before decode; valid-digest+`zz` and +1-hex-digit rejected 400 on both handlers | Real-handler tests | VERIFIED_LOCAL | Defect demonstrated pre-fix (4× HTTP 200 incl. boundary reached); verifySignature enforces `/^[0-9a-fA-F]{64}$/` before decode, timing-safe compare retained; post-fix 28/28 route tests pass. Evidence: run-1/sig-baseline-defect.log, sig-after-fix.log |
| P3.2c | Raw-body verification preserved; 503 fail-closed config; no bearer auth on webhooks | Tests | VERIFIED_LOCAL | webhook-route-security suite |
| P3.3a | Balanced append-only ledger; capture/refund journaling | Property tests + DB | VERIFIED_LOCAL (capture) | live capture+ledger suite passes; refund path under F05 |
| F07.1 | Idempotent order creation; retries don't create extra orders | Tests | NOT_STARTED | |
| F07.2 | Capture bound to exactly one eligible purchased request; one payment cannot queue multiple requests | DB test | NOT_STARTED | |
| F07.3 | Order/request link failures not silently ignored | Tests | NOT_STARTED | |

## Phase 4 — Queue and matching

| ID | Criterion | Proof | Status | Evidence / notes |
|---|---|---|---|---|
| P4.1a | Authenticated durable support-request creation; retry idempotent (F02) | API+DB test | VERIFIED_LOCAL | Route rewritten (auth→validate→rate-limit→persist); SupportRequestRepository with (user,key) idempotency incl. race handling; 6 live-DB tests in support-request-flow.test.ts (401/400/201+persisted/idempotent retry/client lifecycle fields stripped). Evidence: run-1/wp5a-run3.log |
| P4.1b | Paid entitlement required before queue | Test | VERIFIED_LOCAL | Coordinator rejects matching without captured payment link (402 route mapping; not_entitled test asserts no reservation row created) |
| P4.2a | Matcher invoked by a real caller; score components persisted; atomic reservation | DB test via coordinator | VERIFIED_LOCAL | MatchingCoordinator (eligibility query + findBestMatch + atomic RPC) with owner-authenticated POST /api/support-requests/[id]/match; 9 live-DB tests in matching-coordinator.test.ts. Evidence: run-1/wp7-run4.log |
| P4.2b | One active reservation per listener/request enforced by constraints | DB test | VERIFIED_LOCAL | Concurrent-claims test: exactly 1 of 2 parallel atomic claims wins (partial unique indexes + row locks) |
| P4.3a | Offer expiry/rematch/stale-presence jobs registered AND executed by real runtime (F06 scope) | Worker evidence | IN_PROGRESS | Expiry executes via authenticated ops route + lazy expiry in coordinator (both verified, idempotent rerun = no-op); periodic Trigger.dev registration remains external config |
| P4.3b | Decline returns request to queue; accept creates session | Tests | VERIFIED_LOCAL | Decline → queued verified; accept route now creates session idempotently (unique request_id) and transitions accepted→connected |
| P4.3c | Concurrency: parallel claims, duplicate accept, timeout, blocked pair, stale presence, worker restart | Deterministic tests | VERIFIED_LOCAL | All covered in matching-coordinator.test.ts (deterministic via DB locking, no sleeps) + presence suite |

## Phase 5 — Live audio

| ID | Criterion | Proof | Status | Evidence / notes |
|---|---|---|---|---|
| P5.1 | Room token scoped, short-lived, exact room; participant authorization | Tests | VERIFIED_LOCAL (unit) | audio-token tests; route checks participation |
| P5.2a | Call UI wired for user and listener (mic, mute, timer, reconnect, end, mobile layout) | Browser test | NOT_STARTED | Components exist; no page wires them |
| P5.2b | Two-party audio connectivity with synthetic audio | LiveKit test | BLOCKED (ext) | Requires LiveKit Cloud/CLI config — external dependency |
| P5.2c | Third unauthorized token denied; expired token fails | Tests | IN_PROGRESS | Token tests cover claims; route denial live test pending |
| P5.3 | No-recording guard: egress/transcription disabled config + test | Config evidence | NOT_STARTED | |
| F06.1 | Server-authoritative session cap; token refresh guarded; room termination at cap | Tests | NOT_STARTED | |
| F06.2 | Completion persisted; reservation/presence released across disconnects/retries; post-cap reconnect denied | Tests | NOT_STARTED | |

## Phase 6 — Completion/quality

| ID | Criterion | Proof | Status | Evidence / notes |
|---|---|---|---|---|
| P6.1 | Server-authoritative end with duration/end reason | Tests | VERIFIED_LOCAL (unit/RPC) | end route + atomic RPC; wiring into UI pending F02 |
| P6.2 | Rating: owner-only, once per session, structured tags | Tests | IN_PROGRESS | Route-level tests pass; no UI caller |
| P6.3 | Block: persistent hard constraint, excluded from matching | Tests | IN_PROGRESS | Matcher unit tests; DB-level test pending |
| P6.4 | Purchase/session history surfaces | UI/test | NOT_STARTED | |

## Phase 7 — Safety

| ID | Criterion | Proof | Status | Evidence / notes |
|---|---|---|---|---|
| P7.1 | Safety case creation during active session; idempotent; fast; no LLM/analytics dependency | Tests | IN_PROGRESS | Route exists; not wired to session UI |
| F04.1 | Real primary+backup dispatch adapters; no fabricated `delivered: true` | Adapter tests w/ local receiver | NOT_STARTED | |
| F04.2 | Supervisor console: acknowledge/escalate/resolve + audit | Tests + UI | NOT_STARTED | |
| F04.3 | Pending/provider-accepted/delivered/failed states from real provider evidence; idempotent retries | Tests | NOT_STARTED | |
| P7.2 | Crisis resources public, configurable, last-verified | Test | IN_PROGRESS | `/crisis` public; content hard-coded |
| P7.3 | Technical failure exercises (duplicate button, supervisor unavailable, dispatch failure, backup, acknowledgement, outage) | Tests | NOT_STARTED | Clinical tabletop = HUMAN_APPROVED lane |

## Phase 8 — Refunds/payouts

| ID | Criterion | Proof | Status | Evidence / notes |
|---|---|---|---|---|
| F05.1 | Refund eligibility/duration derived from authoritative records; supervisor review honored | Tests | NOT_STARTED | Client-supplied failureReason/durationSeconds today |
| F05.2 | Refund bound to real provider operation + durable provider reference; pending/failed outcomes | Mock-provider tests + sandbox | NOT_STARTED | Sandbox = external lane |
| F05.3 | Full/partial refund, duplicates, concurrent, retry-after-ambiguous-timeout, no over-refund | Tests | NOT_STARTED | Partial refund currently marks whole payment refunded |
| P8.2/3 | Payout proposal, immutable historical compensation, dispute hold, human approval, truthful execution states | Tests | IN_PROGRESS | approve/execute routes + tests exist; truthfulness gap |
| P8.4 | Reconciliation vs provider test records; discrepancies surfaced; no destructive auto-fix | Tests | NOT_STARTED | Local-only comparison today |

## Phase 9 — Counselling funnel (gated on listener MVP stability)

| ID | Criterion | Proof | Status | Evidence / notes |
|---|---|---|---|---|
| P9.1 | Counsellor tier: verification status, availability, pricing | Tests | IN_PROGRESS | Domain+counselling slots routes exist |
| P9.2 | Referral after listener session + attribution | Tests | IN_PROGRESS | referral routes exist; not wired end-to-end |
| P9.3 | Simple internal slot booking | Tests | IN_PROGRESS | book route exists |
| P9.4 | Funnel measurable end-to-end | Events + test | NOT_STARTED | |

## Phase 10 — Analytics/experiments & cross-cutting

| ID | Criterion | Proof | Status | Evidence / notes |
|---|---|---|---|---|
| P10.1 | Validated, minimized event schema; no sensitive free text; pseudonymized IDs | Tests | VERIFIED_LOCAL (unit) | analytics domain tests |
| P10.2 | Log allowlist; no secrets/PII/sensitive text in logs; no session replay | Log-scan test | NOT_STARTED | |
| P10.3 | Retention mechanism per approved sources; no invented legal periods | Tests + config | IN_PROGRESS | Erasure RPC exists; retention registry pending approval |
| P10.4 | Privacy access/export + deletion workflows with audit | Tests | IN_PROGRESS | Erasure suite passes; export pending |
| P10.5 | Admin/quality/queue/earnings views | Tests/UI | NOT_STARTED | |

## Deferred non-goals (stay out of scope)

chat, video, native app, community, AI/ML matching, AI triage/risk scoring, B2B, groups, self-host LiveKit, Redis, Kafka, microservices, data warehouse, recordings, transcripts, minors, cross-border, wallets, surge pricing. Do not pull these in.

## External/human launch-readiness gates (separate lane)

| Gate | Owner | Status |
|---|---|---|
| Real Razorpay sandbox/live verification | Mission + provider account | BLOCKED (no provider credentials) |
| Real LiveKit two-party media verification | Mission + LiveKit config | BLOCKED (no credentials) |
| Hosted CI green run | CI system | BLOCKED (not run yet) |
| Independent security review | Human reviewer | NOT_STARTED |
| Clinical lead tabletop + SOP approval | Clinical lead | HUMAN_APPROVED required |
| Legal: terms, privacy notice, retention schedule, DPDP notices | Counsel | HUMAN_APPROVED required |
| Finance payout policy + human payout execution | Finance | HUMAN_APPROVED required |
| Real-session business validation (Gates A/B) | Business | BLOCKED |

## F01–F08 dispositions (current)

| ID | Finding | Status | Notes |
|---|---|---|---|
| F01 | Privileged RPCs exposed; payout_batches unprotected; forged-state INSERT | RESOLVED_LOCALLY | Migration 20260905000001 + db-authority.test.ts (14 tests); deployed-environment verification remains external |
| F02 | Flow stops at synthetic response | IN_PROGRESS | Durable request creation, presence persistence, coordinator matching/reservation, accept→session creation verified; remaining: payment→queue automation wiring, UI orchestration, audio/rating surfaces |
| F03 | Fallback secret accepted | RESOLVED_LOCALLY | Fallback removed + 64-hex validation enforced; 28 route tests + processor tests green. Independent review follow-up closed |
| F04 | Safety delivery fabricated | OPEN | Phase 7 package |
| F05 | Refunds DB-only, client-trust | OPEN | Phase 8 package |
| F06 | Timeouts not wired to authoritative runtime | OPEN | Phases 4/5 packages |
| F07 | Order/capture entitlement binding weak | OPEN | Phase 3 package |
| F08 | Provisioning fabricates 18+ evidence | RESOLVED_LOCALLY | Evidence column nullable; only the OTP age-gate interaction writes it; request creation gated server-side; regression tests green |

## Counts

- Engineering criteria verified: **25 / 60** (VERIFIED_LOCAL numerator; counted per row above)
- Launch-readiness gates: **0 / 8** (all external/human)
- Criterion rows total: 60 (+gates). Statuses preserved; no criterion deleted or relabeled.
