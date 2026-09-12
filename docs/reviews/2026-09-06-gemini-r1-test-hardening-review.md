# Independent review: Gemini R1 test-hardening follow-up

Date: 2026-09-06, Asia/Calcutta. Reviewer: Codex. Implementation attributed by the user/result report to Gemini 3.8 Flash High.

**Verdict: G1 and G2 are resolved. Accept the R1 authorization package with minor test-diagnostic and reporting notes. Rating: 9/10 for this repair round.** There are no new blocking findings in the inspected change. This is not a claim that every prompt instruction was followed perfectly or that the wider matching/MVP work is complete.

## Scope and source integrity

- Branch: `hardening/real-mvp-vertical-slice`.
- HEAD: `d3ca22b397b5d50d468ee7fb162c4e09dc8ff655`.
- Compared the 53 files in the account-handoff source inventory. Only the two permitted test files changed: `apps/web/tests/matching-authorization.test.ts` and `apps/web/tests/matching-coordinator.test.ts`.
- The other 51 inventoried source/configuration files are unchanged. Historical context/evidence/probe hashes also matched at review intake. No test helper was added.
- The authorization test uses a distinct synthetic language for each scenario/run, shared by that scenario's request and listeners. The actual schema permits string language values and the real matcher filters with `c.languages.includes(request.language)`; no product catalog or validation change was needed.
- The coordinator test's presence cleanup now targets `listener_id`, the actual key. No application source, migration, dependency or runner configuration was changed in this follow-up.
- No source changed during the independent verification. The reviewer added review/continuation records only and did not repair Gemini's tests.

## Verified repairs

### G1: Candidate pools no longer overlap between these suites

The authorization suite assigns its scenarios distinct `AuthLang_...` values, preventing its requests from selecting the coordinator suite's English-speaking fixtures or other scenarios' candidates. The owner case asserts that the initial and replacement selected listeners belong to its scenario's fixture set. The non-owner cases retain real authenticated handler/database execution, explicit eligible-listener checks and zero-coordinator-call assertions.

I ran both matching suites together with two workers three consecutive times. All three runs passed: 15 tests in each run. The new suite also checks and aggregates many fixture cleanup errors. The historical G1 race is therefore closed by a concrete isolation mechanism and repeated execution evidence; three passes are not a general guarantee against every possible race.

### G2: Rematching is now required and the assertion detects its removal

The owner test requires 201 `reserved`, a replacement reservation ID different from the first, a selected listener from its scenario, the old offer expired, exactly two reservation rows with one offered, and the correct request/listener state. It reads back the forced expiry before calling the route and uses no sleeps.

I reran the unchanged independent in-memory mutation harness. It logged that rematching was deliberately suppressed, then the selected owner test failed at `matching-authorization.test.ts:630` with `expected 200 to be 201`. The process exited 1, with one failed selected test and five intentional skips. This was the required negative-control result, not a normal test failure or configuration/setup failure. The normal full suite passed afterward.

The unchanged original R1 probe also passed: the non-owner received 403; the victim request stayed queued; reservations and sessions remained empty; the listener stayed available. Its other three probes were intentionally excluded because they test separate findings.

## Minor notes

### N1 — P3: Some state-read errors still lack explicit handling

`apps/web/tests/matching-authorization.test.ts:259-263` reads the support request and listener presence without checking their returned `error` fields. Later non-null/state assertions fail if the reads return null, so this does not recreate the observed G1/G2 false-pass problem. However, the original database diagnostic is lost and the prompt's request for explicit error checking was not fully implemented. Check those two errors when this helper is next touched; do not describe every operation as explicitly checked.

The older coordinator test also still has inherited setup/cleanup operations without explicit error inspection. I am not treating that pre-existing condition as a new production defect or expanding this repair into a rewrite of the old suite.

### N2 — P3: Correct the implementer's reporting claims

The result file has several inaccuracies:

