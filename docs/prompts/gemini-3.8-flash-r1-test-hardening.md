# Gemini 3.8 Flash High — R1 test reliability follow-up

Work in `C:\Users\lenovo\projects\vent`. Use Gemini 3.8 Flash with thinking set to HIGH in the runner. This is one bounded follow-up to the existing R1 package: repair its test isolation and rematch assertions, verify the repair, and stop for independent review.

The user has selected Gemini for these incremental tasks and removed Pioneer access. Earlier whole-project missions and Pioneer-only model routing do not apply to this run. Do not invoke Pioneer, other models or subagents, or modify provider configuration. Ordinary local development tools are allowed.

## Objective and edit boundary

Fix G1 and G2 from `C:\Users\lenovo\projects\vent\docs\reviews\2026-09-06-gemini-r1-review.md` without changing production behavior.

Allowed code edits:

- `C:\Users\lenovo\projects\vent\apps\web\tests\matching-authorization.test.ts`
- `C:\Users\lenovo\projects\vent\apps\web\tests\matching-coordinator.test.ts`, only where needed for fixture isolation or cleanup
- At most one small shared matching-fixture helper under `C:\Users\lenovo\projects\vent\apps\web\tests\helpers\`, if it reduces duplication and is actually necessary

New evidence belongs under `C:\Users\lenovo\projects\vent\logs\agent-runs\gemini-r1-test-hardening\`. Write the result to `C:\Users\lenovo\projects\vent\docs\reviews\gemini-r1-test-hardening-result.md`.

Keep application source, database migrations, dependencies, lockfiles, Vitest configuration and worker settings unchanged. Preserve historical prompts, reviews and independent probes. Do not start R2, change clinical/consent copy, or expand the feature. No commits, pushes, deployments, database resets or real provider operations.

## Inspect and establish the baseline

Read applicable AGENTS.md instructions and the matching/test requirements in the repository source-of-truth documents. Then inspect only the code needed to understand these two failures:

- The two allowed test files and the independent Gemini review above.
- `C:\Users\lenovo\projects\vent\apps\web\src\features\matching\coordinator.ts`, especially the real eligibility filter and lazy expiry/rematch branch.
- `C:\Users\lenovo\projects\vent\apps\web\src\app\api\support-requests\[id]\match\route.ts`.
- Relevant listener/matching repository methods and schema constraints for fixtures and cleanup.
- `C:\Users\lenovo\projects\vent\logs\agent-runs\2026-09-06-gemini-r1-review\pool-trace.log`.
- `C:\Users\lenovo\projects\vent\logs\agent-runs\2026-09-06-gemini-r1-review\rematch-sensitivity.config.mjs` and its log.

Record the starting branch, HEAD, dirty-file inventory, source hashes, model/runner settings, and start timestamp. Preserve all existing user/GLM/Gemini work. State the intended patch and allowed files in a short plan, then implement without waiting for another approval.

Run the two matching test files together once before editing and preserve the result. G1 is intermittent: a passing baseline run does not disprove the saved reproduction. Do not keep rerunning it until a preferred outcome appears. Also run the existing rematch-sensitivity command below before editing: the current weak assertion is expected to pass even with rematching deliberately suppressed. Record the actual outcome.

If files have already changed and either issue is already fixed, verify what remains rather than recreating an obsolete defect.

## G1: Isolate the real eligible candidate pool

Observed defect: both suites use English / Work & Career Stress listeners in a shared database. The new owner test can match a listener belonging to the coordinator suite. The other suite's cleanup deletes that listener and cascades deletion to the new test's reservation. A fresh listener ID alone does not isolate matching candidates.

Required behavior:

1. Each scenario must own its eligible candidate pool and request/payment fixtures. Auth actors may be shared within this suite when provisioned uniquely for the current run. Use a per-run/per-scenario discriminator in an existing eligibility field shared by that scenario's request and listeners, provided the actual schema/domain permits it. A synthetic test-only language value can work when those fields accept strings; confirm this before choosing it. Do not change production validation or introduce a product field/catalog entry to support tests.
2. Preserve real matching. Do not mock candidate loading, the coordinator, repositories, authorization or database responses into succeeding. Retain call-through spies on denied paths and the explicitly identified database-error injection.
3. In allowed matching tests, assert that the selected listener belongs to the scenario's eligible fixture set. In denied matching tests, first verify the scenario really has an active, trained, fresh, available, eligible listener; then require the existing unchanged-state assertions and zero coordinator calls.
4. All fixtures and cleanup must be scoped to IDs created by this run/scenario. Do not delete, disable, reserve or retag other suites' listeners. Existing real concurrent-claim tests must continue exercising concurrency.
5. Check errors from setup writes, state reads, expiry updates and cleanup. A failed query must not become an empty result that makes an assertion pass. Register cleanup IDs immediately after successful creation so partial setup can be cleaned up. Preserve the original failure while also reporting cleanup failures.
6. Keep the combined suites running with two workers. Do not fix the failure with global serialization, sleeps, automatic test retries, skipped tests, wider accepted statuses or more permissive assertions.

If isolation cannot be implemented within these boundaries, describe the concrete schema/test constraint and smallest proposed scope change. Do not silently change production code or test-runner configuration.

## G2: Prove an actual authorized rematch

Keep `legitimate owner` in the owner test's name so the existing independent sensitivity probe selects it. With an isolated, eligible fixture pool, require all of the following through the real route and local database:

| Step | HTTP/body expectation | Persisted-state expectation |
|---|---|---|
| Initial owner match | 201; status `reserved`; defined reservation and listener IDs | Request `reserved`; exactly one offered reservation; selected listener belongs to this scenario and is `reserved` |
| Repeat while offer is active | 200; status `offer_pending`; same reservation ID | Still exactly one reservation; no duplicate active offer |
| Force expiry in fixture | Write and read back an expiry timestamp in the past; check the database result | The original offered reservation exists before the next route call; no wall-clock sleep |
| Owner polls after expiry | 201; status `reserved`; a new reservation ID different from the first | Old reservation `expired`; exactly two reservation rows for this fresh request, exactly one of them actively `offered`; request `reserved`; newly selected listener belongs to this scenario and is `reserved` |

The replacement reservation may select the same eligible listener; require a different reservation ID, not necessarily a different listener. Do not allow `no_candidates` or make the replacement assertions conditional on an ID being returned.

Preserve every existing R1 negative case: non-owner queued request, non-owner expired offer, invalid/missing authentication, missing request, and controlled lookup failure. The fix must retain zero matching work on denial and prevent raw database-error disclosure.

## Verification and exact proof requirements

Use only the identified local Vent Supabase stack at `127.0.0.1:54321` with synthetic fixtures. Explicitly select local URLs and the existing local development credentials in the test process without printing secrets. Inspect inherited provider overrides; do not allow a test to fall back to a remote backend or live provider. Do not write new credentials or reset the stack. If local services are unavailable, save an accurate environment blocker and checkpoint.

Run these commands from `C:\Users\lenovo\projects\vent`, in sequence for database checks:

```powershell
# Normal combined regression: repeat this exact command three times after repair.
pnpm --filter @vent/web test tests/matching-authorization.test.ts tests/matching-coordinator.test.ts --maxWorkers=2 --minWorkers=1

