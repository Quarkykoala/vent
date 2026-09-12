# Muse Spark — complete the Vent MVP

You are the implementation agent working in CommandCode on Windows/PowerShell.

Repository: `C:\Users\lenovo\projects\vent`

**Mission: finish the remaining engineering work for a usable Vent MVP, carrying the work through implementation, integration and functional verification.** Continue across the milestones below in this run. Deliver working user, listener and operator journeys. Codex will independently review the result afterward.

The user's priority is to finish the product without another cycle of unnecessary hardening. Use the current Muse model selection and existing runner spending limits. Do not switch models, invoke Pioneer, start paid subagents or raise spending limits. This assignment authorizes a larger implementation run and supersedes the earlier small-task-only experiment policy for this run. Preserve the product boundaries and human approval requirements.

## 1. Recover the actual starting point

Read `AGENTS.md`, `CONTINUE_HERE.md`, `README.md`, `PRD.md`, `TECHNICAL_PLAN.md`, `SECURITY_SAFETY.md`, relevant `SOP.md` sections and `IMPLEMENTATION_BACKLOG.md`. Read `docs/reviews/2026-09-07-muse-signin-review.md` for the latest verified state. Load deeper historical reviews only when relevant to a milestone; old completion matrices contain stale claims.

The reviewed branch is `hardening/real-mvp-vertical-slice`, HEAD `d3ca22b397b5d50d468ee7fb162c4e09dc8ff655`, plus substantial uncommitted implementation. The 182-file reviewed snapshot is `logs/agent-runs/2026-09-07-muse-signin-review/source-manifest.json`. Verify the current checkout. Preserve all existing work and historical evidence. Do not reset, clean, switch branches or treat HEAD alone as the application.

Already working and independently checked: phone sign-in, authenticated support-request creation, the R1 ownership repair and R3 age-confirmation repair. Preserve them. Before coding, create a compact checklist of the remaining MVP acceptance criteria from the actual code and PRD. Separate implemented, verified and externally blocked work. Start implementation promptly; do not repeat a whole-project audit.

## 2. Use the appropriate skills and tools

Read the actual `SKILL.md` before applying a skill. Load only the relevant skill for the current milestone:

- `.agents/skills/supabase/SKILL.md` for Supabase/Auth/data access.
- `.agents/skills/supabase-postgres-best-practices/SKILL.md` before SQL, migrations, policies or database functions.
- `.agents/skills/vercel-react-best-practices/SKILL.md` for React/Next.js interface and data-flow work.
- `.agents/skills/playwright-cli/SKILL.md` for browser verification.
- `.agents/skills/audit-context-building/SKILL.md`, `.agents/skills/sharp-edges/SKILL.md` or `.agents/skills/insecure-defaults/SKILL.md` only for a concrete unresolved concern; avoid broad audit loops.

Discover the MCP tools actually available in this CommandCode session. Use relevant documentation, browser or Supabase MCP capabilities when they help complete or verify the milestone. Confirm the target environment/project before data access. Prefer an existing CLI/API when it is the simpler route. Missing MCPs are not a reason to stop: use available local tools and official documentation. Never claim a skill, MCP or test was used unless it actually was. Do not install paid services or send secrets/customer data to a new service.

Use official provider documentation for unfamiliar Supabase, Razorpay and LiveKit contracts. Inspect the existing implementations before adding abstractions or dependencies. Use PowerShell-compatible commands, `rg` for targeted searches and compact logs.

## 3. Complete these milestones in order

Each milestone is a bounded change within this larger assignment. Before editing it, note affected files, invariants and checks. After its focused checks pass, checkpoint and continue automatically to the next milestone. Routine implementation choices do not require permission.

**A. Finish the current request flow.** Fix the two findings in the latest Muse review. A successful submission must enter a completed state; another click must not silently create another request. Provide an explicit new-request action when appropriate. Preserve the same idempotency key for retries of the same logical submission, including a lost response. Tie the pending request to its selected topic/language so later edits cannot silently replay an old request. Show the actual saved state and next available action. Preserve memory-only credentials and existing age/consent wording.

