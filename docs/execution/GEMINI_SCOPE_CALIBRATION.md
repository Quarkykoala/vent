# Gemini scope calibration for Vent

Created: 2026-09-06. This is a working experiment design, not a benchmark result or a claim about a universal model limit.

## Operating decision

Use Gemini 3.8 Flash High as the default implementation model, one bounded task at a time, with Codex independently reviewing output. The user reports that Gemini is substantially faster in their setup. Comparable accepted-task timing and total correction cost have not yet been measured. Keep GLM available as an alternative; do not alternate models merely to manufacture a winner. Pioneer access has been removed.

Specific prompts should make correctness observable. They cannot ensure zero mistakes. Keep them focused on the objective, permitted edits, invariants, concrete failure cases, evidence and stopping point. Add instructions that address actual failure modes; avoid growing every future prompt into a catalogue of unrelated precautions.

## Evidence available now

| Work | Reviewed result | What it establishes |
|---|---|---|
| GLM's bounded webhook repair | 8/10; core repair accepted with malformed-signature follow-up | GLM can handle a small repair, with independent review still needed |
| GLM's larger completion run | Provisional 6/10 checkpoint; user paused it; backend findings remained | Evidence about that checkpoint; neither an autonomous abandonment nor a fair size-matched comparison with Gemini R1 |
| Gemini's bounded R1 repair | 8/10; production authorization fix validated, G1/G2 test issues remain | Useful bounded implementation; not a clean first-review acceptance of the whole package |

Sources: `docs/reviews/2026-09-05-glm-webhook-review.md` and `docs/reviews/2026-09-06-gemini-r1-review.md`. The older long-run report predates the user's pause clarification and the withdrawal of the precise 40%-to-45% progress comparison. Do not reuse its percentage as a measured baseline.

Current update (2026-09-06): G1/G2 are independently resolved; R1 is accepted with non-blocking diagnostic/reporting notes. See `docs/reviews/2026-09-06-gemini-r1-test-hardening-review.md`. This was a repair round on R1, not a second independent successful assignment. Do not count retries or smaller substeps as extra first-pass wins. R2 acceptance/session-creation recovery is the next production target for a separately scoped prompt.

## Scope ladder

Classify complexity before dispatch using behavioral invariants, subsystem boundaries, persistent state, migrations, failure/retry paths and required context. File count and lines changed are supporting observations; they are not the definition of difficulty. A small money/authorization transaction can be harder than a large visual change.

| Level | Assignment shape | Example and proof boundary |
|---|---|---|
| 1 | One concern in an existing path, with focused tests; no new subsystem or schema design | Finish the R1 test follow-up, then similarly bounded repairs. Verify exact before/after states and adversarial cases. |
| 2 | One complete backend operation across its handler, domain/repository and persistence boundaries | R2 acceptance/session recovery may fit here after inspection. Keep one domain concern, explicit failure/retry semantics, and a transaction/migration only if required. |
| 3 | One complete user journey crossing established subsystems | A bounded browser journey using existing backend contracts, with real browser proof and named provider/local limits. Do not also redesign payments or safety. |
| 4 | Two or three related, sequential work packages | Checkpoint and independently review each package. Measure continuity and recovery over the full run. This is not an unrestricted "finish the entire project" assignment. |

Repair follow-ups stay at the assigned level. R2 remains the next production target after R1 closes; inspect its actual boundary before writing the implementation prompt. If it exceeds the currently supported scope, divide it into independently reviewable steps or mark it explicitly as a higher-scope trial. Do not label it a small task simply because the defect description is short.

Increase one complexity dimension at a time where practical. For example, add persistence coordination while holding the number of user flows and the model/runner settings constant. Do not simultaneously increase domains, ambiguity, migration risk and task duration and then attribute the result to scope alone.

## Consistent prompt contract

Every task prompt should contain:

1. One concrete objective and the current source snapshot. Distinguish inspected facts from assumptions the agent must verify.
2. Relevant source-of-truth files and a bounded code edit list. Define what completion means before coding.
3. Acceptance criteria with observable inputs, outputs and persisted state. Include expected denial, retry, concurrency or failure behavior where the domain requires it.
4. Task-specific anti-shortcuts. For matching tests, isolate the real candidate pool; assert fixture ownership; check query errors; prove that a disabled behavior makes the test fail.
5. Named verification commands and evidence expectations. Distinguish a deliberately injected failure from a normal failed test. Require production/provider/browser proof only when it is part of the assigned scope.
6. A compact handoff and a stop condition. The implementer cannot promote its own scope or grant itself independent acceptance.

Specify outcomes and constraints precisely while leaving routine implementation choices to the model. If the prompt dictates every changed line, the experiment measures execution of that recipe more than independent engineering ability. Track how much design help the prompt provides.

## Promotion and fallback rules

Working threshold: aim for two separate tasks at the current level accepted on first independent review before the next planned increase. "First review" is after the implementer's own coding and verification; a reviewer-triggered fix is a repair round.

A clean acceptance requires all assigned criteria demonstrated, no open P0/P1/P2 findings, no weakened/missing required test, no unexplained skipped gate, no scope drift, and an accurate completion report. Minor non-blocking comments can be recorded without turning every stylistic suggestion into a failed task. Apply the same acceptance rubric across runs.

