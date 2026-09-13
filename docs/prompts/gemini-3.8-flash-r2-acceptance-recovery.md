# Gemini 3.8 Flash High — R2 acceptance/session recovery

Work in `C:\Users\lenovo\projects\vent` using Gemini 3.8 Flash **High**. Complete the bounded implementation below, verify it, and leave a result ready for Codex's independent review. Do not launch other models or subagents. Pioneer is unavailable.

## Objective and starting point

Fix **R2: reservation acceptance and session creation can become permanently stranded after a transient persistence failure**. This belongs to Phase 4, P4.3 listener acceptance/retry, at the session-creation boundary. It is not payment-order authorization.

This is a deliberate Level 2 trial: one backend operation across handler, repository and database, with high guidance about correctness and failure cases. It is not a scope promotion earned by the R1 repair round. Keep the same model/thinking setting and stop after R2.

Inspected starting state on 2026-09-06:

- Branch `hardening/real-mvp-vertical-slice`; HEAD `d3ca22b397b5d50d468ee7fb162c4e09dc8ff655`.
- Extensive uncommitted and untracked work is the current implementation. Preserve it. Do not reset, clean, switch branches, commit, push or deploy.
- All 53 files in `logs/agent-runs/2026-09-06-gemini-r1-test-hardening-review/source-manifest.json` matched the accepted review during prompt preparation. The broader intake inventory is `logs/agent-runs/2026-09-06-gemini-r2-prompt/source-manifest.json`. Verify live state and record any later drift before attributing changes to this task.
- R1/G1/G2 are accepted with minor diagnostic/reporting notes. Their historical evidence is immutable. R3 age confirmation, R4 captured-payment entitlement, presence-sweeper races and the unfinished browser journey remain separate tasks.

Read `AGENTS.md`, `CONTINUE_HERE.md`, the latest independent R1 test-hardening review and `docs/execution/GEMINI_SCOPE_CALIBRATION.md`. Read the required product documents, focusing on PRD FR-04/FR-06, technical plan reservation/idempotency/audio sections, security T1-T4, SOP A4, and backlog P4.3.

Then inspect these exact boundaries and their callers:

- `apps/web/src/app/api/matches/[id]/accept/route.ts`
- `packages/db/src/repositories/matching.repository.ts`, `session.repository.ts`, `types.ts`
- `packages/domain/src/state-machines/support-request.ts`, `match-reservation.ts`, and the acceptance helper in `packages/domain/src/matching/matcher.ts`
- `supabase/migrations/20260902000001_core_schema.sql`, `20260903000001_hardening_rls_and_constraints.sql`, `20260903000002_atomic_matching_transactions.sql`, `20260903000004_atomic_session_completion.sql`, `20260905000001_db_authority_lockdown.sql`
- `apps/web/tests/matching-coordinator.test.ts`, `matching-concurrency.test.ts`, `matching-authorization.test.ts`, `db-authority.test.ts`
- R2 in `docs/reviews/2026-09-06-glm-long-horizon-review.md` and its preserved `logs/agent-runs/2026-09-06-glm-long-horizon-review/adversarial.test.ts`.

The route currently commits `acceptReservation`, then separately reads/creates a session and updates the request to connected. That final update ignores its database error. The accept RPC rejects an already accepted reservation before the route reaches its supposed idempotency lookup. The independent reproduction injected one failed session insert: first response 400, retry 400, reservation/request accepted, listener reserved, zero sessions.

## Permitted change boundary

Primary edits: the accept route, the acceptance operation in `MatchingRepository`, and one new additive migration for atomic acceptance/session persistence. Use existing domain transition functions and recheck their allowed state conditions inside the transaction. Do not widen the domain transition graph to accommodate invalid data, or perform direct lifecycle writes from the route.

Supporting edits are allowed only when required by this operation:

- Narrow RPC/result typing in `packages/db/src/types.ts` and exports in `packages/db/src/index.ts`.
- Acceptance-related session lookup in `session.repository.ts`, or one small typed helper beside the accept route / under `apps/web/src/features/matching/`. Do not refactor session completion, ratings or blocks.
- New `apps/web/tests/matching-acceptance-recovery.test.ts` and at most one fixture/fault-injection helper. Update only the duplicate-accept assertions in the coordinator test and acceptance/RPC privilege coverage in existing concurrency/authority tests where necessary.
- An additive entry in `supabase/migrations/ROLLBACK.md`, your result/checkpoint file, and task-specific evidence under `logs/agent-runs/gemini-r2-acceptance-recovery/`.