**B. Connect checkout and paid queue entry.** Wire the existing request, server-created Razorpay order and checkout contracts into the customer journey. Use the established pricing configuration. Handle cancelled/failed checkout, pending payment confirmation, refresh/re-entry and retry. A signed, validated webhook is authoritative for capture; a browser callback never grants entitlement. Order creation must be retry-safe, and a capture must bind to exactly the intended user's request without duplicate orders, ledger entries or entitlements. Read the relevant F07/R4 evidence in `docs/reviews/2026-09-06-glm-long-horizon-review.md`; fix applicable payment-binding gaps in this milestone. Matching must verify the captured payment's ownership and request binding, not merely a non-null link. Never queue an unpaid request as a shortcut.

**C. Finish listener availability and matching.** Provide usable listener sign-in/onboarding-status, availability and heartbeat controls, incoming offer, accept/decline and session navigation using the existing role model. Connect the customer's waiting screen to persisted state, including honest no-listener, timeout, decline/rematch, cancellation and recovery states. Do not invent wait-time claims. Retain eligibility-first deterministic matching, blocked-pair and stale-presence filters, and database guards against double reservations. Implement protected reads/subscriptions if needed without exposing contact details. Fix R2: failure after reservation acceptance must not strand the request; retry must recover to exactly one session, using the existing architecture and a transaction or a durable recovery design. Wire an actual expiry/maintenance entrypoint; document the required scheduler rather than claiming it is running when it is not.

**D. Connect real audio and session completion.** Inspect both existing audio components and reuse the real LiveKit integration. Drive connection and mute indicators from actual SDK state, not timers or simulated success. Provide microphone permission/error handling, user and listener joining the authorized room, mute, reconnect, timer, end and structured completion. Enforce session limits and end-state transitions on the server. Reconnect must not accidentally end a recoverable session, and repeated end requests must be safe. Tokens must be server-generated, short-lived, scoped to the exact room and authorized participant. No recording, egress, transcription or sensitive media storage. Show only encryption/privacy claims supported by the implementation and approved copy; flag unsupported existing claims for review.

**E. Finish post-session and basic account flows.** Wire structured rating, block, talk-again, purchase/session history and the existing privacy-request process. Ratings must be limited to the authorized completed session and be retry-safe; blocking must affect subsequent matching. Follow documented account-deletion/retention behavior. After the listener MVP is stable, wire the already-specified optional counsellor referral/booking flow using existing verified-provider data and contracts. If credentials, approved content or operational supply are absent, record the precise blocker and make the UI truthful. Do not build a new care platform or fabricate available professionals.

**F. Finish the minimum operational interfaces.** Implement the existing PRD's listener review/activation/suspension, live queue/session metadata, safety-case console, refund/reconciliation and payout-review interfaces under the existing role/MFA rules. Reuse implemented backend/domain logic; correct defects that prevent the documented operation. Wire in-session safety reporting, supervisor acknowledgement/resolution and audit records according to the existing SOP. Keep decisions human-controlled. Notification state must reflect actual dispatch evidence; creating a notification object is not proof of delivery. Test primary/backup dispatch through controlled local receivers when external access is missing. Refunds must reflect provider outcomes and authoritative eligibility, handle partial/repeated requests without over-refunding, and preserve the append-only ledger. Payouts require the existing human finance approval; never execute real money movement in verification. Keep dashboards small and based on actual records.

## 4. Stay within the approved product

Reuse the Next.js/Supabase/Razorpay/LiveKit stack and current domain/repository patterns. Prefer straightforward integration and additive changes. Avoid unrelated rewrites, new orchestration frameworks, broad formatting, speculative optimization and warning-count cleanup. Keep each patch focused; this assignment does not approve large generated refactors.

Preserve authentication, ownership, grants/RLS, privileged audit trails, append-only accounting and domain-controlled state transitions. Client identifiers, payment claims, timer values and role choices are not authority. Do not bypass tests, policies, constraints or types to make a flow pass. Add only justified dependencies and forward migrations; do not rewrite historical migrations or reset the shared database.

