# GLM Run State — Vent completion mission

**Last updated:** 2026-09-05, run-1 start
**Branch:** `hardening/real-mvp-vertical-slice` · **HEAD:** `d3ca22b`
**Model boundary:** GLM 5.3 Flash Max per mission. No Pioneer routes or subagent delegation used.

## Environment (verified run-1)

- node v24.11.1, pnpm 11.25.0, Docker Desktop 29.7.2 (Linux engine was DOWN at session start; started via `Docker Desktop.exe` — remedy succeeded).
- Local Supabase stack `*_vent` (project id `vent`) auto-started with Docker: Kong 54321, PG 54322, Studio 54323, Inbucket 54324. Loopback only. This is the explicitly identified disposable local test environment.
- Supabase CLI available via `npx --yes supabase` (2.116.0). Not on global PATH.
- **Do not start Docker Desktop engine shutdown while run state references the stack.**

## Baseline evidence (run-1)

- `pnpm typecheck` PASS (4 packages).
- Package tests: domain 80 PASS, validation 14 PASS, db 5 PASS.
- Web tests: **154 PASS / 0 failed / 24 files** — live-DB suites passed against local stack (prior review's setup failures did not reproduce; stack was up).
- `pnpm build` PASS (log: run-1/baseline-build.log).
- Logs: `logs/agent-runs/glm-completion/run-1/`.

## Working tree policy

Preserve uncommitted work: F03 webhook route fix + `webhook-route-security.test.ts` + docs/. No resets, no checkout overwrites, no commits (mission forbids commits).

## Decisions log

1. Durable records at `docs/execution/GLM_COMPLETION_MATRIX.md` (frozen inventory) + this file + `logs/agent-runs/glm-completion/<run-id>/`.
2. Package order follows backlog phases: **Phase 0 first** (P0.1b independent lint; P0.3a fresh-DB migration proof; then F01 DB authority), then F03 64-hex gap, then F02 vertical flow.
3. Independent lint: ESLint + typescript-eslint flat config (mission A explicitly authorizes a justified dependency; current lint duplicates typecheck).
4. F01 implementation via additive migration(s) only; repair through new migrations; never edit merged migrations.

## Current package

**WP-9 (F07): payment entitlement binding.** Plan: (a) order creation idempotency — retries with the same request return the existing order/payment instead of creating new provider orders; reject order creation when request state is not 'created'; do not ignore the request-link update failure; (b) capture binding — narrow the atomic capture RPC's Step 7 to transition exactly ONE queued request (the oldest by created_at with matching payment link or null), not all of the user's created/paid requests; add DB-level test proving one capture cannot queue multiple requests.

## Completed packages (run-1 + continuation)

- **WP-1 (P0.1b)**, **WP-2 (P0.3a/b)**, **WP-3 (F01.1–F01.4)**, **WP-4 (P3.2b/F03)**, **WP-5a (P4.1a)**, **WP-6 (P2.2a/b)** — VERIFIED_LOCAL (details in prior snapshots and matrix).
- **WP-7 (P4.1b, P4.2a-b, P4.3b-c) VERIFIED_LOCAL:** MatchingCoordinator (eligibility query, deterministic findBestMatch, score components persisted, atomic reserve RPC; lazy expiry) + owner-authenticated match route + ops reservation-expiry route (idempotent, verified rerun) + accept route creates session idempotently and transitions accepted→connected. 9 live-DB tests: concurrent claims (exactly one winner), decline→rematch, timeout→rematch, blocked pair, not_entitled, ownership 403, duplicate accept rejected.
- **WP-8 (P1.1c/F08) VERIFIED_LOCAL:** migration 20260905000002 (age evidence nullable); token provisioning writes no timestamp; support-request creation gated on evidence; 3 live-DB tests. analytics-erasure suite de-flaked (own listener fixture instead of borrowing shared rows).

## Next actions (exact)

1. WP-9 F07 (see Current package): read `apps/web/src/app/api/payments/orders/route.ts` and `supabase/migrations/20260903000003_atomic_payment_capture.sql` Step 7; write failing tests first (order retry idempotency; one-capture-one-request); implement via additive migration + route fix; full gate.
2. WP-10 F05 refunds (authoritative duration/eligibility + provider-refund binding states).
3. WP-11 F04 safety dispatch (real adapters + supervisor console) and F06 session cap.

## Verification status snapshot (post WP-8)

- `pnpm test`: **297 passed / 0 failed / 0 skipped** (domain 80, validation 14, db 5, web 198)
- `pnpm typecheck`: PASS · `pnpm lint`: 0 errors / 477 warnings · `pnpm build`: PASS
- Fresh DB: migration chain 11/11 applied (incl. authority lockdown + age nullability).
- NOTE: `next build` now runs the ESLint gate — lint errors fail the build.

## External dependencies / blockers

- LiveKit Cloud credentials (P5.2b), Razorpay sandbox credentials (F05.2 sandbox lane), hosted CI run (P0.1c) — recorded, not blocking Phase 0 work.
- Human approvals: clinical/legal/finance lanes per matrix.

## Resume command

```
cd C:\Users\lenovo\projects\vent
# Read this file + GLM_COMPLETION_MATRIX.md, then `git status --porcelain` before editing.
pnpm --filter @vent/web test tests/webhook-route-security.test.ts --maxWorkers=2 --minWorkers=1
```
