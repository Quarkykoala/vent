# Muse phone sign-in and request-creation review — 2026-09-07

**Verdict: 8/10 for this task. The core feature works; two localized UI corrections remain.** This is useful progress toward the MVP. Complete the two corrections in one short follow-up, then continue product integration. This review does not authorize another model run.

The user attributes the implementation to Muse in CommandCode. The exact model identifier, reasoning setting, run duration, token usage and cost of that run are not recorded in the inspected project artifacts. The earlier direct API component experiment has separate measurements; they must not be attributed to this implementation run.

**Scope and attribution.** Compared with the 179-file manifest captured before this assignment, five existing source/test files changed and three were added. No dependency, migration or payment/matching/audio implementation change was detected in that baseline. The checkout remains on `hardening/real-mvp-vertical-slice` at HEAD `d3ca22b397b5d50d468ee7fb162c4e09dc8ff655`, with extensive historical uncommitted work preserved. The Git HEAD diff alone is not a Muse diff.

**M1 — P2: the completed form still permits accidental duplicate requests.** In `apps/web/src/app/page.tsx:75`, success resets the idempotency key; `:159` disables submission only while signed out, unconfirmed or pending. In the real browser, submitting Work & Career Stress / Hindi and clicking the same button again after success produced two HTTP 201 responses, different request IDs and two persisted rows. No new-request action or change of selection was needed. Retain a completed-request state and prevent repeated submission until the user explicitly starts another request. The existing lost-response retry behavior works and should be preserved.

**M2 — P2: confirmation claims a next step that has not started.** `apps/web/src/app/page.tsx:77` says “We'll now find you a trained listener.” The confirmed database row remains `created`, with no payment link and zero matching reservations. The assignment explicitly required a truthful saved-request confirmation without implying payment, matching or audio had occurred. Show the saved-request confirmation and the actual available next action; leave payment/matching integration to its own assignment.

**Verified behavior.** The actual home page sends OTP requests to the application's existing routes and passes the returned session token as Bearer authorization when creating a support request. The selected topic/language and returned request ID matched the persisted database row. Age consent gates sign-in and submission. A wrong code was rejected with a visible error, followed by successful sign-in using the configured local test code. The browser held no localStorage entries, sessionStorage entries or cookies after sign-in. After a simulated response loss following a real database write, retry returned HTTP 200 with the same request ID and idempotency key. An injected HTTP 401 restored phone sign-in and disabled request submission. This last check verifies UI handling of expiry; it does not wait for a real token to expire.

**R3 is resolved in the tested path.** An independently created local Auth account was token-provisioned into a public profile with null age evidence. Only the OTP provider-verification boundary was stubbed for this regression probe; the auth service, profile repository, local Auth/Postgres and request handler were real. Explicit age-gated verification filled the missing evidence and a valid authenticated request returned HTTP 201. Existing evidence is retained in the ordinary sequential path. No broader concurrency claim is made.

The preserved original R3 probe initially reported `ageEvidencePresent: true` but failed its request-creation assertion with HTTP 400. Its old request fixture omitted the required `ageConfirmed: true` field. A review-only copy adds that single field; no assertions or application code were changed. The adapted probe passes, and the original failure remains in the evidence directory. This fixture problem is not a Muse implementation failure.

**Checks actually run.**

| Check | Result |
|---|---|
| Five focused test files: auth service, auth guard, OTP routes, age evidence, support-request flow | 37 passed; mocked boundary tests plus local database integration tests |
| Independent R3 probe with current valid request fixture | 1 passed, 3 unrelated probes intentionally skipped |
| Muse's existing phone-signin E2E tests and updated smoke test | 3 passed, one Chromium worker, no retries |
| Manual Chromium flow with local Supabase and persisted-row inspection | Sign-in, selection persistence, request creation, wrong code, lost-response retry and 401 handling checked; M1/M2 reproduced |
| `pnpm typecheck` | Passed |
| `pnpm lint` | Passed: 0 errors, 476 warnings |

Browser tests used an isolated Next development server at `http://127.0.0.1:3107` and the existing local Supabase stack at `http://127.0.0.1:54321`. The fixed synthetic phone/code mapping was verified in the running local Auth container before using it. This exercises real local Auth and application persistence, with simulated SMS delivery; it is not proof of real handset delivery or production provider readiness. The independent R3 probe uses a separate provider stub as described above.

The full application suite, production build, complete payment-to-audio journey, real SMS delivery, deployment and older R2/R4 counterexamples were not run in this bounded review. The passing tests do not establish whole-project launch readiness. A missing development favicon and expected browser errors from the deliberately rejected/aborted requests do not change this verdict.

**Evidence:** `logs/agent-runs/2026-09-07-muse-signin-review/` contains intake and source hashes, focused/typecheck/lint logs, original and adapted R3 results, the isolated Playwright runner and E2E log, browser response/confirmation records, before/after persisted-row records and fixture cleanup. Browser snapshots are under `.playwright-cli/` for this named session. Four exact request IDs created by these browser checks were cleaned up; the configured synthetic Auth/profile fixture was retained. The review browser and temporary Next server were closed. The user-managed Docker stack was left running.

```text
Task: Independently review Muse's phone sign-in and authenticated request-creation output.
Backlog item: P1.1 User OTP; P4.1 Create support request; existing R3 age-evidence repair.
Files changed: Muse changed page.tsx, supabase-auth-service.ts, user.repository.ts, supabase-auth-service.test.ts and smoke.spec.ts; added PhoneSignIn.tsx, otp-routes.test.ts and phone-signin.spec.ts. Codex added review/evidence files and updated CONTINUE_HERE.md; no application repairs.
Behavior changed: Real browser phone sign-in and authenticated request creation; existing null age evidence filled after successful explicit age confirmation.
Tests run: 37 focused tests, 1 adapted independent R3 probe, 3 existing browser tests, manual browser/database checks, typecheck and lint. Original R3 fixture failure preserved and explained above.
Security/privacy impact: Age and authenticated-request gates exercised; credentials remain in browser memory in the observed flow. No real SMS, customer data or paid model calls used for review.
Data migration: None. Synthetic review requests cleaned up; local test identity/profile retained.
Observability: Review artifacts record actual statuses, persisted rows, checks and limitations. No new product observability was implemented.
Known risks: M1 duplicate submission after success; M2 misleading matching promise. Historical R2/R4 and broader journey gaps remain outside this task.
Not done: Application fixes, commit, push, deployment, real SMS/provider acceptance, production build/full suite, whole-project readiness assessment or new model invocation.
```
