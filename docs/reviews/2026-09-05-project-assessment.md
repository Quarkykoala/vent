# Vent project assessment — 5 September 2026

**Verdict: keep the existing modular structure; complete and harden the core listener flow before a paid pilot.** The repository contains useful domain and database work, but the browser cannot complete the advertised purchase-to-listener-session journey. Several success responses describe external effects that the implementation does not perform. A passing build therefore substantially overstates product readiness if read in isolation.

Review snapshot: branch `hardening/real-mvp-vertical-slice`, commit `d3ca22b`. The pre-existing untracked `.commandcode/` directory was preserved. The user attributes all code to Gemini 3.8 Flash and prompting to ChatGPT 5.6 High on ChatGPT web; that provenance was supplied by the user, not independently verified. Three Luna subagents assisted with context mapping, auth/database review, and payment/session review. No Pioneer provider call was made. The parent agent inspected the important findings and ran the local checks below.

**Verification actually performed**

| Check | Result | Evidence and limit |
|---|---|---|
| Domain tests | 80 passed, 11 files | [Package test log](C:/Users/lenovo/projects/vent/logs/agent-runs/2026-09-05-project-review/vent-review-package-tests.log) |
| Validation tests | 14 passed, 3 files | Same package log |
| DB package tests | 5 passed, 1 file | These instantiate clients and inspect SQL text; they do not migrate or exercise PostgreSQL |
| Web tests | 38 passed; 12 suites failed during setup; 92 tests skipped | [Web test log](C:/Users/lenovo/projects/vent/logs/agent-runs/2026-09-05-project-review/vent-review-web-tests.log). Forced loopback Supabase URL and dummy credentials; no production data. Docker's Linux engine was unavailable and no local Supabase API was listening |
| `pnpm typecheck` | Passed across four packages | [Typecheck log](C:/Users/lenovo/projects/vent/logs/agent-runs/2026-09-05-project-review/vent-review-typecheck.log) |
| `pnpm build` | Passed; Next.js 15.5.25 | [Build log](C:/Users/lenovo/projects/vent/logs/agent-runs/2026-09-05-project-review/vent-review-build.log) |
| Manual browser check | Landing, age-checkbox gating, submit, crisis navigation exercised | Production build served on loopback port 3100 in isolated Chrome. Submit stays on the landing page. [Post-submit snapshot](C:/Users/lenovo/projects/vent/logs/agent-runs/2026-09-05-project-review/browser-after-start-session.yml), [crisis snapshot](C:/Users/lenovo/projects/vent/logs/agent-runs/2026-09-05-project-review/browser-crisis.yml) |
| Local API probes | Reproduced missing-secret webhook acceptance and non-idempotent response-only request creation | [Webhook probe log](C:/Users/lenovo/projects/vent/logs/agent-runs/2026-09-05-project-review/vent-review-http-probes.log), [corrected request probe log](C:/Users/lenovo/projects/vent/logs/agent-runs/2026-09-05-project-review/vent-review-support-probes.log) |

Total: **137 tests passed**. The full suite is **not green**. The 92 skipped tests are downstream of setup failures, not evidence that database behaviors passed. The checked-in Playwright test file was inspected but not executed; the browser observations above are manual automation. The lint scripts run `tsc --noEmit` again, so the configured lint gate adds no separate lint analysis.

The first request probe used an invalid topic and correctly received HTTP 400. The corrected probe used the exact supported topic `Relationship Conflict`; only that corrected run supports the request-creation finding. The webhook probe used a synthetic non-capture event so it could verify signature handling without attempting a payment mutation.

**What is worth keeping**

- The Next.js application plus separate domain, validation, and DB packages fit the documented modular monolith.
- Domain state machines, deterministic matching, Bayesian scoring, integer-paise pricing, and ledger balancing have passing local tests.
- SQL transactions contain row locks and active-reservation constraints. These are useful controls, although migration execution and concurrent live behavior remain unverified in this review.
- The main webhook processor validates HMAC, amount/currency and payment state; the vulnerability below is in an alternate route around that processor.
- Token issuance checks session participation and constructs room-scoped, short-lived claims. Real two-party media, disconnection, recording configuration and provider behavior were not tested.
- Public crisis navigation and the landing age-checkbox gate work in the browser.

