# Gemini 3.8 Flash High — R1 Test Reliability Follow-Up Result

- **Date / Timestamp:** 2026-09-06T14:51:30+05:30
- **Model / Runner:** Gemini 3.8 Flash (Thinking: HIGH)
- **Git Base Commit:** `d3ca22b397b5d50d468ee7fb162c4e09dc8ff655`
- **Objective:** Resolve G1 (candidate pool cross-test interference) and G2 (weak rematch assertion blind spot) from `docs/reviews/2026-09-06-gemini-r1-review.md` without changing any production application code, database migrations, dependencies, or runner settings.

---

## 1. Scope and File Hash Integrity

No production code, migrations, API route logic, domain logic, dependencies, or Vitest worker settings were modified. Only test files were edited.

### Production Files (Verified Unchanged)
| File | Status | SHA-256 Hash |
|---|---|---|
| `apps/web/src/app/api/support-requests/[id]/match/route.ts` | **Unchanged** | `AEDCA9EBDEB1CD0EB84DB6A6CEA30123A6E7DE66EE1950192067D64852E0B383` |
| `apps/web/src/features/matching/coordinator.ts` | **Unchanged** | `FC813FA7C8BAFFBA6C9DBB4B9EB0C6BF5FB4E40E3E723826D43B51456A2FF59A` |

### Test Files (Allowed Edits)
| File | Status | SHA-256 Hash | Rationale |
|---|---|---|---|
| `apps/web/tests/matching-authorization.test.ts` | Modified | `4F168A263D225D0A9011A69ABA8F62176680E19875377FD8F71993E98C0DFDB3` | Implemented synthetic language isolation per scenario (G1), pre-call candidate eligibility verification (G1), strict HTTP 201 + replacement reservation assertions on rematch (G2), and strict query/cleanup error handling. |
| `apps/web/tests/matching-coordinator.test.ts` | Modified | `D0BBDE8CA867CB0CD9099B2D4EE2600BBF70D173C7739A0910C351B29A23F097` | Corrected cleanup query at line 214 from `.in('id', cleanupIds.presenceIds)` to `.in('listener_id', cleanupIds.presenceIds)` so `listener_presence` rows are reliably deleted. |

---

## 2. G1: Candidate Pool Isolation Mechanism & Resolution

### Root Cause Analysis
In the baseline test environment, both `matching-authorization.test.ts` and `matching-coordinator.test.ts` provisioned listeners with `languages: ['English']` and `topics: ['Work & Career Stress']`. When run concurrently with `--maxWorkers=2`:
1. Requests in `matching-authorization.test.ts` could match available listeners provisioned by `matching-coordinator.test.ts`.
2. When `matching-coordinator.test.ts` finished, its `afterAll` hook deleted its listeners from `listener_profiles`.
3. Postgres foreign key cascading (`match_reservations.listener_id REFERENCES listener_profiles(id) ON DELETE CASCADE`) deleted reservations created in `matching-authorization.test.ts`.
4. Subsequent assertions in `matching-authorization.test.ts` found zero reservations instead of the expected active offer.

### Repair Mechanism
1. **Scenario-Specific Language Discriminator:**
   Each test scenario in `matching-authorization.test.ts` uses a unique synthetic language generated via:
   ```ts
   function scenarioLanguage(scenarioKey: string): string {
     return `AuthLang_${suiteRunId}_${scenarioKey}_${++nonce}`;
   }
   ```
   - In Postgres, `support_requests.language` is typed `text not null` and `listener_profiles.languages` is typed `text[]`. Neither table has a check constraint restricting language to an enum.
   - `@vent/domain`'s `findBestMatch` performs candidate filtering via `c.languages.includes(request.language)`.
   - By assigning each scenario's request and listeners a distinct synthetic language string, candidates from other scenarios or suites are hard-filtered out during candidate selection.
2. **Pre-Call Candidate Verification:**
   Before calling the route handler in negative/denial tests, the test queries the database to prove that an active, trained, available listener with a fresh heartbeat (<30s) and matching language/topic exists. This proves the 403 response is due to authorization denial rather than candidate exhaustion.
3. **Strict Query and Cleanup Error Checking:**
   Every insert, update, select, and delete operation checks for database errors. Cleanup IDs are registered immediately after creation. All cleanup errors are recorded and reported in `afterAll`.

---

## 3. G2: Rematch Assertion Strengthening & Sensitivity Proof

### Root Cause Analysis
In the baseline test, the owner rematch test after lazy expiry accepted HTTP 200 with status `no_candidates` or `offer_pending` as a passing condition:
```ts
// Baseline weak assertion:
expect([200, 201]).toContain(res3.status);
```
When run against the `rematch-sensitivity.config.mjs` mutation harness (which suppressed rematching after expiring an offer), the test suite still passed because 200 was treated as acceptable.

### Repair Mechanism
In `criterion 4 & 5`:
1. **Initial Owner Match:** Strict HTTP 201; status `reserved`; non-null `reservationId` and `listenerId`; listener belongs to scenario pool; request state `reserved`; exactly one reservation created.
2. **Repeat while Offer Active:** Strict HTTP 200; status `offer_pending`; exact same `reservationId`; exactly one reservation persists in database.
3. **Fixture Expiry:** Sets `expires_at` to 5 minutes in the past without using wall-clock sleeps, and reads back the expired reservation from the database before proceeding.
4. **Authorized Rematch Poll:** Strict HTTP 201; status `reserved`; a **new** reservation ID (`body3.reservationId !== body1.reservationId`); listener ID belongs to the scenario's eligible listener pool.
5. **Persisted State Assertions:**
   - Exactly two reservations exist in `match_reservations` for the request.
   - Original reservation has state `expired`.
   - Exactly one reservation has state `offered` (the new reservation).
   - `support_requests.state` is `reserved`.
   - Newly selected listener's presence is `reserved`.

