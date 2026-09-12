# Independent adversarial review — DeepSeek completion run

Reviewer: independent (not the author). Date: 2026-09-12. Repo: `C:\Users\lenovo\projects\vent`
(checkout `hardening/real-mvp-vertical-slice` + uncommitted work, including the two 2026-09-12
migrations). Nothing was modified except this report.

## What I actually ran

| Command / probe | Result |
|---|---|
| `pnpm --filter @vent/web test tests/lifecycle-binding-authority.test.ts tests/db-authority.test.ts tests/operations-worker.test.ts tests/safety-alert-dispatch.test.ts --maxWorkers=2 --minWorkers=1` | **38/38 pass** (10 + 15 + 7 + 6) |
| `pnpm --filter @vent/web test` (whole suite) | **261/261 pass, 38 files** |
| `pnpm typecheck` | **pass** (exit 0) |
| `pnpm lint` (new eslint gate) | **pass, exit 0 — 622 warnings, 0 errors** (all `no-explicit-any`) |
| SQL ACL sweep: `has_function_privilege(anon/authenticated/service_role, oid, 'EXECUTE')` over every `prokind='f'` in `public`, plus `aclexplode(proacl)` PUBLIC count | 14 privileged RPCs = anon `f`, auth `f`, service_role `t`; only `current_user_id` / `current_listener_id` / `current_user_role` anon+auth `t`; **PUBLIC EXECUTE entries = 0** |
| Parallel double-capture of one order (two `psql` calls, different idempotency keys) | 1 capture + 1 `idempotent_replay`; `ledger_entries` = **2** (no double post) |
| SQL probe: safety case on an `ended` session by a participant | case created; session stays `ended`, request stays `completed` (no resurrection) |
| SQL probe: `atomic_expire_session_cap` on an `ended` session | `{"due": false, "reason": "TERMINAL_OR_INACTIVE"}` |
| SQL probe: capture into a payment bound to a `completed` request | payment → `captured`, 2 ledger rows, **`entitlement_bound:false`, `queued_request_id:null`** |
| `pg_policies` dump for lifecycle tables | `sessions`, `support_requests`, `match_reservations` have **no UPDATE policy**; only `listener_presence_update_own` |
| duplicate `payment_order_id` groups in `support_requests` | 0 |
| Live dev server on :3000: `POST /api/operations/cron` (no header / wrong secret / correct secret), `GET|POST /api/safety-cases` unauth | 401 / 401 / 200 + per-job report; 401 / 401 |
| Live worker report (correct secret) | `reconcile_payments` → `capturedWithoutQueuedRequest: 8` |

---

## Validated defects (reproduced or directly observed)

### P1 — In-session safety control and crisis resources disappear exactly when the room fails to load
`apps/web/src/app/session/[id]/page.tsx:181` renders `<AudioCallRoom … onSafetyConcern={handleSafetyConcern}/>`
**only when `sessionId && sessionToken && roomToken && !ended`**. The safety button lives inside
`AudioCallRoom`, and the only crisis link / Tele-MANAS text is inside the `safetyOpen` panel
(`page.tsx:196–210`), which can only be opened from that button. Therefore, before the room token
arrives, if the token request returns 401/409/503 (LiveKit unconfigured, cap reached, expired
session), or after `ended`, the page exposes **no safety control and no crisis resources**.
Evidence: read of the conditional render tree; the same gating is why the e2e journey asserts the
safety button only *after* the timer is visible. This directly clashes with the AGENTS/SECURITY_SAFETY
rule "never hide crisis resources behind login/payment" and the P7.1 "safety must be available during
the active session" criterion.
**Smallest fix:** render a persistent safety/crisis control (button + 112 / Tele-MANAS 14416 +
`/crisis` link) outside the `roomToken` conditional whenever `sessionId && sessionToken`.

### P2 — A captured payment whose bound request is already terminal is accepted: money taken, zero entitlement
The capture RPC (`supabase/migrations/20260912000001_…sql`, step 7) only queues the bound request
when `state in ('created','paid')`. When the bound request is terminal the capture still succeeds,
still posts the balanced double-entry ledger, and returns `entitlement_bound:false`. Reproduced:
`atomic_capture_payment_webhook` on a payment bound to a `completed` request →
`{"state":"captured","entitlement_bound":false,"queued_request_id":null}`, `payment.state=captured`,
2 ledger rows. It is reachable in normal use because `apps/web/src/app/api/payments/orders/route.ts`
never checks the request state (it only checks ownership, `route.ts:31–45`) — a user can create a
fresh order and pay for an already-completed request.
**Smallest fix:** in `orders/route.ts`, refuse to create/bind an order unless `requestRow.state in
('created','payment_failed')` and (`payment_order_id is null` or the linked payment is unpaid); and
have capture return an explicit `ENTITLEMENT_NOT_BOUND` code so finance sees it.

