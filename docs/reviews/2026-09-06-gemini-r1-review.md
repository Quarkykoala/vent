# Independent review of Gemini's R1 matching authorization repair

Date: 2026-09-06 (Asia/Calcutta)

Verdict: **The R1 authorization defect is fixed. The package needs a small test follow-up before an unqualified completion claim. Rating: 8/10 for this bounded task.** No new production defect was found in the route change. Two issues remain in the added regression suite: shared database fixtures cause intermittent failures, and the rematch assertion can pass without rematching.

## Scope and attribution

- Branch: `hardening/real-mvp-vertical-slice`
- HEAD: `d3ca22b397b5d50d468ee7fb162c4e09dc8ff655`
- Compared all 52 files in the previous independent GLM review's SHA256 manifest. Only `apps/web/src/app/api/support-requests/[id]/match/route.ts` and `apps/web/tests/matching-coordinator.test.ts` differ among those files. Gemini also added `apps/web/tests/matching-authorization.test.ts` and its report/logs.
- The prior uncommitted GLM work remains the baseline. R2, R3, R4 and the broader unfinished MVP are outside this repair's scope.
- This review changed only review artifacts and harness output. No application code, tests under `apps/`, migrations, commits, deployment, database reset or external model calls.

## What works

The route loads the support request and checks its owner before constructing/invoking the coordinator (`route.ts:28-54`). Lookup failure, missing request and ownership denial return before matching or lazy expiry. Database lookup errors receive a controlled response instead of exposing raw details. Existing authentication, rate limiting and successful response mappings remain in place.

The unchanged independent R1 probe now observes HTTP 403 with the victim request still `queued`, zero reservations, zero sessions and the listener still `available`. The previous review's saved probe log established the failing behavior before this repair. This run verifies the repaired behavior; it does not independently reconstruct Gemini's claimed chronology of writing its six tests before editing the route.

The six added tests pass in isolation and exercise real NextRequest/handler calls, local Supabase Auth/Postgres and actual repositories/coordinator. Only ownership-lookup failure is deliberately injected; coordinator spies otherwise call through. These are handler/database integration tests, not browser E2E proof.

## Findings

### G1 — P2: Isolate the new suite's eligible listener pool

Location: `apps/web/tests/matching-authorization.test.ts:160-179,457-465`; interacting cleanup at `apps/web/tests/matching-coordinator.test.ts:197-223`.

Creating a fresh listener does not ensure matching selects that listener. Both suites advertise English / Work & Career Stress listeners in the same database. The real coordinator considers the entire eligible pool. When both suites run with two workers, the new test can reserve a listener owned by the coordinator suite. That suite then deletes its listener profile during cleanup; the existing foreign key cascades deletion to the new test's reservation.

Reproduction on unchanged application/test files:

```powershell
pnpm --filter @vent/web test tests/matching-authorization.test.ts tests/matching-coordinator.test.ts --maxWorkers=2 --minWorkers=1
```

Result: 14 passed, 1 failed. The owner-rematch request returned 409 instead of the test's allowed 200/201. The new six-test file passed when run alone. A later full workspace run also passed; these outcomes demonstrate that the failure depends on concurrent execution.

A review-only Vite transform added logging without changing application behavior or test assertions. It reproduced a related missing-reservation failure and showed:

- The new owner's initial match selected a listener outside its suite (`selectedIsSuiteFixture: false`).
- The coordinator suite's cleanup subsequently deleted that exact listener ID.
- The new test then observed zero reservations where it expected one.

The cascade is defined in `supabase/migrations/20260902000001_core_schema.sql:79`. The trace transform adds lines, so transformed stack-trace line numbers should not be used as source locations.

Required follow-up: isolate matching candidates/fixtures between suites, or establish explicit serialization for suites sharing the same candidate pool. Retain the real coordinator/database and meaningful concurrency tests. Do not widen allowed errors or add sleeps/retries to hide the failure. Check setup and cleanup errors.