**F01 — P1: privileged database procedures are not isolated from direct API callers. SOURCE-VERIFIED; deployed privileges unverified.**

The atomic matching, capture, session completion, safety, refund, payout and erasure functions use `SECURITY DEFINER` in the exposed `public` schema. The migration chain contains no function `REVOKE EXECUTE`, restricted grants, or changed function defaults. Several procedures trust supplied caller IDs/roles instead of deriving the caller from an authenticated database context. See [capture RPC](C:/Users/lenovo/projects/vent/supabase/migrations/20260903000003_atomic_payment_capture.sql:4), [erasure RPC](C:/Users/lenovo/projects/vent/supabase/migrations/20260903000008_dpdp_erasure.sql:4), and [API schema configuration](C:/Users/lenovo/projects/vent/supabase/config.toml:7).

With the default function privileges, a direct Data API caller can bypass the Next.js authorization/webhook handlers. The exact mutation still requires the function's target IDs and other inputs. Supabase documents that functions are executable by any role by default and require explicit restriction: [official function privilege guidance](https://supabase.com/docs/guides/database/functions#function-privileges). No deployed routine privileges were queried, so this is a confirmed migration defect with environment-dependent live exposure.

Two related database authorization gaps are also present:

- `payout_batches` is created after the blanket table revocations, with no RLS enablement or explicit grants/revokes anywhere later in the migration chain. Earlier revocations do not apply to future tables. Actual anonymous/authenticated access depends on the database defaults. [Table creation](C:/Users/lenovo/projects/vent/supabase/migrations/20260903000006_finance_refunds_payouts.sql:5). This violates the repo's RLS requirement even in an environment whose defaults deny access; [Supabase's grants/RLS explanation](https://supabase.com/docs/guides/database/postgres/row-level-security) describes the two separate controls.
- An authenticated user retains INSERT on `support_requests`, and the INSERT policy checks ownership only. A user can insert an owned request already marked `queued`, with no payment reference. `atomic_reserve_match` checks queue state and listener conditions but not captured-payment entitlement. Restricting function execution alone will not fix that invariant. [INSERT grant](C:/Users/lenovo/projects/vent/supabase/migrations/20260902000002_rls_policies.sql:50), [policy](C:/Users/lenovo/projects/vent/supabase/migrations/20260902000002_rls_policies.sql:89), [reservation checks](C:/Users/lenovo/projects/vent/supabase/migrations/20260903000002_atomic_matching_transactions.sql:26). The live RLS suite checks insertion under another user's ID, not forged lifecycle fields on one's own row.

**F02 — P1: the advertised session flow stops at a synthetic response. REPRODUCED LOCALLY and source-verified.**

The only routed browser pages are `/` and `/crisis`. The landing form calls `/api/support-requests`; that handler validates input, generates a UUID, and returns HTTP 201 without authentication, database persistence, payment, or matching. The page then displays a checkout success message without opening checkout. Two unauthenticated requests with the same idempotency key returned different UUIDs. The payment-order API subsequently expects a durable owned support-request row that this route never creates.

Evidence: [request handler](C:/Users/lenovo/projects/vent/apps/web/src/app/api/support-requests/route.ts:17), [landing submit](C:/Users/lenovo/projects/vent/apps/web/src/app/page.tsx:15), [payment prerequisite](C:/Users/lenovo/projects/vent/apps/web/src/app/api/payments/orders/route.ts:25).

Listener presence toggle/heartbeat also only echo successful JSON. No inspected coordinator selects candidates, invokes the matcher, creates a session after acceptance, or connects the audio/rating components to a page. A `SessionRepository.createSession` method exists, but no production caller was found. See the [architecture dossier](C:/Users/lenovo/projects/vent/audit-context/DOSSIER.md) for the complete map. Repository-external automation was not inspected.

**F03 — P1: an alternate webhook endpoint accepts a known fallback secret. REPRODUCED LOCALLY.**

`/api/webhooks/razorpay` substitutes a hard-coded placeholder when `RAZORPAY_WEBHOOK_SECRET` is absent, then passes it to the otherwise fail-closed processor. In the local production build, a synthetic event signed with that placeholder returned HTTP 200; the same request to `/api/payments/webhook` correctly returned HTTP 503 for missing configuration. [Affected route](C:/Users/lenovo/projects/vent/apps/web/src/app/api/webhooks/razorpay/route.ts:13).

The probe proves signature acceptance under missing configuration. It did not prove a database capture or move money. Source inspection shows that a captured-status payload continues into the same capture processor, so an exposed, misconfigured deployment is vulnerable to forged payment claims.

**F04 — P1: safety notifications are marked delivered without dispatch. SOURCE-VERIFIED.**

`buildSafetyAlertNotifications` creates objects with `delivered: true` for SMS/dashboard/pager; it makes no delivery call. The safety API returns these objects as `alertsDispatched` and tells the caller a supervisor was alerted. A unit test asserts these hard-coded booleans, so its pass does not prove notification delivery. [Notification function](C:/Users/lenovo/projects/vent/packages/domain/src/safety/safety-manager.ts:62), [API response](C:/Users/lenovo/projects/vent/apps/web/src/app/api/safety-cases/route.ts:34), [test](C:/Users/lenovo/projects/vent/packages/domain/tests/safety.test.ts:33).

The case-creation transaction exists; primary and backup human notification delivery, acknowledgement visibility and operational failover are not implemented by these objects. No external notification dispatcher or supervisor console was found in the inspected tree. This is a release blocker for a supervised emotional-support service.

**F05 — P1: refund success does not mean the payment provider refunded the customer. SOURCE-VERIFIED.**

The refund endpoint calls only a PostgreSQL RPC. That RPC marks the payment `refunded`, creates compensating ledger entries and cancels associated requests. There is no Razorpay refund call, durable dispatch, provider refund ID or settlement confirmation. A partial refund also sets the entire payment to `refunded`. [Route](C:/Users/lenovo/projects/vent/apps/web/src/app/api/finance/refunds/route.ts:60), [SQL](C:/Users/lenovo/projects/vent/supabase/migrations/20260903000006_finance_refunds_payouts.sql:79).

Additionally, the endpoint derives eligibility from client-supplied `failureReason` and `durationSeconds` (defaulting to zero), rather than loading authoritative session telemetry. It does not honor `requiresSupervisorReview` before execution. An owner can therefore claim no connection and obtain a local full-refund record independently of actual session duration. [Client fields and calculation](C:/Users/lenovo/projects/vent/apps/web/src/app/api/finance/refunds/route.ts:10), [policy](C:/Users/lenovo/projects/vent/packages/domain/src/finance/refund-policy.ts:30).

Payout execution similarly records local execution without evidenced bank/provider transfer, while reconciliation compares local debit/credit sums rather than external provider transactions. Those endpoints cannot prove settlement merely by returning a balanced ledger.

**F06 — P1: reservation and session timeouts are not wired into an authoritative runtime. SOURCE-VERIFIED.**

The reservation expiry file is an exported function requiring an injected repository. No Trigger.dev SDK registration, configuration, schedule or caller was found. Decline/expiry primitives do not constitute an operating rematch worker. [Expiry function](C:/Users/lenovo/projects/vent/trigger/jobs/reservation-expiry.ts:11).

The visible 20-minute countdown stops decrementing at zero; it does not end the session. The token route can issue new tokens for a nonterminal session without a maximum-duration check, and no room-disconnect watchdog was found. [Countdown](C:/Users/lenovo/projects/vent/apps/web/src/features/sessions/AudioCallInterface.tsx:24), [token endpoint](C:/Users/lenovo/projects/vent/apps/web/src/app/api/sessions/[id]/token/route.ts:29). This does not substantiate the automatic disconnect/presence-release claim in `ACCEPTED_MVP_RISKS.md` RISK-006. LiveKit token expiry and ending an already-connected room are separate behaviors; no live media duration experiment was run.

**F07 — P1: payment creation and capture lack a strict one-request/one-entitlement binding. SOURCE-VERIFIED.**

Order creation checks request ownership, but does not reject retries with an existing order/payment or enforce the expected request state. It creates a new provider order/payment on each call and ignores the request-link update result. The capture RPC queues all of the payment user's `created`/`paid` requests whose payment reference is null or equal to the captured payment, instead of one authoritative purchased request. [Order handler](C:/Users/lenovo/projects/vent/apps/web/src/app/api/payments/orders/route.ts:25), [link update](C:/Users/lenovo/projects/vent/apps/web/src/app/api/payments/orders/route.ts:100), [capture update](C:/Users/lenovo/projects/vent/supabase/migrations/20260903000003_atomic_payment_capture.sql:111).

Retries can create extra orders; one capture can queue multiple unpaid same-user requests. These transaction paths were not exercised against a live database in this review.

**F08 — P2: token-based provisioning asserts adult confirmation without evidence. SOURCE-VERIFIED.**

`getUserFromToken` creates a missing user row with `ageVerifiedAt` set to the current time. This path receives no age-confirmation input. A valid Supabase token from another enabled auth flow or a pre-existing Auth account can therefore cause adult verification to be recorded without the app's age gate. The mocked test expects this provisioning behavior. Production exploitability depends on enabled Auth flows; the integrity gap is present in the code. [Provisioning](C:/Users/lenovo/projects/vent/apps/web/src/features/auth/supabase-auth-service.ts:117).

**Limits of the current quality gates**

- Some well-named tests check pure objects, duplicate calculations or SQL strings. They are useful unit checks, but labels such as "real", "integration" and "tabletop" do not turn them into delivery, RLS, media or clinical validation.
- Actual live integration tests do exist. They failed at local environment setup in this run, so their expected safety/auth/payment guarantees remain unverified here.
- CI runs install, typecheck, tests and build, but contains no Supabase startup/migration step or configured integration credentials. The ungated live web tests make a fresh CI run depend on infrastructure that the checked-in workflow does not provision. The workflow also does not run the Playwright smoke test.
- `any` casts appear throughout routes and DB access, weakening what the passing typecheck can establish. This is secondary to the concrete authorization and workflow defects above.
- `ACCEPTED_MVP_RISKS.md` says simulator flags are strictly disabled in production; the inspected order/token branches do not visibly enforce a production guard. Its claims should be reconciled with runtime evidence.
- Crisis-resource verification dates, legal/compliance wording, provider account settings, migrations from an empty database, hosted status, real payment/refund settlement, two-party audio and notification failover were not validated. No production data was accessed.

**Recommended sequence**

1. Repair the privileged DB boundary: function privileges/caller authority, every private table's RLS/grants, and captured-payment entitlement enforcement. Prove ALLOW and DENY cases against an isolated database, including direct RPC callers and forged state on an owned row.
2. Remove the alternate webhook fallback, bind order/capture to one request idempotently, and make financial status depend on an actual provider result or an explicit pending workflow. Derive refund facts server-side.
3. Replace synthetic safety delivery receipts with real primary/backup dispatch and observable human acknowledgement while retaining the approved human-controlled SOP.
4. Connect one complete flow: adult confirmation and OTP -> durable request/order -> provider test-mode capture -> queue/matching -> listener acceptance -> real two-party audio -> authoritative timeout/end -> rating. Persist and schedule retries/expiry at each boundary.
5. Make local/CI database setup reproducible and run the actual integration suite plus browser flows, including failure and retry paths. Defer further counselling/analytics expansion until this core flow satisfies the existing backlog gates.

**Completion record**

Task: Inspect Vent and assess implementation/readiness with Luna assistance.
Backlog item: Cross-cutting review, principally P0-P8; no implementation item executed.
Files changed: Review report, architecture dossier, local test/browser evidence and generated harness/index artifacts only.
Behavior changed: None; application source and migrations unchanged.
Tests run: Package tests, web tests, workspace typecheck, production build, manual browser interactions and two local API probes as detailed above.
Security/privacy impact: Identified release-blocking issues; no production access, secrets disclosure, payment movement or external notifications.
Data migration: None applied; deployed DB/RLS behavior remains unverified.
Observability: Saved logs and browser snapshots; no runtime monitoring added.
Known risks: F01-F08; full suite blocked on local Supabase setup; external integrations not live-verified.
Not done: Fixes, commit, push, deployment, provider sandbox E2E, formal security/clinical/operational signoff.