### P2 — `reconcile_payments` metric is misleading and always non-zero in a healthy system
`apps/web/src/features/operations/worker.ts:157–161` flags a captured payment when *no* bound
request is currently `queued`. Requests that legitimately advanced (`reserved`/`accepted`/
`connected`/`completed`) therefore all count. The running worker reported
`capturedWithoutQueuedRequest: 8`; I dumped those 8 rows read-only: **one `reserved`, seven
`completed`** — 8/8 false positives, 0 real orphans (`capturedWithoutAnyRequest: 0`). The job also
returns `changed:0` and the endpoint returns HTTP 200, so real orphans are indistinguishable from
routine lifecycle progress.
**Smallest fix:** only flag captured payments with **no** bound request, or whose bound request is
`cancelled/expired/declined/payment_failed/offer_expired/technical_failed`.

### P2 — "Reconnect audio" performs a full page reload, forcing a fresh OTP mid-session
`apps/web/src/app/session/[id]/page.tsx:191` passes `onReconnect={() => window.location.reload()}`.
Auth is memory-only (the run state itself: "every full page load needs a fresh sign-in"), so a
transient transport drop logs the user out and requires re-verifying the SMS code, dropping the live
session. This is the "reconnect" behaviour claimed under L6/P5.2.
**Smallest fix:** implement reconnect as a token refresh (`setRoomToken(null)` then `fetchRoomToken()`)
rather than a reload.

### P2 — Client-controlled, unvalidated `end_reason` is persisted
`apps/web/src/app/api/sessions/[id]/end/route.ts:13` uses `json.reason || 'normal_completion'` with
no validation; the value is written to `sessions.end_reason` and surfaced by `/api/history` and the
listener console. Violates the AGENTS API checklist ("validate input"; no casual free text).
**Smallest fix:** parse the reason against the existing session end-reason enum and reject others
with 400.

### P2 — Safety case can be opened on an already-ended session; no rate limit on creation
SQL probe A: a participant can call `atomic_create_safety_case` on an `ended` session — it inserts a
new case (and dispatches real alerts) without changing the terminal state. `POST /api/safety-cases`
(`apps/web/src/app/api/safety-cases/route.ts`) has no rate limiting, and `safety_cases` dedup only
covers `open/acknowledged/escalated`, so after a supervisor resolves a case a user can open another
on the same session. Cost-gated (a session requires a captured payment), so this is a
supervisor-queue/alert-noise and SMS-cost concern rather than a bypass. The `idempotencyKey` the
route validates is not used by the RPC.
**Smallest fix:** reject case creation for `ended/failed/safety_ended` sessions unless an explicit
"post-session report" path is intended, and rate-limit `POST /api/safety-cases` per user.

### P2 — Safety ack/resolve audit lies about the actor and has no state guard (confirms matrix P7.2)
`packages/db/src/repositories/safety.repository.ts:54–67` and `86–100`: both
`acknowledgeCase`/`resolveCase` do an unconditional `UPDATE … .eq('id', caseId)` with no
`state` transition guard, and hard-code `actor_role: 'clinical_supervisor'` in `audit_events` even
though `apps/web/src/app/api/safety-cases/[id]/{acknowledge,resolve}/route.ts` also allow
`LISTENER_OPS`. An ops user can resolve an `open` case without acknowledging it and the audit trail
will attribute it to a clinical supervisor. The matrix already lists this as IN_PROGRESS; it is not
fixed by this run.

---

## Suspicions I could not reproduce (read-verified only)

- **`ops_dashboard` is reported `delivered` unconditionally.** `alert-channels.ts:97–104` returns
  `state:'delivered', providerRef:caseId` without checking that the case row exists, and
  `postToWebhook` treats any 2xx as `delivered`. In the route this is called immediately after
  `createCase`, so the user-facing claim is currently true; but the dispatcher alone would claim
  delivery for a non-existent case (the dispatch test does exactly that with a random `caseId`). I
  could not execute the dispatcher standalone (no tsx runner without adding files).
- **Orders-route TOCTOU / orphaned payment.** The read-then-write in
  `payments/orders/route.ts:47–66` + `123–132` is not transactional: two concurrent order calls for
  one request can both create payments, after which only one is bound via the (overwriting)
  `update({ payment_order_id })`. Net effect would be a second captured payment with no request.
  Not reproduced concurrently.