No AI in user support or safety decisions; no minors, recording, transcripts, social features or new sensitive free text. Preserve existing clinical/legal copy, retention rules, role permissions, vendor boundaries and payout mechanics. If completing a feature requires changing one of these, prepare the concrete proposal, record the human decision needed and continue independent work. Implementing documented screens and wiring existing approved behavior is in scope; redefining policy is not.

Do not commit, push, deploy, create paid infrastructure, send real SMS/email notifications or perform live financial transactions. Use local fixtures and explicitly identified existing test environments. Prepare deployment configuration and operator instructions for later review.

## 5. Verify enough to make the result usable

Do quick functional checks during implementation, then one integrated verification pass at the end. Fix defects that block the journey or violate an invariant before continuing. Keep cosmetic and speculative improvements in a short deferred list.

- Run the focused tests for each changed domain. For database/policy changes, include actual local DB tests and appropriate ALLOW/DENY cases. Test denial for a different user, listener PII restrictions and privileged roles where touched.
- Cover the affected money/matching failure cases: webhook replay/signature rejection, order/capture retries, declined/expired offers, concurrent reservation claims and acceptance recovery. Assert persisted outcomes, not just HTTP success codes. Isolate synthetic fixtures from other tests' eligible listener pools.
- At the end run `pnpm typecheck`, `pnpm lint`, `pnpm build` and `pnpm test --maxWorkers=2 --minWorkers=1` from the root. Inspect failures; do not weaken assertions or skip required suites to obtain green output. Diagnose pre-existing failures separately from regressions.
- Exercise the customer and listener journey in two isolated browser contexts: sign in → purchase → server-confirmed payment → queue → offer → accept → audio → finish → rate/block. Also exercise the operator screens and documented safety/refund paths. Verify persisted records and actual media behavior where available; visible success text alone is insufficient.
- Local Supabase previously ran at `127.0.0.1:54321` with a fixed test OTP. Verify the current local configuration before testing. Keep keys/tokens out of logs; do not silently fall back to a remote database or live SMS. Clean only your own synthetic fixtures and processes.
- If provider test credentials or a local RTC service are unavailable, finish the production integration and test its boundary with explicit synthetic fixtures. Label those checks as simulated. Do not put fake success, mock tokens or simulator fallbacks into production behavior. Real audio, real provider acceptance and operational delivery stay unverified until actually exercised.

## 6. Maintain progress and finish honestly

Keep `docs/execution/MUSE_MVP_RUN_STATE.md` concise and current: milestone, files changed, checks/results, blockers, next exact step. Update it after each milestone and before stopping; during longer milestones checkpoint about every 20 minutes. Send short progress updates every few minutes. Preserve context through checkpoints instead of restarting the project assessment.

Continue all unblocked milestones. If the same approach fails two or three times, inspect the specific failure and change approach. An unavailable external dependency should block its verification, not unrelated implementation. Do not stop merely after planning, generating screens or finishing the first milestone. If the runner's quota/time limit or a user pause stops you, leave the working tree and checkpoint ready to resume; never label a partial run complete. Record duration/usage/cost only if the runner exposes them; otherwise say unknown and respect the configured limit.

Produce `docs/reviews/muse-mvp-completion-result.md` with the repository's completion-report fields and a compact acceptance table. For each MVP criterion give: behavior, implementation location, verification performed, result and remaining dependency. Distinguish local verification, simulated provider checks, real external verification and required human approval. Update `CONTINUE_HERE.md` with the current checkpoint and next step while preserving historical reviews.

Completion target: the implemented user, listener and operator MVP journeys work together, required engineering checks pass, and remaining external/human prerequisites are explicit. Do not claim “100% complete” while required behavior, real audio/provider proof or PRD launch gates remain unmet. Report exactly what is complete and exactly what remains. Independent security review, clinical tabletop approval and production readiness cannot be self-certified by this implementation run.

Begin now and carry the implementation through all unblocked milestones.