Do not edit previous migrations, historical probes/reviews, R1 authorization tests/route, coordinator selection, payment/auth/audio/UI behavior, dependencies, lockfiles or test-runner configuration. If a necessary change exceeds this boundary, record the exact dependency and a proposed split; do not expand silently. Prefer a small patch, but do not sacrifice required failure tests to hit an arbitrary line count.

## Required behavior

Use one Postgres transaction for the coupled durable writes. Keep the route responsible for authentication, listener-role/profile authorization and validated input; expose a typed repository operation. Reuse or replace the existing acceptance RPC through the new migration after inspecting its callers. Do not leave the application using the old split sequence.

1. **Normal acceptance:** the reservation's own authenticated listener accepts a live offered reservation for a reserved request. Return HTTP 200 with the existing response fields, including `reservationId`, `status: accepted`, `sessionId`, `roomName`, and `requestState: connected`. Persist exactly one session with matching request/user/listener IDs and an opaque stable room name. Reservation is accepted; request is connected. Preserve the current room-ready session state and reserved presence tied to this reservation. Room readiness does not prove that audio participants connected.
2. **Atomic failure:** fail either the session insert or the request's connected-state write inside the real transaction. Return a sanitized server error, never success. All coupled writes roll back to their pre-call state; for a fresh offer this means offered reservation, reserved request/presence and zero sessions. Restoring persistence and retrying before offer expiry must succeed without manual database repair. A compensating route update after an error is not sufficient atomicity.
3. **Retry and concurrency:** sequential repeats, two concurrent accepts of the same live reservation, and a retry after a committed response was lost must resolve to HTTP 200 with the same session ID and room name. Exactly one session and one accepted reservation remain. Replays must not reset timestamps, generate a different persisted room, reset an active session or downgrade listener presence. A terminal session/request must not be reopened or represented as currently connected by stale replay data.
4. **Existing partial state:** support retry of the old bug's accepted reservation + accepted request + zero sessions, when ownership and the listener's reservation binding are intact. Also handle the old accepted request + already created, matching nonterminal session case by completing the missing connected transition without duplicating the session. Original offer TTL does not invalidate acceptance that already committed. Reject mismatched session ownership, conflicting presence or terminal states without overwriting them; do not add an automatic bulk repair job.
5. **Authorization and expiry:** missing/invalid authentication, wrong role, another listener, malformed ID and missing reservation must fail with deliberate safe errors. The other listener is denied on both offered and accepted/replay paths, with no victim-state mutation or session/room disclosure. An expired unaccepted offer never creates a session; preserve the current owner-triggered expiry/release behavior and check the resulting rows. Preserve existing safe 4xx behavior where possible; specify exact chosen status/error codes in tests. Infrastructure failures use a safe 5xx response, not a raw database message.
6. **Database authority:** lock the relevant rows and recheck ownership, state, expiry and reservation binding inside the transaction. Evaluate offer expiry after acquiring the relevant locks, using a current timestamp that does not ignore time spent waiting. Explain the lock order relative to existing matching/lifecycle functions. Preserve unique request/session and active-reservation constraints. Keep any changed/new RPC executable only by the server service role, with explicit revokes from PUBLIC/anon/authenticated and a safe search path. Do not rely on function names or UUID secrecy. Prefer invoker rights where sufficient; do not add definer rights to work around a permission error. Prove both authorized execution and direct-client denial against the actual local database.

Do not add a distributed lock, queue, external provider call, generic retry framework, new dependency, production failure-injection switch, or client-controlled identity/state to solve this operation. Remove bypass casts/catch-all error leakage in code you rewrite; do not introduce `any`, catch-and-ignore, unchecked database results or type assertions that pretend an unvalidated RPC response is safe.

## Tests that must prove the behavior

Use real authenticated handlers and the local Postgres path. Stub only the deliberately named failure boundary, never a successful transaction or authorization result. Seed synthetic fixtures, isolate candidate eligibility per run/scenario if you invoke the matcher, and assert selected IDs belong to your fixtures. Direct atomic reservation of your own fixture is sufficient when selection is not under test. Register fixture IDs as soon as created; clean up only those IDs and explicitly check every new setup, read, write and cleanup error.

Cover all six behavior groups, especially both write failures, duplicate/concurrent responses, lost-response replay, both legacy partial states, foreign-listener replay, expired offer and terminal replay. Assert exact persisted states, identities, row counts and relevant timestamps before/after; a status assertion alone is insufficient. Use deterministic timestamps/barriers instead of sleeps or retries. The coordinator test's old duplicate-accept expectation of 400 must become an explicit 200/same-session/same-room assertion; this is an intentional contract repair, not weakening a test to match a bug.

