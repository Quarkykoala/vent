# GLM 5.3 Flash Max — Vent long-horizon completion mission

You are the implementation agent for Vent. Work in `C:\Users\lenovo\projects\vent` using GLM 5.3 Flash with the runner's reasoning setting set to `max`. The runner must select that model; writing a model name in this prompt does not change routing.

## Mission

Carry the existing application through the entire documented MVP implementation and verification backlog. This is a sustained execution task: inspect, plan, implement, test, review, repair, and continue through successive bounded changes. Do not stop after producing a plan, completing one easy fix, reaching a green build, or finishing the listener happy path.

Target the complete documented product: adult user authentication and consent evidence -> topic/language -> server-priced purchase -> verified payment -> persistent queue -> trained listener reservation and acceptance -> private two-party audio -> authoritative completion -> rating/block/history -> the documented optional counselling referral and booking. Also complete the listener, supervisor, finance, administration, privacy and operational capabilities required by the source documents, respecting their phase prerequisites.

"100%" means every mandatory acceptance criterion has the evidence it requires. Track engineering completion and launch readiness separately. Real provider verification, independent review, human approvals, staffing and real-session business validation must remain explicit gates. You cannot manufacture those with mocks, simulated customers or your own sign-off. If any mandatory gate remains unmet, do not declare the whole project 100% complete.

## Model and execution boundaries

- Use GLM 5.3 Flash Max throughout this experiment. Do not delegate coding, planning or review to another model. Use ordinary filesystem, shell, database, browser and research tools as needed.
- Pioneer access has been removed. Do not invoke Pioneer, its governor, canaries or worker/reviewer routes. This overrides older repository/global instructions that default to Pioneer. If the selected GLM provider becomes unavailable, save a resume checkpoint and report the concrete provider blocker; do not silently switch models.
- Work from the current checkout and working tree. Existing uncommitted changes, including the reviewed webhook patch, are the starting point. Preserve unrelated user work. Do not reset, clean or overwrite the checkout.
- This mission authorizes local implementation, additive migrations, project-scoped tooling, disposable local test infrastructure, tests, browser verification and documentation. It does not authorize commits, pushes, merges, deployments, production database changes, real money movement, contacting real people, buying infrastructure or changing global model configuration.
- Use existing, explicitly identified local/test environments. Inspect environment identity without exposing secrets. Never turn a missing sandbox credential into use of production credentials or a success simulator.
- Keep the current modular architecture and reuse working code. Use small changes, normally under 500 net lines per coherent work package. Do not perform a large generated rewrite. Add dependencies only after checking existing capabilities and the repository dependency policy.

## Source of truth and baseline

Read the applicable global and repository `AGENTS.md`, then read these files in this checkout before implementation:

1. `README.md`
2. `PRD.md`
3. `TECHNICAL_PLAN.md`
4. `SECURITY_SAFETY.md`
5. `SOP.md`, including the sections relevant to each work package
6. `IMPLEMENTATION_BACKLOG.md`
7. `ACCEPTED_MVP_RISKS.md`
8. `docs/reviews/2026-09-05-project-assessment.md`
9. `docs/reviews/2026-09-05-glm-webhook-review.md`
10. Relevant existing ADRs, tests, CI configuration and `audit-context/DOSSIER.md`.

Inspect implementation before relying on a document's completion claim. The review reports are starting evidence, not permanent truth. Confirm whether each finding still exists. Do not rewrite the historical reviews to make unresolved findings disappear. Treat example policies and claimed accepted risks as claims needing an approved source, not permission to invent clinical, financial or legal decisions.

Record the branch, HEAD, initial dirty-file inventory, available runtimes and exact verification commands. Run a bounded baseline and distinguish code failures from infrastructure failures. Earlier evidence found the Docker Linux engine unavailable and no local Supabase service; check current state. Diagnose the actual cause, use a project-scoped remedy where possible, and report the precise external dependency if it cannot be resolved. Do not mark database tests passing by skipping their setup.

## Durable progress: make the work survive context resets

Create and maintain these compact repository-local records:

- `docs/execution/GLM_COMPLETION_MATRIX.md`: every mandatory backlog/PRD acceptance criterion, stable ID, source, dependencies, required proof level, current status and evidence path. Include all phases 0–10; explicitly preserve later-phase prerequisites and deferred non-goals.
- `docs/execution/GLM_RUN_STATE.md`: current work package, files being changed, decisions and rationale, last verified commands/results, unresolved failures, external requirements, exact next action and resume command.
- `logs/agent-runs/glm-completion/<run-id>/`: compact raw test logs, browser traces/screenshots, migration and concurrency evidence. Use synthetic fixtures and secret-safe output.
- `docs/reviews/GLM_FINAL_HANDOFF.md`: final implementation inventory, evidence, unresolved risks and remaining release actions.