# Existing independent authorization probe: should PASS. Three unrelated skips are intentional.
pnpm --filter @vent/web test --config '../../logs/agent-runs/2026-09-06-glm-long-horizon-review/adversarial.config.mjs' -t 'denies a non-owner'

# Deliberately broken rematching: after strengthening the test, this should FAIL.
pnpm --filter @vent/web test --config '../../logs/agent-runs/2026-09-06-gemini-r1-review/rematch-sensitivity.config.mjs' -t 'legitimate owner'

# Run these broad gates once on the final, normal code/configuration.
pnpm typecheck
pnpm lint
pnpm --recursive --filter '@vent/*' run test --maxWorkers=2 --minWorkers=1
pnpm build
```

- The three combined runs must use fresh fixtures and preserve each run's output/exit status. Stop on a failure, diagnose it, and retain the failed log; do not retry inside the tests or discard failing attempts. Three passes provide regression evidence, not a mathematical guarantee of no race.
- The sensitivity run must log that rematching was deliberately suppressed, execute the intended owner test, and fail specifically because the replacement-match expectation is violated. A configuration/load error, failed setup, no selected tests or cleanup error does not count. This intentional failure is a successful sensitivity check; label it separately from the normal green test gates.
- Do not edit the independent sensitivity probe to manufacture failure. It transforms code only in memory; production files on disk must remain unchanged. A normal full-suite run after it proves the mutation is not active in the normal configuration.
- Keep normal database runs sequential with each other to avoid adding another untracked source of fixture contention. The combined command itself still uses two workers.
- Preserve actual counts and exit codes. The last reviewed normal baseline was 303 tests and 474 lint warnings; identify differences rather than aiming at those numbers. Do not delete or weaken tests to preserve a count.
- No browser E2E is required for this test-only change, and handler/database tests must not be described as browser verification.

## Result report and stopping point

Report:

- Exact files changed and why, with production/configuration source hashes unchanged.
- G1's fixture isolation mechanism and why each suite can neither select nor delete another suite's candidates.
- G2's before/after sensitivity evidence, including the intended failing assertion.
- Each normal run, intentional negative run, failure and skip with its saved log and exit code.
- Start/end timestamps, active implementation/testing time if observable, environment waiting separately, and any user intervention. Unknown timing/token/cost values remain unknown.
- Any remaining risk or incomplete acceptance criterion. Label the result ready for independent review; the independent reviewer decides acceptance.

If the same failure recurs after two attempted repairs, stop making speculative edits. Write the root-cause hypotheses and evidence, then either apply a materially supported fix within scope or leave a precise blocked checkpoint. If the user pauses the task, preserve progress; do not call the pause a model capability failure.

Stop after this follow-up. Do not start R2 or increase your own task scope. End with:

```text
Task:
Backlog item:
Files changed:
Behavior changed:
Tests run:
Security/privacy impact:
Data migration:
Observability:
Known risks:
Not done:
```
