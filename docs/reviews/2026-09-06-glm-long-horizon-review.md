# GLM 5.3 Flash Max — long-horizon output review, 6 September 2026

**Assessment: 6/10 for the inspected long-horizon run. Useful backend progress; the completion mission is unfinished and the new matching flow needs correction.** Estimated usable-MVP completion is about **45%, with a 40–50% judgment range**. This is a functional-scope estimate, not a measured percentage of engineering hours, a model benchmark or a launch-readiness claim.

The inspected output is a checkpoint at WP-9, not a completed mission. There is no `docs/reviews/GLM_FINAL_HANDOFF.md`. The repository does not establish whether the run paused because of a model/runtime limit or user action, so this review evaluates the available output without attributing a reason for stopping. Several remaining local tasks are explicitly listed and are not blocked by provider credentials.

## Snapshot and review method

- Branch `hardening/real-mvp-vertical-slice`; HEAD `d3ca22b`, with uncommitted implementation changes. The user attributes this work to GLM 5.3 Flash Max.
- The prior small webhook patch is included in the working diff. The long-horizon run builds on that patch and adds the strict signature-format repair.
- Three existing Luna agents performed bounded read-only source/claim reviews. The parent independently ran the tests, checked effective DB function privileges, reproduced the actionable failures below and exercised the browser. No Pioneer calls were made.
- Application source and GLM's tests/progress records were preserved. Review-only probes/configuration and logs live outside normal app test discovery. A [52-file code/configuration manifest](C:/Users/lenovo/projects/vent/logs/agent-runs/2026-09-06-glm-long-horizon-review/source-manifest.json) identifies the inspected working snapshot.

## Verification actually run

| Check | Result and proof boundary | Evidence |
| --- | --- | --- |
| Full workspace test suite, worker concurrency limited to two | **297 passed, 0 failed**: domain 80, validation 14, DB package 5, web 198. The web run includes actual local Supabase/Postgres suites; provider simulators/mocks remain mocks. | [Full test log](C:/Users/lenovo/projects/vent/logs/agent-runs/2026-09-06-glm-long-horizon-review/full-tests.log) |
| Independent review counterexamples | **4 failed expectations**, each reproducing a concrete implementation gap; no setup or cleanup failures | [Probe log](C:/Users/lenovo/projects/vent/logs/agent-runs/2026-09-06-glm-long-horizon-review/adversarial.log) |
| Workspace typecheck | Passed | [Typecheck log](C:/Users/lenovo/projects/vent/logs/agent-runs/2026-09-06-glm-long-horizon-review/typecheck.log) |
| Real ESLint analysis | **0 errors, 477 warnings**. Initial sandbox executable-read failure was resolved by running the same installed checker with approved filesystem access. | [Lint result](C:/Users/lenovo/projects/vent/logs/agent-runs/2026-09-06-glm-long-horizon-review/lint-retry.log) |
| Production build | Passed | [Build log](C:/Users/lenovo/projects/vent/logs/agent-runs/2026-09-06-glm-long-horizon-review/build.log) |
| Local DB migration/privilege inspection | All **12 migration versions** through `20260905000002` present. All ten `atomic_*` functions in `public` deny EXECUTE to anon/authenticated and allow service_role. | Read-only `docker exec ... psql` catalog queries executed during review; GLM's saved reset log was inspected, but this review did not reset the DB. |
| Browser: fresh user checks age box and clicks Start Session | Request receives **401**; UI displays **“Error: Authorization Bearer token required.”** No sign-in/checkout/queue navigation follows. | [Network log](C:/Users/lenovo/projects/vent/logs/agent-runs/2026-09-06-glm-long-horizon-review/browser-requests.log), [snapshot](C:/Users/lenovo/projects/vent/logs/agent-runs/2026-09-06-glm-long-horizon-review/browser-after-start.yml), [screenshot](C:/Users/lenovo/projects/vent/output/playwright/2026-09-06-glm-start-session.png) |
| Tracked diff whitespace check | Passed | `git diff --check` |

The existing local `*_vent` Supabase test stack was used through `127.0.0.1:54321`; test processes explicitly selected that URL and cleared credential overrides so they used the repository's local development credentials. No production data, real payments, notification recipients or live media sessions were used. The independent synthetic fixtures were removed after the probes. The review's local web server and isolated browser were closed after inspection; the pre-existing Supabase stack was left running.

## What GLM did well