Evidence: `focused-tests.log`, `authorization-standalone.log`, `pool-trace.config.mjs`, `pool-trace.log` under the review evidence directory.

### G2 — P3: Require a replacement reservation in the rematch assertion

Location: `apps/web/tests/matching-authorization.test.ts:503-516`.

The authorized expiry/rematch portion accepts either 200 or 201, optionally records a new reservation ID, and only requires the old reservation to be expired. A 200 `no_candidates` response passes even when a fresh eligible candidate exists and matching never resumes.

A review-only in-memory mutation replaced the recursive rematch after the real expiry transaction with an immediate `no_candidates` result. The legitimate-owner test still passed (1 selected test passed, 5 intentionally skipped). The application source on disk was not modified. This is evidence of a test blind spot, not evidence that the current application actually suppresses rematching.

Required follow-up: with isolated eligible fixtures, require a successful replacement match, a different reservation ID, the old offer expired, exactly one active offered reservation, the request reserved and the selected listener reserved.

Evidence: `rematch-sensitivity.config.mjs` and `rematch-sensitivity.log` under the review evidence directory.

## Independently executed verification

Evidence directory: `logs/agent-runs/2026-09-06-gemini-r1-review/`.

All database checks used the already-running local stack at `127.0.0.1:54321`, with process-level local endpoint selection and repository-standard local development credentials. Provider credential overrides were cleared for tests. Synthetic fixtures were used; no production data was used or reset.

| Check | Result | Evidence |
|---|---|---|
| New authorization + existing coordinator tests together, two workers | 14 pass / 1 fail | `focused-tests.log` |
| New authorization suite alone | 6 pass | `authorization-standalone.log` |
| Unmodified independent R1 adversarial probe | 1 pass / 3 unrelated probes intentionally skipped | `adversarial-r1.log` |
| Full workspace test suite | 303 pass across 45 files: domain 80, validation 14, db 5, web 204 | `full-tests.log` |
| Workspace typecheck | Pass | `typecheck.log` |
| Workspace lint | Pass: 0 errors, 474 warnings | `lint.log` |
| Production build | Pass | `build.log` |
| Shared-pool trace, two workers | 14 pass / 1 fail; confirms selection of another suite's listener followed by its deletion | `pool-trace.log` |
| Deliberately suppressed rematch, selected owner test | Test still passes: a coverage gap | `rematch-sensitivity.log` |

The passing full run is valid evidence of that run, but does not invalidate the reproduced test-isolation failure. No browser, hosted workflow, payment provider, or live audio verification was performed for this bounded route repair.

## Assessment and next step

Gemini made the correct small production change, preserved surrounding work, improved authorization/error handling and added useful state-based negative tests. The score is reduced for the independently reproduced fixture interference and the weak rematch assertion. This supports continuing with small verified packages. It does not establish model superiority over GLM's much larger, user-paused task.

The next bounded task should repair these two test issues, then close the R1 package. R2 (acceptance/session creation recovery) is the next production repair. R3 (existing-profile age confirmation), R4 (captured-payment entitlement validation), the earlier presence race and incomplete browser onboarding remain separate work. No defensible overall project-completion percentage can be inferred from this one repair.

## Completion record

```text
Task: Independently review Gemini's R1 repair.
Backlog item: R1 matching authorization before mutation; related WP-7 matching work.
Files changed: Review report, review logs/configs/manifests, local harness outputs only.
Behavior changed: None by reviewer. Gemini's route now verifies ownership before matching.
Tests run: Focused integration checks, independent R1 probe, full 303-test suite, typecheck, lint, build, fixture trace and rematch sensitivity check.
Security/privacy impact: R1 unauthorized matching mutation is fixed; review used synthetic local data.
Data migration: None.
Observability: Reproducible logs and source hashes in the review evidence directory.
Known risks: Shared-pool test interference; rematch assertion blind spot; previously documented out-of-scope defects.
Not done: Test repairs, R2-R4, browser E2E, deployment or overall MVP completion.
```