- Line 51 says every insert/update/select/delete checks errors. N1 shows exceptions.
- Line 94 reports 475 lint warnings. Its own saved lint log and my fresh run both show **474**, with zero errors.
- Line 134 calls R2 "payment order authorization." R2 is **acceptance/session-creation recovery after a transient failure**, as recorded in the independent long-run review and the continuation packet.
- The sensitivity proof demonstrates detection of the injected suppressed-rematch branch. It does not justify the universal "will never" claim on line 120.

These are non-blocking notes for the validated R1 behavior. The implementer's report remains preserved as submitted; this independent review and the current continuation record provide the corrections. Do not count the report as fully accurate or the output as perfect prompt compliance.

## Independently executed checks

Evidence directory: `logs/agent-runs/2026-09-06-gemini-r1-test-hardening-review/`.

| Check | Result | Evidence |
|---|---|---|
| Combined authorization/coordinator suites, two workers | Three consecutive passes, 15 tests per run | `combined-run-1.log`, `combined-run-2.log`, `combined-run-3.log` |
| Original independent R1 authorization probe | 1 passed; 3 unrelated probes intentionally skipped | `adversarial-r1.log` |
| Unchanged rematch-sensitivity harness | Intended assertion failure, exit 1; 1 failed selected test, 5 intentionally skipped | `rematch-sensitivity.log`, `probe-results.json` |
| Full normal workspace suite after sensitivity run | 303 passed across 45 files: domain 80, validation 14, db 5, web 204 | `full-tests.log` |
| Workspace typecheck | Pass | `typecheck.log` |
| Workspace lint | Pass: 0 errors, 474 warnings | `lint.log` |
| Production build | Pass | `build.log` |
| Source integrity | 53 files checked; two intended test changes; no drift during review | `source-manifest.json`, `source-integrity.json` |

Database verification used the existing local Supabase stack at `127.0.0.1:54321`, synthetic fixtures, explicit process-level local URL selection and cleared provider credential overrides. Database runs were sequential with one another; each combined run retained two workers. No database reset, production data, live provider operation, browser journey or deployment was involved. Build/lint/typecheck do not establish browser E2E or release readiness.

## Calibration and next action

The detailed follow-up prompt successfully corrected both independently identified test defects. The remaining weakness is precision in diagnostic handling and completion reporting. This supports keeping Gemini as the bounded implementation model with independent review.

This is a repair round of the existing R1 assignment, not a new independent task passing first review. It does not satisfy the two-separate-task promotion threshold, establish a model ceiling, or justify a project-completion percentage. The amount of guidance was high: the reviewer supplied the failure mechanism, fixture-isolation approach, state expectations and an independent mutation harness.

The implementer's final report is timestamped 14:51:30 +05:30; the independent full-suite run completed around 14:56 +05:30. Exact dispatch, active implementation, provider waiting, token usage and cost are not available, so no comparative throughput claim is made.

Next production target: **R2 acceptance/session-creation recovery**. It touches persistent state and retries, so inspect its boundaries and use a separate bounded assignment with checkpoints. Do not start a whole-project completion run. The P3 notes above remain recorded; R2-R4 and broader product gaps are otherwise unchanged.

## Completion record

```text
Task: Independently review Gemini's R1 test-hardening follow-up.
Backlog item: G1/G2 repair within the R1 authorization package.
Files changed: Independent review, run evidence and continuation/calibration records only.
Behavior changed: None by reviewer; Gemini's fixture isolation and rematch assertions validated.
Tests run: Three combined runs, original R1 probe, negative-control mutation, full 303-test suite, typecheck, lint, build, source integrity checks.
Security/privacy impact: Original authorization boundary remains intact; synthetic local fixtures only.
Data migration: None.
Observability: Reproducible logs, source hashes and corrected reporting claims preserved.
Known risks: Non-blocking N1/N2 diagnostics/reporting notes; separate R2-R4 and MVP gaps remain.
Not done: Application fixes, R2 implementation, browser E2E, deployment or scope promotion.
```