1. **Database authority repair is substantive.** The additive migration closes public execution of privileged RPCs, restricts `payout_batches`, and prevents direct creation of owned requests in forged paid/queued state. The effective local function grants and actual DB tests support this progress. Deployment remains unverified.
2. **The webhook follow-up is complete locally.** Both real handlers now reject the valid-digest-plus-junk cases from the previous review. The 28-route-test suite passes, preserving real HMAC processing and denied-persistence assertions.
3. **Previously synthetic backend operations now have persistent implementations.** Request creation authenticates, checks stored age evidence, persists rows and handles retries. Presence routes persist state. Matching invokes real selection and atomic reservation logic. Acceptance now attempts session creation.
4. **Verification improved.** A functioning local DB allowed the previously blocked integration suites to run. GLM added 44 tests beyond the post-webhook baseline, introduced real lint, kept additive migrations, saved failure/retry logs, and maintained a useful continuation record.
5. **It did not claim the whole product was finished.** Many missing items and all eight external/human launch gates remain visible in its matrix, although some individual verified labels are too strong.

## Confirmed findings

### R1 — P1: a forbidden match request mutates another user's request before returning 403

The [new match route](C:/Users/lenovo/projects/vent/apps/web/src/app/api/support-requests/[id]/match/route.ts:27) calls the coordinator with service-role authority before checking the caller owns the request at lines 34–47. An authenticated non-owner who supplies an existing matchable request ID can trigger its reservation before being denied.

**Real local reproduction:** HTTP **403**, victim request **queued -> reserved**, one **offered** reservation, listener presence **reserved**. This is a state-changing authorization failure, not merely an error-message leak.

GLM's [ownership test](C:/Users/lenovo/projects/vent/apps/web/tests/matching-coordinator.test.ts:516) asserts only the HTTP status. It misses the mutation after a denied request. Authorize before invoking the coordinator, and assert that denied calls leave the request, reservations and listener presence unchanged.

### R2 — P1: a transient failure after accepting a reservation strands the request

The [accept route](C:/Users/lenovo/projects/vent/apps/web/src/app/api/matches/[id]/accept/route.ts:30) commits reservation acceptance, then separately reads/creates a session and updates the support request. The final update's error is ignored. The session lookup described as idempotent happens after an acceptance operation that rejects retries.

**Real local DB with one controlled failure injection:** the first session-create call threw a synthetic transient error. First response **400**; retry after restoring the real method also **400**. The request/reservation remained **accepted**, listener **reserved**, and session count **0**.

The fault injection affects only the first session-creation call; actual reservation acceptance, stored state and retry behavior execute against Postgres. Fix with a transaction covering the coupled transition or a durable, retry-safe recovery design. A duplicate returning 400 is not proof that a partially completed operation can recover.

### R3 — P2: a real age confirmation cannot repair an existing unconfirmed profile

GLM correctly stopped [token provisioning](C:/Users/lenovo/projects/vent/apps/web/src/features/auth/supabase-auth-service.ts:127) from inventing age evidence. However, [OTP verification](C:/Users/lenovo/projects/vent/apps/web/src/features/auth/supabase-auth-service.ts:64) writes that evidence only when creating a new profile. If a profile already exists with `age_verified_at = NULL`, a subsequent verified OTP plus `ageConfirmed: true` leaves it null.

**Reproduction:** token provisioning created a null-evidence row; the real application OTP service then received a successful provider verification and explicit confirmation; evidence stayed absent and request creation returned **403**. Only the provider's OTP verification response was stubbed; profile provisioning, lookup, persistence and the request handler used the real local DB. No SMS was sent.

GLM's new allowed-path test manually writes the timestamp as admin. It does not prove the actual OTP-to-existing-profile transition works. F08's fabrication defect is fixed, but the complete onboarding behavior is not verified.

### R4 — P2: the claimed captured-payment gate checks only for a non-null link

The [coordinator entitlement check](C:/Users/lenovo/projects/vent/apps/web/src/features/matching/coordinator.ts:71) checks `payment_order_id` exists but does not read the referenced payment's captured state or ownership. The matrix marks P4.1b as VERIFIED_LOCAL and says matching rejects requests without captured payment.

**Real local DB reproduction:** a synthetic queued request linked to a **failed** payment still produced a **reserved** result and an offered reservation.

This fixture deliberately seeds an inconsistent queued/payment state. It proves the new coordinator does not enforce its advertised entitlement invariant; it does not by itself prove an ordinary client can manufacture that state through the repaired RLS policy. Enforce the intended authoritative payment binding at the appropriate transaction boundary and test non-captured, mismatched and missing links. The broader pre-existing F07 order/capture binding defect remains open.

## Remaining review concerns and incomplete work

