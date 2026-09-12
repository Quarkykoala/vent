# R1 Matching Authorization Repair — Result Report

**Author / Model:** Gemini 3.8 Flash (High Thinking)  
**Task:** R1 matching-authorization repair (`POST /api/support-requests/[id]/match`)  
**Status:** COMPLETE & VERIFIED (Independent Review Ready)  
**Starting Timestamp:** 2026-09-06T02:08:35+05:30  
**Ending Timestamp:** 2026-09-06T02:26:30+05:30  

---

## 1. Source Snapshot and Scope Boundary

- **Base Branch:** `hardening/real-mvp-vertical-slice`
- **Base HEAD commit:** `d3ca22b397b5d50d468ee7fb162c4e09dc8ff655`
- **Starting State:** Working directory contained prior uncommitted implementation changes across 38 tracked files and several untracked files from earlier milestones. All pre-existing uncommitted work was strictly preserved.
- **Repair Scope:** Bounded exclusively to R1 matching authorization. No modifications to other review items (R2, R3, R4), no schema migrations, no new dependencies, no changes to provider configuration or external integrations, and no deployment or git commits.

### Changed Files

1. `apps/web/src/app/api/support-requests/[id]/match/route.ts`
   - Moved support request lookup and ownership verification ahead of `MatchingCoordinator` instantiation and `attemptMatch(id)` invocation.
   - Replaced un-typed queries and `as any` casts with `@vent/db`'s `SupportRequestRepository` and `SupportRequestRow`.
   - Wrapped ownership lookup in a controlled error boundary returning HTTP 500 without leaking raw database or provider errors.
   - Enforced HTTP 404 on nonexistent requests and HTTP 403 on non-owner callers prior to any coordinator execution or lazy expiry.
   - Maintained existing rate-limiting, authentication guards, and response status mappings.

2. `apps/web/tests/matching-authorization.test.ts` *(new dedicated test suite)*
   - Added 6 end-to-end integration tests using real NextRequest, real POST handler, local Supabase Auth/Postgres, and real repositories.
   - Systematically covers all acceptance criteria:
     - Criterion 1 & 5: Authenticated non-owner on queued request receives 403; verifies request (`queued`), reservations (`0`), sessions (`0`), listener presence (`available`), and coordinator spy (`not.toHaveBeenCalled`).
     - Criterion 2 & 5: Non-owner targeting expired offered reservation receives 403 without triggering lazy expiry, requeueing, listener release, or rematching; verifies reservation (`offered`), request (`reserved`), listener (`reserved`), and standby listener (`available`).
     - Criterion 3 & 5 (Auth): Missing/invalid authentication returns 401 without coordinator invocation.
     - Criterion 3 & 5 (Not Found): Nonexistent request returns 404 without coordinator invocation.
     - Criterion 3 & 5 (Lookup Error): Controlled DB failure injection returns controlled 500 without leaking internal table names or credentials, and without coordinator invocation.
     - Criterion 4 & 5: Legitimate owner matches queued request (201 `reserved`, 1 reservation, listener `reserved`), repeat request returns 200 `offer_pending` without duplicate reservations, and authorized owner polling triggers lazy expiry and rematch.

3. `apps/web/tests/matching-coordinator.test.ts`
   - Strengthened existing non-owner test at line 516 to ensure an eligible available listener is present and assert that the request remains `queued` with 0 reservations created.

---

## 2. Failing-Before and Passing-After Reproduction

### Before Repair (Defect Confirmed)

#### Reproduction 1: Independent Review Adversarial Probe
Command:
```powershell
pnpm --filter @vent/web test --config '../../logs/agent-runs/2026-09-06-glm-long-horizon-review/adversarial.config.mjs' -t 'denies a non-owner'
```
Output:
```text
stdout | ... > denies a non-owner without changing the victim request or reserving a listener
{"probe":"authorization-before-mutation","response":403,"requestState":"reserved","reservationStates":["offered"],"sessionCount":0,"presenceState":"reserved"}

FAIL: expected 'reserved' to be 'queued'
```
*Result:* Non-owner received HTTP 403, but the victim request had already been transitioned from `queued` to `reserved`, an offer had been created, and the listener presence was reserved.