- **Migration data-repair can strip a live link.** The second repair UPDATE in
  `20260912000001_…sql` (`set payment_order_id = null` for `rn > 1`) is unconditional; in a
  production set where a duplicate payment link belonged to a request that already has a session, it
  would orphan that request's payment binding. No such rows exist locally.

---

## Non-issues I checked and cleared

- **Privileged RPCs are service-role only.** Verified at the DB for *every* function in `public`
  (14 privileged + 3 helpers), and zero PUBLIC EXECUTE entries via `aclexplode`. The DENY/ALLOW
  suite (15 tests, real PostgREST calls as anon + authenticated) passes. Author's L2 claim is sound.
- **"One captured payment → exactly one request".** Unique partial index present; 0 duplicate
  `payment_order_id` groups in the live DB; a second insert of the same payment binding fails with
  `23505`; amount/currency mismatch and replay paths refuse; concurrent double-capture posts the
  ledger exactly once. Author's L1/L3 claims are sound.
- **Terminal states are inert.** safety-case-on-ended (session stays `ended`), cap-on-ended
  (`due:false`), accept-after-end and stale-offer `TERMINAL_STATE` all verified against real rows.
- **Listener re-serve.** `atomic_end_session` cancels the `accepted` reservation and releases
  presence; the regression test re-reserves the same listener. Verified.
- **Direct lifecycle writes.** `sessions`, `support_requests`, `match_reservations` have **no UPDATE
  policy**, so authenticated clients cannot forge state via PostgREST; only
  `listener_presence_update_own` exists, and its blast radius is limited (the matcher still enforces
  `available` + fresh heartbeat + no active reservation in `atomic_reserve_match`).
- **Operations runner fail-closed & worker abuse.** No secret ⇒ 503, wrong/missing ⇒ 401, correct ⇒
  200 with a per-job report (tested in-process and against the live dev server). Jobs are
  state-guarded and idempotent; `runJob` never lets one failure abort the cycle; the runner's
  backoff (`min(60s, interval·2^min(n,4))`) is sane and it exits non-zero when the secret is unset.
- **New-route authorization.** `matches/[id]/accept` (LISTENER + ownership via `p_listener_id`),
  `safety-cases` GET (supervisor roles), `sessions/[id]/token` (participant-derived role),
  `operations/cron` (secret) all deny unauthenticated/unauthorised callers.
- **Test-suite integrity.** Diffs of `security-adversarial.test.ts` and the other touched tests only
  remove dead imports/locals; no expectation was weakened. The `safety-hardening` change
  (`completed`→`safety_escalated`) matches the new behaviour and is defensible.
- **Lint gate.** `pnpm lint` is now a real eslint run and passes (622 warnings, 0 errors); CI's added
  Lint step will pass. (The handoff's "lint inventory NOT_STARTED" is stale, not wrong.)

---

## What I could NOT verify (and why)

- **Real Razorpay checkout/refund/settlement and LiveKit media/no-egress** — no provider
  credentials exist locally, as the handoff states.
- **The token route end-to-end.** The running dev server returned **HTTP 500
  `Cannot find module './8765.js'`** for `POST /api/sessions/[id]/token` (stale `.next` server chunk
  after files changed on disk). This is an environment/stale-build artifact, not a code verdict; it
  needs a dev-server restart. Worth noting because the author's L6 claim rests on that route.
- **L4 integrated journey** — not run (Playwright; also its cold-compile flakiness is documented).
- **`apps/web/e2e/integrated-journey.spec.ts`** hardcodes a local demo **service-role JWT** fallback
  (`:22–27`) and a test webhook secret (`:197`). It is the public local Supabase demo key, so it is
  not a live secret, but hardcoding a service-role token in a committed test is poor hygiene —
  prefer requiring the env var.

## Bottom line

The two new migrations and their tests genuinely close L1/L2/L3 plus the listener-reservation and
participant-scoping defects, and I could not falsify those invariants. The remaining material issues
are on the safety UX (P1: the safety control vanishes when the room fails), money truthfulness
(P2: capture into a terminal request; a noisy reconcile metric), and session UX/validation (P2:
reload-as-reconnect, unvalidated `end_reason`). The author's own "money truthfulness NOT_STARTED"
note is honest, but the *specific* accepted-capture-without-entitlement path and the misleading
reconcile metric are not called out anywhere in the handoff.