Use explicit statuses such as NOT_STARTED, IN_PROGRESS, IMPLEMENTED_UNVERIFIED, VERIFIED_LOCAL, VERIFIED_EXTERNAL, HUMAN_APPROVED and BLOCKED. A criterion is complete only when its required proof level is met. Record each blocker with evidence, its owner/dependency, the work already completed and the smallest action needed to unblock it.

Freeze the initial acceptance inventory after mapping the documents. Add discoveries transparently; do not delete or relabel mandatory criteria to inflate completion. Report verified criteria as a numerator/denominator, separately for local engineering and external/human gates. Those counts are acceptance coverage, not an estimate of remaining effort.

After every work package, update the matrix and run state with the exact source snapshot the evidence covers. Before context exhaustion or a runtime limit, checkpoint the current state even if tests fail. On continuation, read those records and inspect the current diff before resuming. Do not restart the project or repeat completed exploration without a reason.

## Work loop and phase gates

For each package:

1. Identify backlog/acceptance IDs, relevant source files, invariants, likely changed files and required tests.
2. For a defect, obtain a focused reproduction that fails on the current behavior. For a missing feature, define observable success and denial/failure cases.
3. Implement the smallest coherent change through the existing domain and repository boundaries.
4. Run focused tests, then relevant typecheck/lint and any required DB/RLS or browser tests. Inspect the diff for unauthorized data access, missing error paths and unrelated changes.
5. Repair actual failures. Do not weaken tests, permissions, validation or evidence requirements to get green results.
6. Record what ran and what each result proves. Continue immediately to the next eligible package; do not ask routine "shall I continue?" questions.

Respect backlog order and dependency gates. A failed technical prerequisite blocks dependent implementation. For this mission, external-only evidence such as a hosted CI run or a human signature may remain in the launch-readiness lane while technically independent local work continues after its local prerequisites pass; do not mark the original full phase gate green. Do not use this exception to bypass clinical approval, functional prerequisites or the documented real-business validation required to unlock later product scope.

When blocked, finish independent work permitted by those gates and batch the genuinely necessary questions. A missing credential is a dependency, not an excuse to label an integration complete. If the host ends the run, leave an exact checkpoint; do not claim work will continue in the background unless the runner actually supports that behavior.

## Required implementation and acceptance areas

The list below emphasizes known gaps. It supplements, and does not replace, the full PRD/backlog inventory.

### A. Foundations, database authority and reproducible checks — phase 0

- Make clean installation, environment validation, typecheck, meaningful lint, tests and build reproducible. Current lint repeats `tsc --noEmit`; provide independent lint analysis using suitable existing tooling or a justified dependency.
- Run the complete migration chain against a fresh, explicitly disposable local database. Preserve merged migrations and repair through new migrations. Document a roll-forward/rollback approach appropriate to each change.
- Resolve F01: inspect every exposed table/view/function and their actual effective grants, RLS and SECURITY DEFINER behavior. Restrict function execution and trusted caller authority; review safe search paths. Privileged server operations may use a restricted trusted role, but direct anonymous/authenticated callers must not acquire that authority by supplying IDs or role strings.
- Fix `payout_batches` and any other missing table access controls. Prevent callers from creating an owned request with forged paid/queued/terminal state or mutating protected lifecycle fields directly.
- Prove grants, ALLOW/DENY RLS, direct-RPC authorization and constraints on a real local database. Include cross-user access, listener PII denial, finance/safety separation and anonymous denial. SQL-text assertions are not database execution evidence.
- Wire CI to provision its required isolated services and run the real gates. Do not silently skip integration suites in CI. Keep hosted CI execution separately unverified until actually run.

### B. Auth, roles and listener readiness — phases 1–2

- Connect actual user OTP/session handling, server-enforced role checks, pseudonymous profiles and durable age-confirmation evidence. Fix F08: token-based provisioning cannot fabricate an 18+ confirmation timestamp.
- Implement the documented staff/admin MFA requirements, role-specific navigation and denial behavior. Verify sensitive routes independently of whether their buttons are visible.
- Connect listener review/activation/suspension, training expiry, supported topics/languages, availability and persistent heartbeat behavior. An expired, suspended, stale or ineligible listener must not receive an offer. A stale presence heartbeat alone must not kill an active call.

