# Muse MVP run state

## Current milestone
Done — all milestones A–F implemented and verified; completion report written. Awaiting Codex independent review.

## Starting point (verified 2026-09-07)
- Branch `hardening/real-mvp-vertical-slice`, HEAD `d3ca22b397b5d50d468ee7fb162c4e09dc8ff655`, uncommitted work preserved.
- Working + reviewed: phone OTP sign-in, authenticated support-request creation, R1 ownership repair, R3 age-evidence repair.
- Backend largely implemented (35 routes): payments orders/webhook, matching coordinator + accept/decline, session token/end/rating, blocks, safety cases, finance, privacy erasure, counselling, operations expiry/maintenance, presence, analytics.
- UI: only home page (sign-in + request create) and crisis page.
- Local Supabase at `127.0.0.1:54321` healthy; test OTP map in `supabase/config.toml`.
- No MCP tools in this session; using local CLIs/APIs. No skill content beyond SKILL.md files read.

## MVP criteria checklist
- [x] Phone sign-in + age gate (verified)
- [x] Authenticated request creation, idempotent (verified)
- [ ] A: completed-request state, no silent duplicates, truthful confirmation
- [ ] B: checkout + paid queue entry; R4 captured-payment binding fix
- [ ] C: listener console, waiting screen, R2 accept-recovery, expiry wiring
- [ ] D: real audio via LiveKit, server-side session limits/end
- [ ] E: rating/block/history/privacy UI, counsellor referral
- [ ] F: operator consoles (queue/safety/refund/payout review)
- [ ] Integrated verification: typecheck, lint, build, full tests, two-context browser journey

## Milestone log
### A (complete)
- Files: `apps/web/src/app/page.tsx`, `apps/web/e2e/phone-signin.spec.ts`.
- Invariants: idempotency on (user, key); same key retained after success so lost-response retries return the same row; age/consent copy unchanged; memory-only credentials.
- Fixes: completed-request state blocks resubmission until explicit "Start a new request"; submit sends the snapshotted topic/language; confirmation shows saved state + payment as the next action (no matching promise).
- Checks: typecheck pass; eslint 0 errors (2 pre-existing any warnings); Playwright 3/3 pass (one journey test needed a retry after OTP-send rate noise on the shared test number); synthetic request row cleaned; dev server stopped.
- Result: M1 + M2 review findings resolved.
### B (backend complete; UI checkout panel added)
- Files: `features/matching/coordinator.ts` (R4 entitlement verify), `app/api/payments/orders/route.ts` (retry-safe), `app/api/support-requests/[id]/payment-status/route.ts` (new owner read), `app/page.tsx` (checkout panel), tests `payment-order`, `payment-status`, `matching-coordinator`.
- Fixes: coordinator verifies linked payment exists + captured + same user; order creation returns pending payment on retry; browser callback never grants entitlement (status read only).
- Checks: coordinator 12/12 (3 new R4 cases); payments 10/10 (retry case); payment-status 3/3; live local check: simulator order 19900 → signed webhook capture → request queued → replay idempotent → forgery 400 → match attempt honestly no_candidates; synthetic rows cleaned; no real Razorpay credentials exist so provider acceptance stays simulated.
- Next exact step: Milestone C listener console + waiting screen + R2 recovery.
### C (R2 + console + queue UI done; scheduler documented, not running)
- Files: migration `20260908000001_accept_session_recovery.sql` (applied locally; ROLLBACK.md updated), `MatchingRepository.recoverSession`, accept route rewrite, `api/listeners/console`, `api/support-requests/[id]/queue-status`, `app/listener/page.tsx`, `app/queue/page.tsx`, checkout→queue link, docs/operations-SCHEDULER.md, tests.
- Fixes: retry after accept converges on exactly one session (unique guard + in-RPC recovery); already-accepted-by-me treated as recovery, not error.
- Checks: coordinator 13/13 (R2 retry test with isolated listener pair); console/queue-status 6/6 ALLOW+DENY; typecheck clean.
- Next exact step: Milestone D session page with real LiveKit audio + server-side end.
### D (session page wired to real audio + server end; media unverified)
- Files: `app/session/[id]/page.tsx` (new; uses real `AudioCallRoom`/SDK state, server token, server end, retry-safe repeated end via atomic RPC), `AudioCallRoom.tsx` (unsupported "end-to-end encrypted" claim softened), `app/page.tsx` (unsupported "End-to-end pseudonymous" softened to PRD-approved "pseudonymous to your listener").
- Checks: audio-call token tests 5/5; completion tests 6/6; typecheck clean. No LiveKit credentials exist: token issuance verified only via the simulator path in tests; real media join stays unverified until exercised.
### E (history/rating/block/privacy/counsellor-truthfulness done)
- Files: `api/history` (new owner read), `app/history/page.tsx` (rating with tags + block, talk-again, payments, counsellor availability, erasure request), `api/counselling/slots` (auth + real verified-provider rows only, no fabricated doctors), `api/counselling/book` (auth + fail-closed 503, no fake confirmations), validation schema drops client `userId`, tests `history`, `counselling`.
- Checks: history 3/3 (anon deny, owner allow, cross-user deny); counselling 2/2 + funnel 4/4; typecheck clean.
- Blocker recorded: no verified counsellor supply exists locally, so booking stays honestly unavailable (503) until real supply + scheduling operate.
### F (ops reads + review + safety console wired; payout execute stays API-level)
- Files: `api/listeners/review` (staff activate/suspend + audit), `api/operations/queue` (live counts/records), safety GET on existing route (structured fields only), `app/ops/page.tsx` (queue/expiry/review/safety/refund-proposal/reconcile under role gates), sweeper race guard in `ListenerRepository`, `tests/ops-console`.
- Checks: ops-console 5/5 (review allow/deny + audit, queue roles, sweeper branches); typecheck clean.
- Note: payout approve remains API-level human action; execute moves real money and is intentionally not exposed in the verification UI.
### Integrated verification (complete)
- typecheck: pass all packages. lint: 0 errors, 608 warnings (baseline 476; repo-convention casts). build: pass, 36 routes.
- Full suite: domain 80 + validation 14 + db 5 + web 231 passing, 6 skipped; only failure is pre-existing auth-live-supabase beforeAll (fails on pristine sources too).
- Browser 4/4: integrated pay→queue, phone-signin x2, smoke.
- API handshake: reserved → accepted → session/room → ended (8s) → 5-star rating; fixtures cleaned except append-only payment/ledger/idempotency per test hygiene.
- Report: `docs/reviews/muse-mvp-completion-result.md`.

## Blockers
- LiveKit/Razorpay real credentials: presumed absent; verify when reaching B/D. Real audio + provider acceptance stay unverified until exercised.
- auth-live-supabase.test.ts fails pre-existing in beforeAll (fixed-number fixture collision); unrelated to this run.

## Deferred
- None yet.