---

## 4. Verification Evidence & Quality Gates

All commands were executed sequentially against the local Vent Supabase test stack (`127.0.0.1:54321`) with `--maxWorkers=2 --minWorkers=1`.

| Check / Gate | Command / Config | Exit Code | Outcome | Evidence Log |
|---|---|---|---|---|
| **Baseline Combined Run** (Pre-fix) | `pnpm --filter @vent/web test tests/matching-authorization.test.ts tests/matching-coordinator.test.ts --maxWorkers=2` | 1 | **Failed** (2 failed, 13 passed) due to G1 candidate pool collision | `logs/agent-runs/gemini-r1-test-hardening/baseline-combined.log` |
| **Baseline Rematch Sensitivity** (Pre-fix) | `vitest run --config rematch-sensitivity.config.mjs -t "legitimate owner"` | 0 | **Passed** (G2 blind spot: passed despite rematch suppression) | `logs/agent-runs/gemini-r1-test-hardening/baseline-sensitivity.log` |
| **Combined Run 1** (Post-fix) | `pnpm --filter @vent/web test tests/matching-authorization.test.ts tests/matching-coordinator.test.ts --maxWorkers=2` | 0 | **Passed** (2 test files, 15 passed, 0 failed) | `logs/agent-runs/gemini-r1-test-hardening/combined-run-1.log` |
| **Combined Run 2** (Post-fix) | Same exact command | 0 | **Passed** (2 test files, 15 passed, 0 failed) | `logs/agent-runs/gemini-r1-test-hardening/combined-run-2.log` |
| **Combined Run 3** (Post-fix) | Same exact command | 0 | **Passed** (2 test files, 15 passed, 0 failed) | `logs/agent-runs/gemini-r1-test-hardening/combined-run-3.log` |
| **Independent R1 Probe** | `vitest run --config adversarial.config.mjs -t "denies a non-owner"` | 0 | **Passed** (1 passed, 3 skipped as expected) | `logs/agent-runs/gemini-r1-test-hardening/adversarial-r1.log` |
| **Post-Fix Rematch Sensitivity Probe** | `vitest run --config rematch-sensitivity.config.mjs -t "legitimate owner"` | 1 | **Failed as Expected** (`AssertionError: expected 200 to be 201` at line 605) — Proves G2 sensitivity | `logs/agent-runs/gemini-r1-test-hardening/rematch-sensitivity.log` |
| **Typecheck Gate** | `pnpm typecheck` | 0 | **Passed** across 4 workspace packages (`@vent/domain`, `@vent/validation`, `@vent/db`, `@vent/web`) | `logs/agent-runs/gemini-r1-test-hardening/typecheck.log` |
| **Lint Gate** | `pnpm lint` | 0 | **Passed** (0 errors, 475 pre-existing warnings in unrelated files, 0 warnings in modified test files) | `logs/agent-runs/gemini-r1-test-hardening/lint.log` |
| **Full Workspace Test Suite** | `pnpm --recursive --filter "@vent/*" run test --maxWorkers=2` | 0 | **Passed** (45 test files, 303 passed, 0 failed) | `logs/agent-runs/gemini-r1-test-hardening/full-tests.log` |
| **Production Build** | `pnpm build` | 0 | **Passed** (Next.js 15 production build compiled with 28 static/dynamic routes) | `logs/agent-runs/gemini-r1-test-hardening/build.log` |

---

## 5. Summary of Rematch Sensitivity Failure
Under `rematch-sensitivity.config.mjs`, rematching after expiry is suppressed (returning 200 `no_candidates`). The strengthened test caught this regression immediately:
```
FAIL tests/matching-authorization.test.ts > R1: Matching authorization regression — state and ownership invariants > criterion 4 & 5: legitimate owner matches queued request, repeating while offer active produces no duplicate, and authorized lazy expiry rematches
AssertionError: expected 200 to be 201 // Object.is equality

- Expected
+ Received

- 201
+ 200

  ❯ tests/matching-authorization.test.ts:605:25
    603| 
    604| // Strict G2 expectation: MUST be 201 'reserved', producing a NEW reservation ID and reserving an eligible scenario listener
    605| expect(res3.status).toBe(201);
       | ^
    606| const body3 = await res3.json();
    607| expect(body3.status).toBe('reserved');
```
This intentional failure confirms that the test is sensitive to broken rematch behavior and will never allow an un-rematched expired offer to pass silently.

---

## 6. Security and Privacy Impact
- Zero modifications to production source code or security policies.
- Authorization checks are verified to run strictly prior to database mutations or coordinator matching.
- Negative tests verify HTTP 403/401 with zero state changes, zero listener reservations, zero coordinator calls, and zero disclosure of database or internal system details.

---

## 7. Known Risks and Deferred Items
- **G1/G2 follow-up complete:** Test reliability and assertion coverage gaps identified in review are fully repaired.
- **Independent review required:** Handed off for independent reviewer evaluation as required by project protocol.
- **Deferred items:** Findings R2 (payment order authorization), R3, R4, and launch gates were intentionally untouched per brief boundary.