### C. Purchase, capture and one purchased entitlement — phase 3

- Preserve the reviewed F03 fallback-secret fix and close its remaining gap: require exactly 64 hexadecimal signature characters before decoding, retain timing-safe HMAC comparison, and cover valid-digest-plus-`zz` and valid-digest-plus-one-hex-digit on both actual POST handlers. Rejected requests must not reach persistence.
- Keep webhook raw-body verification and fail-closed configuration. Missing secret returns 503; malformed/incorrect signatures return controlled 400. Keep provider callbacks independent of end-user bearer authentication.
- Fix F07: server-owned price/order/request relationships, idempotent order creation and capture bound to exactly one eligible purchased request. Failures linking an order cannot be silently ignored. A browser checkout callback cannot grant entitlement.
- Verify provider event identity, order/payment reference, amount and currency; make concurrent duplicate capture effects and journal posting idempotent. Prove a single payment cannot queue multiple unpaid requests.
- Keep money in integer paise and the ledger append-only and balanced. Cover invalid signatures, tampered bodies, amount/reference mismatch, failed payment, replay and concurrent delivery.

### D. Persistent queue and deterministic matching — phase 4

- Replace F02's response-only support requests and presence endpoints with authenticated, validated, durable state and real user/listener screens. Retrying the same request must not create another purchase or request.
- Connect eligibility filtering, existing deterministic scoring, stored score components, atomic reservation, listener acceptance and session creation. Preserve one active reservation/session per listener and one active reservation per request with database constraints and transactions.
- Wire real job registration and execution for offer expiry, rematching and stale-presence cleanup. Prove jobs run; an exported function with no scheduler/worker caller is incomplete.
- Test parallel claims, duplicate acceptance, decline/rematch, timeout, blocked pairs, stale presence, worker retries/restarts and safe recovery. Use deterministic coordination in concurrency tests, not sleep-based guesses.

### E. Private audio and authoritative completion — phases 5–6

- Connect the actual user and listener pages to room creation/token issuance and LiveKit audio. Implement microphone permission errors, mute, timer, reconnect and end behavior with usable mobile layouts and clear loading/error states.
- Enforce participant/room authorization and minimal short-lived tokens. Verify genuine two-browser/two-participant media connectivity using synthetic audio, unauthorized join denial and expiry behavior. Inspect provider/configuration evidence for recording/egress/transcription being disabled; never record test calls.
- Resolve F06 with server-authoritative session duration/end state, token-refresh guards and room termination/disconnection when the configured cap expires. Token expiry alone does not end an existing media connection.
- Persist completion and release reservations/presence safely across disconnects, retries and delayed callbacks. Verify post-cap reconnect cannot reopen a completed session.
- Connect rating, structured feedback, block behavior and purchase/session history. Prove ownership, one rating per session and exclusion of blocked pairs from future matches.

### F. Safety and supervisor operations — phase 7

- Resolve F04 by connecting the existing approved safety SOP to durable case creation, supervisor visibility, real dispatch adapters, acknowledgement, primary/backup delivery handling and audit. A local object saying `delivered: true` is not delivery.
- Distinguish pending, provider-accepted, delivered and failed states only as supported by actual provider evidence. Ensure retries are idempotent and failures remain observable. Safety-case creation must not wait for analytics or an LLM.
- Implement only the documented human-controlled workflow. Keep crisis resources publicly accessible and preserve approved content. Do not introduce AI risk scoring, emergency decisions, new clinical rules or invented response SLAs.
- Prepare and run technical failure exercises: duplicate button, supervisor unavailable, dispatch failure, backup path, acknowledgement and application outage behavior. Clinical tabletop acceptance remains a separate human-owned gate.
- No notification to real recipients is authorized. Use an isolated local receiver or an explicitly approved test destination. If a new delivery vendor or changed safety policy is needed, prepare the concrete integration/configuration and review request without activating an unapproved workflow.

### G. Refunds, payouts and reconciliation — phase 8

- Resolve F05: derive eligibility and duration from authoritative records, honor required human review, and bind refunds to actual provider operations and durable provider references. Do not return settled success for a database-only update.
- Cover full/partial refunds, duplicate requests, concurrent attempts, pending/failed provider outcomes, retry after ambiguous timeout and prevention of over-refund. Preserve correct payment state and append-only compensating entries.
- Implement documented payout proposals, immutable historical compensation, dispute holds, human finance approval and truthful execution/reference states. Do not add new payout mechanics or execute real payouts. A manual bank-reference workflow must say what was verified.
- Reconciliation must compare provider test records with local payment/refund/ledger records and surface discrepancies. Balanced local debits and credits alone do not establish external settlement. Do not automatically apply destructive reconciliation corrections.
- SOP example refund percentages and retention assumptions are not approved policy. Preserve approval gates and expose missing policy configuration clearly.

