# GLM webhook patch review — 2026-09-05

**Verdict: accept the core F03 fix; request one small follow-up to finish the malformed-signature acceptance criterion. Rating: 8/10 for this bounded task.** This is an assessment of the inspected output, not a general model benchmark. The user attributes the output to GLM 5.3 Flash Max.

The patch removes the alternate webhook route's fallback secret and delegates missing-configuration handling to the existing processor. Both webhook paths now return 503 without touching the mocked persistence boundary when the secret is absent, empty or whitespace-only. The legacy-placeholder regression is specifically covered. The patch preserves raw-body verification, both route URLs and valid capture behavior.

## Scope and attribution

- Base commit: `d3ca22b`; branch: `hardening/real-mvp-vertical-slice`.
- GLM changed [the alternate route](C:/Users/lenovo/projects/vent/apps/web/src/app/api/webhooks/razorpay/route.ts:4): 2 additions and 8 deletions.
- GLM added [24 route tests](C:/Users/lenovo/projects/vent/apps/web/tests/webhook-route-security.test.ts:110), exercising both actual POST handlers with real NextRequest objects and the actual HMAC processor. Only the database/admin-client boundary is mocked.
- No dependency, migration, accounting or other application-source change was present in the inspected patch.
- This review preserved both GLM files byte-for-byte; SHA256 values were compared before and after execution and saved in [source-hashes.json](C:/Users/lenovo/projects/vent/logs/agent-runs/2026-09-05-glm-webhook-review/source-hashes.json).
- No Pioneer provider calls or subagents were used for this review.

## Verification performed independently

| Check | Result | Evidence |
| --- | --- | --- |
| GLM route regression suite on current code | 24 passed | [Focused test log](C:/Users/lenovo/projects/vent/logs/agent-runs/2026-09-05-glm-webhook-review/focused-tests.log) |
| Same suite with the original route loaded from `d3ca22b` | 20 passed, 4 failed as expected | [Baseline test log](C:/Users/lenovo/projects/vent/logs/agent-runs/2026-09-05-glm-webhook-review/baseline-tests.log) |
| Additional independent route probes | 8 passed, 4 failed; one shared parsing gap described below | [Probe log](C:/Users/lenovo/projects/vent/logs/agent-runs/2026-09-05-glm-webhook-review/edge-probes.log) |
| `pnpm typecheck` | Passed across four packages | [Typecheck log](C:/Users/lenovo/projects/vent/logs/agent-runs/2026-09-05-glm-webhook-review/typecheck.log) |
| `pnpm lint` | Passed; configured lint is another `tsc --noEmit` run, not independent lint analysis | [Lint log](C:/Users/lenovo/projects/vent/logs/agent-runs/2026-09-05-glm-webhook-review/lint.log) |
| `pnpm build` | Passed | [Build log](C:/Users/lenovo/projects/vent/logs/agent-runs/2026-09-05-glm-webhook-review/build.log) |
| `git diff --check` | Passed for the tracked diff | Executed directly during review |

The baseline replay used a Vite load hook to substitute only the original route in memory. It did not revert the working file. Three baseline failures concern missing/empty configuration and legacy-placeholder acceptance. The fourth concerns the old missing-signature response's `error` field versus the new response's `message` field; its HTTP status was already 400. In particular, the placeholder-signed capture returned 200 on the old route and 503 after GLM's fix. This independently establishes regression value; it does not establish the order in which GLM itself wrote or ran tests.

The additional passing probes confirm exact signed whitespace is preserved, whitespace-only body tampering is rejected, missing secret plus missing signature returns 503, and an extra full hex byte is rejected, on both routes.

## Remaining finding: P2 — malformed signatures with a valid digest prefix are accepted

The [new malformed-signature tests](C:/Users/lenovo/projects/vent/apps/web/tests/webhook-route-security.test.ts:223) cover non-hex input and a short hex string, but miss malformed strings that begin with a correct digest. The existing [processor at line 57](C:/Users/lenovo/projects/vent/apps/web/src/features/payments/payment-processor.ts:57) decodes with `Buffer.from(signature, 'hex')` before comparing. That decoder discards a non-hex suffix or a final unmatched hex digit.

For **each route**, independent tests reproduced:

| Supplied signature | Expected by prompt | Actual | Mock capture calls |
| --- | --- | --- | --- |
| Correct 64-character digest + `zz` | 400 | 200 | 1 |
| Correct 64-character digest + `f` | 400 | 200 | 1 |
| Correct 64-character digest + `ff` | 400 | 400 | 0 |

This is inherited processor behavior, not a new vulnerability introduced by GLM. It requires possession of a valid signature for the exact body and does **not** demonstrate forging a payment or changing a signed amount. Its significance here is that the requested malformed/wrong-length rejection contract is not fully satisfied, and the new tests miss it.

Small follow-up: validate that the supplied signature contains exactly 64 hexadecimal characters before decoding, retain timing-safe comparison, and extend the real-route suite with the two reproduced malformed-prefix cases. Both must return 400 without admin-client creation or persistence. Keep scope limited to the verifier and regression tests.

Reproduce the additional probes from the repository root:

```powershell
pnpm --filter @vent/web test --config '../../logs/agent-runs/2026-09-05-glm-webhook-review/edge-probes.config.mjs'
```

The intentionally failing review probes live under `logs/agent-runs/`, outside the application's normal test discovery. They document the outstanding gap and were not added to GLM's patch.

## Proof boundary and rating

The small production diff, real handler/HMAC coverage, persistence-denial assertions, environment restoration and verified baseline regression are strong work for the assigned repair. The missed malformed-prefix case keeps this below full completion of the prompt. **8/10** reflects that bounded result; this small task cannot establish comparative ability across GLM and Gemini on the full application.

No real Razorpay, Supabase or ledger transaction ran. No browser end-to-end flow or full workspace test suite was rerun in this review. The earlier project's database, payment lifecycle, safety-delivery and usable-MVP gaps are outside this patch. This repair does not materially change the earlier rough 40% usable-MVP estimate.

```text
Task: Review GLM's webhook fail-closed output.
Backlog item: P3.2 Webhook; prior assessment F03.
Files changed: Review report, isolated reproduction probes/configs, logs and generated local harness/index artifacts; GLM source/test files preserved.
Behavior changed: None by this review; GLM's patch removes fallback-secret acceptance.
Tests run: Current route suite 24 passed; original-route replay 20 passed/4 expected failures; extra probes 8 passed/4 failures; typecheck, configured lint, build and tracked diff whitespace check passed.
Security/privacy impact: Main fallback-secret defect fixed; one inherited malformed-signature parsing gap remains; synthetic fixtures only, no production access or external payment effects.
Data migration: None.
Observability: Local evidence and source hashes saved; no runtime monitoring added.
Known risks: Malformed valid-prefix signatures accepted; real database/payment behavior and broader MVP gaps remain unverified by this patch.
Not done: Follow-up fix, full application re-review, live integration testing, commit, push or deploy.
```