- The existing stale-presence sweeper reads available rows and later updates by listener ID without rechecking current state or heartbeat. That race predates GLM's changes, but the new maintenance endpoint now calls it. A reservation/session transition between read and write can be overwritten. This is source-verified, not independently race-reproduced here; the static presence test does not establish concurrency safety.
- The browser still exposes only the landing and crisis pages. The [landing submit](C:/Users/lenovo/projects/vent/apps/web/src/app/page.tsx:26) sends no bearer token and has no connected OTP, checkout, queue, listener dashboard, audio or rating journey. Requiring authentication in the backend is correct; the missing UI integration keeps the product unusable from its entry point.
- No periodic Trigger.dev registration or scheduler configuration is present. Manually callable operations endpoints and lazy expiry are partial progress, not proof of automatic background execution.
- The full payment/request binding repair, real refund states/provider integration, genuine safety dispatch/supervisor console, authoritative audio cap and room termination, role-specific UI, privacy export and remaining counselling/analytics work are incomplete. Existing fake delivery/settlement success paths were not repaired in this output.
- CI has gained a lint step but still does not provision Supabase for its integration tests. Hosted CI and provider sandbox checks remain unverified.
- The run-state WP-9 proposal still mentions selecting the oldest request with a matching or null payment link. That is a plan, not implemented code; it should be revised to require one explicit purchased-request binding rather than choosing an unrelated unlinked request.

## Completion claims and long-horizon execution

The matrix states **25/60** verified engineering criteria. Independent parsing finds **69 phase-table rows**: **28** carrying a VERIFIED_LOCAL label (including four qualified capture/unit/RPC labels), **18** IN_PROGRESS, **22** NOT_STARTED and **1** BLOCKED. [Count evidence](C:/Users/lenovo/projects/vent/logs/agent-runs/2026-09-06-glm-long-horizon-review/matrix-count.json). These labels are GLM's claims, not an independently accepted numerator; R3 and R4 contradict specific claimed guarantees, and P0.2 calls itself verified while its own evidence says part of the review is pending.

The matrix is useful but its count and proof boundaries need repair. It correctly leaves **0/8 launch-readiness gates** complete. That does not mean zero useful engineering has been done.

The run-state lists payment binding as the current next work package, then refunds, safety dispatch and session-cap work. A continuation record exists, but the requested end-to-end outcome and final handoff do not. The demonstrated strengths are bounded backend implementation and local test execution. The weaknesses are cross-operation authorization/recovery, integration of the actual user journey, and accuracy of some completion labels.

**Recommended next milestone:** repair R1–R4 with tests that assert state and retry behavior, then finish one browser-driven paid-user-to-listener session path with its operational failure paths. Keep the security and provider/human gates explicit before expanding into later product surfaces.

## Reproducing the independent probes

From the repository root, with the local Vent Supabase stack running and local-only environment selected:

```powershell
$env:NEXT_PUBLIC_SUPABASE_URL = 'http://127.0.0.1:54321'
$env:SUPABASE_URL = 'http://127.0.0.1:54321'
# Remove credential overrides in this test process to use the checked-in local defaults.
@('NEXT_PUBLIC_SUPABASE_ANON_KEY','SUPABASE_ANON_KEY','SUPABASE_SERVICE_ROLE_KEY') |
  ForEach-Object { Remove-Item -LiteralPath ('Env:' + $_) -ErrorAction SilentlyContinue }
pnpm --filter @vent/web test --config '../../logs/agent-runs/2026-09-06-glm-long-horizon-review/adversarial.config.mjs'
```

The four failed expectations are intentionally preserved as review evidence outside the normal test suite. They should become proper regressions in the next repair; this review did not implement those repairs.

```text
Task: Independently assess GLM's long-horizon output.
Backlog item: Full MVP mission; focused review of phases 0–4 and integration claims.
Files changed: This report, isolated review probes/configuration, evidence and local harness artifacts only.
Behavior changed: No application edits; synthetic test state created and cleaned up.
Tests run: 297 existing tests passed; 4 additional counterexamples failed as documented; typecheck, lint, build, DB catalog queries and local browser check performed.
Security/privacy impact: Confirmed authorization-after-mutation, retry recovery, age-evidence and entitlement gaps; no production or real provider operations.
Data migration: No migrations applied or databases reset in this review; 12 installed migration versions inspected.
Observability: Logs, screenshot, completion recount and source manifest saved.
Known risks: R1–R4, inherited sweeper race and unfinished payment/safety/audio/UI/operational capabilities.
Not done: Application fixes, full live-provider E2E, independent launch approval, commit, push or deploy.
```