**Failure-hook trap:** the historical R2 probe mocks `SessionRepository.createSession`. If the new transaction stops calling that method, a green historical probe no longer proves that failure recovery was exercised. Keep the original probe unchanged. Prove the old failure before editing, then inject faults at the actual new write boundary and prove each hook was reached. A rejection before the transaction starts does not prove rollback. Fixture-scoped temporary database triggers or an equivalent local test mechanism are acceptable; remove them in checked cleanup and leave no global fault active during other tests. Preserve failure evidence internally without exposing it through the API.

Show test sensitivity once: a deliberately suppressed required recovery/session-write behavior must make a selected new regression test fail at the intended HTTP/persisted-state assertion. Use a reversible test-only harness, retain the failure log, restore normal behavior and rerun the selected test. A missing RPC, setup error, unused spy or no-tests-selected result does not count. Never weaken assertions or serialize the whole suite to manufacture green output.

## Checkpoints and verification

Write `docs/reviews/gemini-r2-acceptance-recovery-result.md` as a compact progress record. Update it at three checkpoints and continue automatically while work remains in scope:

1. **Before edits:** source baseline, exact failure reproduction, proposed transaction boundary/lock order, permitted file list, exact HTTP/replay contract and test matrix.
2. **After implementation:** focused normal/failure/retry evidence and local migration/privilege status; remaining failures recorded honestly.
3. **Final:** completed checks, source delta, known gaps, and ready-for-independent-review status. If paused, the last checkpoint must tell the next run exactly where to resume.

Use only the existing local Vent Supabase stack at `127.0.0.1:54321` / local Postgres port 54322 and synthetic data. Explicitly select local URLs and local development credentials in the test process without printing secrets; clear inherited remote/provider overrides. Do not reset the database or stop unrelated/user-managed containers. Before any Supabase implementation/migration, follow the installed skill's current documentation and CLI-help checks. Create one additive migration using the installed CLI's supported workflow; apply/test it locally, verify effective definition/grants and document roll-forward/recovery instructions. Never apply to a remote project. If infrastructure is unavailable, preserve the implementation and an accurate unverified checkpoint.

Run from the repository root; keep database commands sequential with each other and save complete logs plus exit codes:

```powershell
# Before editing: must reproduce the known R2 failure at the intended assertions.
pnpm --filter @vent/web test --config '../../logs/agent-runs/2026-09-06-glm-long-horizon-review/adversarial.config.mjs' -t 'can recover acceptance'

# After local migration/implementation: focused new coverage first.
pnpm --filter @vent/web test tests/matching-acceptance-recovery.test.ts --maxWorkers=2 --minWorkers=1

# Interacting suites together, once after focused checks pass.
pnpm --filter @vent/web test tests/matching-acceptance-recovery.test.ts tests/matching-authorization.test.ts tests/matching-coordinator.test.ts tests/matching-concurrency.test.ts tests/db-authority.test.ts --maxWorkers=2 --minWorkers=1

# Preserve the earlier authorization boundary.
pnpm --filter @vent/web test --config '../../logs/agent-runs/2026-09-06-glm-long-horizon-review/adversarial.config.mjs' -t 'denies a non-owner'

# Broad gates once on the final normal configuration, after removing injected faults.
pnpm typecheck
pnpm lint
pnpm --recursive --filter '@vent/*' run test --maxWorkers=2 --minWorkers=1
pnpm build
git diff --check
```

Add the exact migration, new-RPC privilege and sensitivity commands to your result. Do not invent a command without checking the installed tool. Rerun broader gates only after further changes or failures justify it. The last reviewed normal baseline was 303 tests and 474 lint warnings; report actual counts and differences, never copy these as new results. Handler/database tests are the assigned integration proof; no browser UI or real audio/provider journey is being changed or claimed verified.

## Reporting and stopping point

Map each required behavior to a named test and log. Separate normal passes, pre-fix failures, intentional sensitivity failures, environment failures and skipped checks. Include the exact files changed, additive migration, error/retry contract, source hashes, start/end timestamps and observable work/wait time; tokens, cost and unknown timings remain unknown. Compare against intake, not merely HEAD, and preserve all earlier model reports unchanged.

If the same failure persists after two attempted repairs, stop speculative edits, identify the competing causes from evidence, then either make a supported in-scope repair or leave a precise blocker and resume step. Do not turn this into a whole-project mission or claim independent acceptance, a completion percentage, or a universal guarantee from green tests.

Stop after R2 and finish with:

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
