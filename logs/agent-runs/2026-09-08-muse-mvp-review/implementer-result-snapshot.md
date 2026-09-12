# Muse MVP completion result — 2026-09-07

Branch `hardening/real-mvp-vertical-slice`, HEAD `d3ca22b397b5d50d468ee7fb162c4e09dc8ff655` plus
uncommitted implementation (nothing committed, pushed, deployed or reset; no DB reset).

## Acceptance table

| Criterion | Behavior | Location | Verification | Result | Remaining dependency |
|---|---|---|---|---|---|
| Sign-in + request, no duplicates, truthful confirmation | Completed-request state blocks resubmit until explicit new request; same idempotency key retained; confirmation shows saved state + payment as next step | `app/page.tsx`, `e2e/phone-signin` | E2E 3/3, unit 39 | Pass | None |
| Checkout + paid queue | Simulator/retry-safe order creation; owner payment-status read; browser callback never grants entitlement | `api/payments/orders`, `api/support-requests/[id]/payment-status`, home checkout panel | payment tests 10/10 + 3/3; live: order 19900 → signed capture → queued → replay idempotent → forgery 400 | Pass (simulated provider) | Real Razorpay keys/acceptance |
| R4 captured-payment binding | Coordinator verifies linked payment exists + captured + same user | `features/matching/coordinator.ts` | 3 new R4 cases, 13/13 suite | Pass | None |
| Listener console + waiting screen | Own profile/presence/offers (no PII); owner queue status with honest states, no wait-time claims | `app/listener`, `app/queue`, `api/listeners/console`, `api/support-requests/[id]/queue-status` | console/queue tests 6/6; browser render | Pass | None |
| R2 accept recovery | Retry converges on exactly one session via `atomic_accept_session_recovery` | migration `20260908000001`, accept route, `MatchingRepository.recoverSession` | R2 retry test + updated duplicate test | Pass | None |
| Expiry wiring | Idempotent ops entrypoints + lazy expiry; scheduler documented, not running | `api/operations/*`, `docs/operations-SCHEDULER.md` | expiry idempotency tests | Partial | Scheduler registration |
| Audio + completion | Session page on real `AudioCallRoom`/SDK state; server token + server end; unsupported E2E-encryption/pseudonymity claims softened | `app/session/[id]`, `AudioCallRoom` | token tests 5/5; completion 6/6; live token 503 fail-closed, end+rate persisted | Partial | LiveKit creds + real media |
| Post-session/account | Owner history, structured rating + block, talk-again, payments, erasure request, truthful counsellor availability | `app/history`, `api/history` | history 3/3; counselling 2/2 + funnel 4/4 | Pass | Counsellor supply |
| Counsellor truthfulness | Fabricated doctors removed; slots from verified DB rows; booking fail-closed 503; schema drops client userId | `api/counselling/slots`, `api/counselling/book` | tests + typecheck | Pass | Verified supply + scheduling |
| Operator consoles | Listener review + audit, live queue, safety acknowledge/resolve, refund proposal, reconcile | `app/ops`, `api/listeners/review`, `api/operations/queue`, safety GET | ops-console 5/5 | Pass | Payout execute stays API-level by design |
| Sweeper race | Conditional write re-checks state + heartbeat | `ListenerRepository.sweepStalePresence` | branch tests | Pass | None |

## Engineering checks

- `pnpm typecheck`: pass (all packages).
- `pnpm lint`: 0 errors, 608 warnings (baseline 476; new files follow the repo's existing cast style; warning cleanup out of scope).
- `pnpm build`: pass, 36 static/dynamic routes.
- `pnpm test`: domain 80 + validation 14 + db 5 + web 231 passing, 6 skipped; sole failure is the pre-existing `auth-live-supabase.test.ts` beforeAll fixture collision, which fails identically on pristine sources.
- Browser: integrated pay→queue journey, phone-signin x2, smoke — 4/4 on Chromium.
- API handshake on this build: match reserved → accept → session/room → server end (ended, 8s) → 5-star rating with Bayesian update; all persisted rows inspected; fixtures cleaned except append-only payment/ledger/idempotency rows per existing test hygiene.

## What is simulated vs real

- Simulated: SMS delivery (local test-OTP map), Razorpay order/money (simulator ids + locally signed webhook through the real HMAC path), LiveKit media (no audio packets flowed).
- Real: OTP verification, auth, persistence, entitlement checks, matching, ledger, state transitions, audit, RLS-gated reads.

## Human approvals still required

Independent security review, clinical tabletop + safety-dispatch proof, RLS/launch-gate sign-off, production credentials (Razorpay, LiveKit, SMS), scheduler registration, counsellor supply/content, payout execution, deployment/runbook review.

```text
Task: Complete the Vent MVP across milestones A–F with integrated verification.
Backlog item: P1.1/P4.1 completion, P3 checkout, P4.2/P4.3 matching, P5 audio, P6 completion, P7 safety console, P8 refund/payout review, P9 truthful referral; R2/R4 repairs.
Files changed: page.tsx + 6 new pages (queue, listener, session/[id], history, ops), PhoneSignIn reuse, coordinator (R4), orders (retry-safe), payment-status/queue-status/history/console/review/ops-queue/safety-GET endpoints, accept-route R2 rewrite, recoverSession, recordAgeVerification already in place, sweeper race guard, counselling fail-closed, 1 migration + ROLLBACK note, scheduler doc, 8 new/extended test files, smoke/phone-signin/integrated e2e.
Behavior changed: Full user→paid→queue→offer→accept→session→end→rate and listener/operator consoles work on the local stack; no fake success, no fabricated professionals, no implied matching/audio.
Tests run: 330 passing (80+14+5+231), 6 skipped; typecheck/lint/build green except pre-existing warnings + 1 pre-existing suite failure; 4/4 browser; live API handshake with persisted-row proof.
Security/privacy impact: Owner/listener/staff scoping enforced + tested; no PII in listener/ops reads; credentials memory-only; webhook HMAC + fail-closed preserved; payout approval gate intact in RPC.
Data migration: 20260908000001_accept_session_recovery.sql applied to local DB only; no destructive or production changes.
Observability: Scheduler doc + run-state log; no new product telemetry.
Known risks: No real SMS/money/media proof; scheduler not running (lazy expiry covers correctness, slower); shared local DB carries pre-existing fixture leftovers; capture RPC fans out to all matching user requests by design.
Not done: Real provider credentials/acceptance, scheduler registration, counsellor supply, payout execution, safety tabletop, deployment, commit/push.
```