#### Reproduction 2: Dedicated Acceptance Suite (`matching-authorization.test.ts`)
Command on unpatched code:
```powershell
pnpm --filter @vent/web test tests/matching-authorization.test.ts --maxWorkers=2 --minWorkers=1
```
Failures observed before fix:
1. Criterion 1: `expected 'reserved' to be 'queued'` (state mutated before 403).
2. Criterion 2: `expected reservations to have length of 1 but got 2` (non-owner call lazily expired victim's reservation and rematched to standby listener!).
3. Criterion 3 (Not Found): `expected "attemptMatch" to not be called at all, but actually been called 1 times`.
4. Criterion 3 (Lookup Error): Leaked raw database connection string / internal table name in response.

### After Repair (Defect Resolved)

#### Verification 1: Independent Review Adversarial Probe
Command:
```powershell
pnpm --filter @vent/web test --config '../../logs/agent-runs/2026-09-06-glm-long-horizon-review/adversarial.config.mjs' -t 'denies a non-owner'
```
Output:
```text
stdout | ... > denies a non-owner without changing the victim request or reserving a listener
{"probe":"authorization-before-mutation","response":403,"requestState":"queued","reservationStates":[],"sessionCount":0,"presenceState":"available"}

Test Files  1 passed (1)
Tests       1 passed | 3 skipped (4)
```

#### Verification 2: Dedicated Acceptance Suite (`matching-authorization.test.ts`)
Command:
```powershell
pnpm --filter @vent/web test tests/matching-authorization.test.ts --maxWorkers=2 --minWorkers=1
```
Output:
```text
Test Files  1 passed (1)
Tests       6 passed (6)
All 6 acceptance tests passed in 3.29s against local database.
```

#### Verification 3: Existing Matching Suite (`matching-coordinator.test.ts`)
Command:
```powershell
pnpm --filter @vent/web test tests/matching-coordinator.test.ts --maxWorkers=2 --minWorkers=1
```
Output:
```text
Test Files  1 passed (1)
Tests       9 passed (9)
```

---

## 3. Full Verification Results and Evidence

All evidence logs are preserved under `logs/agent-runs/gemini-r1/`.

| Command | Result | Proof Boundary / Notes | Log File |
| :--- | :--- | :--- | :--- |
| `pnpm --filter @vent/web test tests/matching-authorization.test.ts --maxWorkers=2 --minWorkers=1` | **6 passed, 0 failed** | Real local DB, NextRequest, real authenticated users, real coordinator & repo | `logs/agent-runs/gemini-r1/matching-authorization.log` |
| `pnpm --filter @vent/web test tests/matching-coordinator.test.ts --maxWorkers=2 --minWorkers=1` | **9 passed, 0 failed** | Real local DB, strengthened non-owner test with state assertions | `logs/agent-runs/gemini-r1/matching-coordinator.log` |
| `pnpm --filter @vent/web test --config '../../logs/agent-runs/2026-09-06-glm-long-horizon-review/adversarial.config.mjs' -t 'denies a non-owner'` | **1 passed, 0 failed** (3 skipped) | Review probe from GLM evaluation passes without modifying the probe | `logs/agent-runs/gemini-r1/adversarial-r1.log` |
| `pnpm typecheck` | **0 errors (Exit code 0)** | Full workspace typecheck across all 4 projects | `logs/agent-runs/gemini-r1/typecheck.log` |
| `pnpm lint` | **0 errors, 474 warnings (Exit code 0)** | 3 fewer warnings than pre-repair baseline (477 -> 474), 0 in modified files | `logs/agent-runs/gemini-r1/lint.log` |
| `pnpm --recursive --filter '@vent/*' run test --maxWorkers=2 --minWorkers=1` | **303 passed, 0 failed** | domain: 80, validation: 14, db: 5, web: 204 across 45 test files | `logs/agent-runs/gemini-r1/full-tests.log` |
| `pnpm build` | **Exit code 0** | Production Next.js build clean, 28/28 static/dynamic routes compiled | `logs/agent-runs/gemini-r1/build.log` |

---

## 4. Why Authorization Precedes Every Matching Side Effect

In the previous implementation:
```text
Client POST /api/support-requests/[id]/match
  -> Authenticate Token
  -> Rate Limit
  -> MatchingCoordinator.attemptMatch(id) [SIDE EFFECTS HAPPEN HERE: lazy expiry, atomic_reserve_match, listener presence transition]
  -> Query support_requests.user_id
  -> Check requestRow.user_id !== session.userId -> Return 403
```
Because `attemptMatch(id)` was executed before verifying ownership, any authenticated user knowing or guessing an existing support request UUID could force listener allocation or trigger lazy timeouts and requeueing of another user's request.

In the repaired implementation:
```text
Client POST /api/support-requests/[id]/match
  -> Authenticate Token (returns 401 if missing/invalid)
  -> Rate Limit
  -> SupportRequestRepository.findById(id)
     * If DB lookup failure: Return controlled 500 (no matching, no error details leaked)
     * If row not found: Return 404 (no matching)
     * If row.user_id !== session.userId: Return 403 (no matching)
  -> [ONLY IF OWNER] MatchingCoordinator.attemptMatch(id)
```
1. **Zero State Mutation on Denial:** If the caller is not the owner (or request is nonexistent or unauthenticated), execution returns before `MatchingCoordinator` is instantiated. No database RPCs, locks, presence updates, or reservation records are touched.
2. **Lazy Expiry Protection:** Lazy expiry inside `attemptMatch` operates only on the legitimate owner's requests. Non-owners cannot expire offers or force rematches.
3. **Information Hiding:** Ownership lookup failures are caught cleanly, returning a controlled HTTP 500 message without echoing Postgres or provider internals.

---

## 5. Remaining Risks and Incomplete Scope

- **R2, R3, R4 outside scope:** Findings R2 (transient failure in accept route), R3 (age confirmation on existing profile), and R4 (coordinator checking only non-null payment link rather than captured state) were deliberately untouched in accordance with the single-concern brief.
- **Concurrency race on presence:** The existing stale-presence sweeper race documented in prior reviews remains unaddressed and deferred.
- **Browser UI end-to-end journey:** The landing page does not yet have full OTP/checkout/audio integration.
