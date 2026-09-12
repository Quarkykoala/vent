# Gemini 3.8 Flash — R1 matching authorization repair

Work in `C:\Users\lenovo\projects\vent` using Gemini 3.8 Flash with thinking set to HIGH in the runner. This is one bounded implementation task. Complete it, verify it and stop for independent review.

This prompt replaces the previous GLM mission's task scope and model restriction for this run. Do not resume the whole-project completion mission. Pioneer access has been removed: do not invoke Pioneer, another model or subagents. Ordinary coding, database and test tools are allowed. Do not change provider configuration.

## Objective

Fix R1: `POST /api/support-requests/[id]/match` must authorize request ownership before invoking matching, lazy expiry or any operation that changes the request/reservation/listener/session state.

The current handler calls `MatchingCoordinator.attemptMatch(id)` before checking ownership. A reproduced non-owner request returns 403 after changing the victim request from queued to reserved, creating an offered reservation and reserving a listener. The existing ownership test checks only the status code.

## Inspect first

Read applicable `AGENTS.md` instructions and the relevant requirements in README, PRD, TECHNICAL_PLAN, SECURITY_SAFETY, SOP and IMPLEMENTATION_BACKLOG. Keep inspection focused on this repair. Inspect these files:

- `C:\Users\lenovo\projects\vent\apps\web\src\app\api\support-requests\[id]\match\route.ts`
- `C:\Users\lenovo\projects\vent\apps\web\src\features\matching\coordinator.ts`
- `C:\Users\lenovo\projects\vent\packages\db\src\repositories\support-request.repository.ts`
- `C:\Users\lenovo\projects\vent\apps\web\tests\matching-coordinator.test.ts`
- R1 in `C:\Users\lenovo\projects\vent\docs\reviews\2026-09-06-glm-long-horizon-review.md`
- The first probe in `C:\Users\lenovo\projects\vent\logs\agent-runs\2026-09-06-glm-long-horizon-review\adversarial.test.ts`

Record the starting branch/HEAD and dirty-file inventory. Preserve existing work and build on the current checkout. Verify that the defect still exists before editing.

## Scope

Prefer a small route repair plus focused regression tests. Extend the existing matching test suite or add one dedicated matching-authorization test file. Change supporting code only if necessary to enforce this boundary.

Preserve authentication, rate limiting, valid owner behavior, domain transitions, atomic reservation logic and RLS. Avoid new dependencies, migrations, new `any` casts, public API redesign and unrelated cleanup. Do not repair the other review findings in this package.

No commits, pushes, deployments, database resets, production access, real payment operations or external notifications. Test only against the identified local Vent Supabase stack using synthetic fixtures. Confirm the endpoint before running mutating tests; never fall back to production. Clean up only fixtures created by your tests. If the environment is unavailable, report the actual blocker and leave a precise checkpoint.

## Acceptance criteria

1. A valid authenticated non-owner targeting a queued request with a captured payment and an eligible available listener receives 403. The request, reservations, sessions and listener presence remain unchanged.
2. A non-owner targeting another user's expired offered reservation receives 403 without triggering lazy expiry, requeueing, listener release or rematching. Expiry timestamps must be controlled by the fixture; do not use sleeps.
3. Missing/invalid authentication returns 401 without matching work. A nonexistent request returns 404. An ownership lookup failure returns a controlled error without invoking matching or exposing raw provider details.
4. The legitimate owner can still match a queued, captured-payment request, producing exactly one reservation and the expected presence state. Repeating the request while the offer is active must not create another reservation. Preserve authorized expiry/rematch behavior.
5. Denied requests never invoke the coordinator. If using a spy for this assertion, keep the real implementation intact on allowed paths. Operational rate-limit counters are permitted; the protected business state must not change.

## Tests and implementation

Write the regression before changing production code and demonstrate that it fails for the observed unauthorized mutation. Use a real NextRequest, actual POST handler, real authenticated local users, real coordinator/repositories and local Postgres for the core ownership regression. Do not replace them with success-returning mocks.

Create fresh eligible fixtures for the denied-request tests. They must not pass merely because a previous test consumed the listener, matching found no candidate, or rate limiting rejected the call. Assert persisted before/after state, not just HTTP status. A controlled database-boundary failure injection is appropriate for the lookup-error case; identify it explicitly.

Make the smallest correct repair, then rerun the regressions and existing matching tests. Do not change expectations to accept the defect or weaken permissions to get green results.

Run focused checks during editing. Once the package is ready, run typecheck, lint, the full workspace suite and build once. The unrelated browser onboarding failure is already documented; do not claim browser E2E passes or expand into an onboarding rewrite.

Useful commands from the repository root:

```powershell
pnpm --filter @vent/web test tests/matching-coordinator.test.ts --maxWorkers=2 --minWorkers=1
pnpm --filter @vent/web test --config '../../logs/agent-runs/2026-09-06-glm-long-horizon-review/adversarial.config.mjs' -t 'denies a non-owner'
pnpm typecheck
pnpm lint
pnpm --recursive --filter '@vent/*' run test --maxWorkers=2 --minWorkers=1
pnpm build
```

Also run any dedicated test file you add. Select the local test URL and credentials explicitly without printing secrets. The three other independent review probes concern separate defects and remain outside this package; do not edit them to obtain a green result. Record failures and skips honestly. The prior baseline had 297 passing existing tests and 477 lint warnings; neither number excuses a new regression.

## Evidence and stopping point

Save compact logs under `C:\Users\lenovo\projects\vent\logs\agent-runs\gemini-r1\`. Save a result report at `C:\Users\lenovo\projects\vent\docs\reviews\gemini-r1-matching-authorization-result.md` with:

- Starting and ending timestamps, source snapshot and changed files.
- The failing-before and passing-after reproduction.
- Commands, test counts, failures/skips and exact proof boundaries.
- Why authorization now precedes every matching side effect.
- Remaining risks and any incomplete acceptance criterion.

Do not rewrite historical reviews or mark the larger matching/MVP mission complete. If context is exhausted, save the exact next action. Otherwise finish this repair and stop after the final diff review and verification; do not start R2 automatically.

End your response with:

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

Begin by inspecting the current route and reproducing R1, then implement the repair.