- One failed higher-scope trial is evidence about that task, not proof of a hard model ceiling. Diagnose whether the cause is scope, prompt ambiguity, test/environment design, provider availability or a review error.
- A P0/P1 defect blocks promotion. Two comparable trials needing substantive reviewer-directed repair at the same level indicate that it is above the current reliable operating scope for this setup; reduce the next assignment or split it at a clear boundary.
- Require clean evidence again before increasing. A product-priority exception may still be necessary, but label it as a higher-scope trial and retain its extra checkpoints.
- Track user pauses, quota failures, unavailable infrastructure and conflicting concurrent work separately from model mistakes. Those observations affect operational throughput but do not establish a reasoning limit.
- Keep a separate independent review step at every level. Narrow prompts and green unit tests do not replace it.

## Minimal run record

For every new assignment, append a compact record here or link an immutable task result/review with these fields:

```text
Task ID / parent package:
Model and thinking setting; runner/version; fresh or continued context:
Scope level and complexity dimensions:
Prompt path/version; initial source snapshot:
Design guidance supplied before execution:
Acceptance criteria and assigned proof boundary:
Dispatch / first result / independently accepted timestamps (with timezone):
Active work, verification, reviewer time, environment/user waiting (unknown if unavailable):
First independent review: accepted / repairs required / inconclusive:
Findings by severity; missed criteria; new regressions; evidence overclaims:
Reviewer-triggered repair rounds and user interventions:
Input/output tokens and actual cost if available (otherwise unknown):
Final disposition and evidence links:
Next scope decision and reason:
```

Primary measure: elapsed time to an independently accepted result, including implementation, verification and correction. Record end-to-end elapsed time as well as known waiting components; do not silently subtract inconvenient failures or count provider waiting as reasoning effort. Compare first-review acceptance and repair rounds alongside speed. Keep the user's observed speed advantage separate from measured timings until records support the comparison.

The useful outcome is a reliable operating range for Gemini with this prompt, runner, repository and review process. It is not a universal maximum file count, context length, engineering percentage or permanent ranking against GLM. Reclassify when the model, harness or prompting conditions materially change.

## Run record: R1 repair round, 2026-09-06

- Parent package: R1 matching authorization. Assignment: G1/G2 test hardening, Level 1. Intended/user-attributed model: Gemini 3.8 Flash High; exact runner version and context mode unknown.
- Prompt: `docs/prompts/gemini-3.8-flash-r1-test-hardening.md`. Starting source: account-handoff inventory at `docs/handoffs/2026-09-06-account-switch/source-sha256.json` on HEAD `d3ca22b397b5d50d468ee7fb162c4e09dc8ff655`.
- Guidance supplied: high specificity, known root cause, candidate-isolation suggestion, exact state assertions, existing independent mutation harness and required commands.
- Outcome: G1/G2 resolved; accepted with non-blocking P3 diagnostic/reporting notes. Review rating 9/10 for this repair round. No new blocking or production finding in this change.
- Independent evidence: three combined 15-test passes; intended suppressed-rematch failure; original R1 probe passes; full 303-test suite, typecheck, lint and build pass. Production/configuration source unchanged.
- Reporting corrections: lint is 474 warnings, not 475; R2 is acceptance/session-creation recovery; explicit query-error handling is incomplete in two helper reads. Exact evidence in `docs/reviews/2026-09-06-gemini-r1-test-hardening-review.md`.
- Timing: result timestamp 14:51:30 +05:30; independent full suite completed around 14:56 +05:30. Exact dispatch, active time, waiting breakdown, tokens and cost unknown. The user stayed on the same account for this cycle.
- Promotion: none. This closes a reviewer-triggered repair within R1, not another fresh first-pass success. Scope the R2 production assignment separately; preserve its persistence/retry proof boundary.

## Prepared assignment: R2 acceptance/session recovery, 2026-09-06

- Status: prompt prepared at the user's request; dispatch and implementation are not observed. No external model was launched by Codex.
- Intended model: Gemini 3.8 Flash High. Prompt: `docs/prompts/gemini-3.8-flash-r2-acceptance-recovery.md`.
- Scope: explicit Level 2 trial for the next P1 product defect, not an earned promotion. One backend operation crosses route, typed repository and a single additive database migration. Complexity increases in persistence coordination, failure recovery and replay/concurrency; no extra user journey or subsystem is assigned.
- Guidance: high. Codex supplied the observed failure, atomicity requirement, six behavior groups, legacy-state cases, permitted edit boundary, test-isolation rules, privilege checks and verification commands. SQL design, lock order and concrete test harness remain implementation decisions.
- Additional test lesson: the historical R2 fault hook can become unused when session insertion moves into SQL. Require actual injection at the new write boundary and evidence that the hook ran; historical probe success alone cannot establish recovery.
- Starting evidence: all 53 sources from the accepted R1 follow-up matched. A broader 179-file source/configuration/migration/test inventory and preparation receipt are in `logs/agent-runs/2026-09-06-gemini-r2-prompt/` on HEAD `d3ca22b397b5d50d468ee7fb162c4e09dc8ff655`.
- Checkpoints: pre-edit reproduction/design/test matrix; implementation/focused evidence; final gates/result. These are progress records, not permission gates or independent task wins.
- Dispatch, result, acceptance, runtime/token/cost metrics and first-review disposition remain pending/unknown. Codex ran no application tests for prompt preparation and made no implementation change.