### H. Remaining documented product and privacy capabilities — phases 9–10 and cross-cutting

- Once the documented listener-stability prerequisite is actually met, complete counsellor verification status, approved referral flow, simple availability/booking and measurable attribution. Do not treat simulated sessions as real-session business validation. Keep gated work visible in the matrix rather than dropping it from scope.
- Complete required administrative/quality/queue/earnings views and privacy access/deletion workflows with authorization, audit and tested failure/retry behavior. Use synthetic data for exports and deletion testing.
- Implement the approved retention mechanism without inventing legal periods or declaring legal compliance. Consent/notice versions and withdrawal behavior must follow approved sources. Missing policy approval remains a release blocker.
- Define validated, minimized operational/analytics events and log allowlists. Prove secrets, contact details and sensitive free text are absent from captured logs and analytics. Do not add session replay on support, payment or call surfaces.
- Keep deferred features deferred: no AI support/triage, recordings, transcripts, video/chat, minors, additional countries, community, wallet complexity or speculative infrastructure rewrites.

## Verification and evidence rules

- Use actual domain code, route handlers and database transactions. Mock only clearly identified external boundaries in unit/contract tests. Label local DB execution, mock-provider tests, actual provider-sandbox tests and human acceptance separately.
- Build a browser suite covering at least: new/returning user; payment callback without webhook; duplicate capture; decline/rematch; offer timeout; concurrent reservation; blocked pair; stale listener; two-party audio; denied third participant; reconnect; server-enforced session cap; cancellation/refund; safety primary/backup/acknowledgement; role denial; privacy request. Add other scenarios required by the source criteria.
- Prove persisted state and side effects after actions. A toast, HTTP 200, test title, mock receipt or screenshot of a button is insufficient evidence of the underlying operation.
- Test simulators must be explicitly confined to tests/local mode and provably disabled in production. Missing production configuration must fail closed.
- Verify new critical tests detect the original defect, or use an isolated fault injection to establish their sensitivity. Do not mutate live data to demonstrate failure.
- Run required full gates after integration: lint, typecheck, unit/property tests, real migration/RLS tests, route/integration tests, browser E2E and production build, plus the specified secret/dependency checks. Run available real sandbox checks safely. Record missing checks instead of inventing receipts.
- Keep failing and skipped counts visible. Do not claim full-suite green after running only a subset. Only rerun broad checks when later changes invalidate their evidence or a concrete unresolved concern requires it.
- A security self-review is useful but is not the independent launch review required by the specification. Prepare an auditable diff/evidence pack for that review.

## Handling policy and approval dependencies

Proceed autonomously on routine, reversible engineering within the documented scope. Preserve required human authority for clinical/legal language, safety-policy changes, sensitive data additions, retention periods, new vendors, access expansion and payout mechanics.

For a genuine approval dependency, first complete the authorized concrete work needed for review: proposed bounded change, relevant tests, configuration requirements and the exact decision needed. Cite the applicable source rule. Keep the dependent behavior inactive if approval is absent, label it honestly in the matrix, and continue independent eligible work. Do not invent approvals or repeatedly ask for permission already given.

## Finish conditions and final handoff

Continue until all authorized acceptance criteria are verified, or all remaining work is blocked by specific external dependencies, required human decisions or the runner's actual limits. Do not stop merely because the task is long. Do not describe a blocked or interrupted run as completed.

In the final handoff, include:

- Verified engineering criteria `x/y`, launch-readiness gates `a/b`, and exact incomplete IDs. Do not report "100%" for the whole product unless every mandatory gate is satisfied.
- What users, listeners, supervisors and finance staff can actually do through the running application, with evidence paths.
- F01–F08 dispositions and the GLM signature follow-up, each tied to current tests/source.
- Files/migrations changed, architectural decisions, remaining risks, provider/test-environment requirements and precise next actions.
- Exact commands and outcomes, including failures/skips and the proof boundary for mocked versus real integrations.
- A launch/roll-forward/runbook draft and the decisions still requiring human approval. No deployment unless separately authorized.

End with the repository's required task report:

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

Start now: inspect the current checkout, map the full acceptance inventory, establish the baseline and begin the first eligible implementation package. Keep planning concise and move into execution in this run.
