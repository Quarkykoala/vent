# Venterr MVP context dossier

Scope: landing/onboarding/payment/queue/listener/audio/rating. This is a context map of the current checkout, source wiring, and documented intent. It records implementation and open questions without assigning findings or severity.

## Repository shape

- `apps/web` is a Next.js app. The only browser pages are `/` and `/crisis` (`apps/web/src/app/page.tsx:6`, `apps/web/src/app/crisis/page.tsx:9`). API route handlers cover auth, payments, support requests, matches, presence, sessions, ratings, safety, finance, counselling, analytics, and privacy (`apps/web/src/app/api/**`).
- `packages/domain` contains enums/state machines, matching/scoring, audio-token claims, safety, ledger, pricing, and counselling logic. `packages/db` contains Supabase repositories and typed database definitions.
- Supabase migrations define users, listener profiles/presence, support requests, reservations, sessions, ratings, blocks, payments, ledger, safety, audit, and idempotency tables (`supabase/migrations/20260902000001_core_schema.sql:7-219`). Later migrations add atomic RPCs and hardening.
- The only Trigger job present is reservation expiry (`trigger/jobs/reservation-expiry.ts:11-30`). No queue worker or visible route-to-job dispatcher was found.

## Actual browser-to-domain flow

1. Landing page collects topic, language, age checkbox, and displays a fixed price/duration (`apps/web/src/app/page.tsx:6-14`, `65-146`). Submit calls `POST /api/support-requests` with a newly generated idempotency key (`page.tsx:15-35`). It renders the returned request ID and a checkout message, but does not call `/api/auth/*` or `/api/payments/orders` (`page.tsx:37-47`).
2. `POST /api/support-requests` validates the payload and returns an in-memory UUID-shaped response with state `created`; it does not authenticate, persist a row, charge, queue, or invoke matching (`apps/web/src/app/api/support-requests/route.ts:5-30`).
3. Auth has OTP send/verify handlers backed by the Supabase service (`apps/web/src/app/api/auth/otp/send/route.ts:5-23`, `apps/web/src/app/api/auth/otp/verify/route.ts:5-37`; `apps/web/src/features/auth/supabase-auth-service.ts:15-29`, `39-105`). Authenticated API routes derive identity from a Bearer token (`apps/web/src/features/auth/auth-guard.ts:21-37`). No page invokes the auth flow.
4. Payment order creation is a separate authenticated endpoint. It validates request ownership, derives amount from `DEFAULT_PRICING`, creates a Razorpay order or explicit test-simulator order, persists a payment, and links it to the request (`apps/web/src/app/api/payments/orders/route.ts:8-41`, `47-114`). Webhook routes pass raw body/signature to the processor (`apps/web/src/app/api/webhooks/razorpay/route.ts:4-21`, `apps/web/src/app/api/payments/webhook/route.ts:4-14`). The processor validates HMAC, parses captured payment, checks INR/positive amount, and calls an atomic repository RPC (`apps/web/src/features/payments/payment-processor.ts:63-167`; `packages/db/src/repositories/payment.repository.ts:81-115`).
5. Domain matching is implemented as pure hard filtering plus deterministic score (`packages/domain/src/matching/matcher.ts:51-135`; weights in `packages/domain/src/matching/scoring.ts:3-76`). Repository reservation calls `atomic_reserve_match` (`packages/db/src/repositories/matching.repository.ts:14-43`), whose SQL locks request/profile/presence rows, checks queue state, fresh heartbeat, reciprocal blocks, language/topic, active reservations, then writes reservation and state changes (`supabase/migrations/20260903000002_atomic_matching_transactions.sql:26-142`). No route or worker in the inspected tree calls `findBestMatch` and then `createReservation`.
6. Listener offer endpoints require authenticated listener role and route accept/decline through atomic repository RPCs (`apps/web/src/app/api/matches/[id]/accept/route.ts:11-31`, `apps/web/src/app/api/matches/[id]/decline/route.ts:12-43`). Presence toggle and heartbeat handlers only validate and echo payloads; no authentication or repository write is present (`apps/web/src/app/api/listeners/presence/toggle/route.ts:4-20`, `heartbeat/route.ts:4-17`).
7. Session token generation authenticates, loads the session, checks participant identity, rejects terminal states, and creates a short-lived room token bound to `room_name` (`apps/web/src/app/api/sessions/[id]/token/route.ts:10-90`). Token claims use opaque role/session aliases and prohibit recording/data publication (`packages/domain/src/audio/livekit-token.ts:20-59`, `87-120`). `AudioCallRoom` connects through LiveKit and exposes mute/end controls (`apps/web/src/features/audio/AudioCallRoom.tsx:20-37`, `74-96`); `AudioCallInterface` is a presentational timer/control component (`apps/web/src/features/sessions/AudioCallInterface.tsx:15-49`, `52-128`). No page wires either audio component.
8. Session ending uses the `atomic_end_session` RPC and returns duration/end metadata (`apps/web/src/app/api/sessions/[id]/end/route.ts:10-40`). The repository fallback implementation reads session, transitions to ended, updates session/request, and writes a balanced ledger journal (`packages/db/src/repositories/session.repository.ts:64-125`).
9. Rating requires authentication, validates tags/stars, confirms the session belongs to the caller and is ended, rejects an existing rating, inserts the rating, recalculates Bayesian quality, and optionally inserts a user-to-listener block (`apps/web/src/app/api/sessions/[id]/rating/route.ts:11-140`). No rating page or caller was found.

## Documented intent versus current wiring

The PRD describes a continuous flow from landing → age/boundary → topic/language → auth → payment → support request → match → audio → rating (`PRD.md:86-117`). Current browser wiring stops after the unauthenticated in-memory support-request response. Payment, matching, listener, audio, and rating are implemented as independently reachable server/domain surfaces, without an inspected page or orchestrator joining them.

The database schema and RLS migration establish the intended entities and participant policies (`supabase/migrations/20260902000001_core_schema.sql:51-147`, `supabase/migrations/20260902000002_rls_policies.sql:46-151`). The atomic matching SQL establishes the intended reservation transaction (`20260903000002_atomic_matching_transactions.sql:26-142`). The current app has no listener dashboard/page, queue page, session route/page, rating page, admin console, or counselling UI under `apps/web/src/app`.

## Flow boundaries and assumptions

- Landing assumes the caller can proceed without an authenticated session; the support-request handler does not establish identity or durable state (`page.tsx:15-35`; `support-requests/route.ts:5-30`).
- Payment order assumes a durable support-request row exists and belongs to the authenticated user (`payments/orders/route.ts:25-37`). The current support-request handler establishes neither.
- Matching RPC assumes a queued request and listener presence/profile rows exist, with the matcher supplying candidate data and score components (`atomic_matching_transactions.sql:26-124`). No inspected caller establishes the queue transition or candidate acquisition.
- Accept/decline assumes listener authentication and a listener profile mapped to the session (`matches/*:11-25`). Presence handlers establish neither authenticated ownership nor persistence (`presence/*:4-20`).
- Session token assumes a durable session with participant IDs and exact room name. The route establishes participant role from database identity (`sessions/[id]/token/route.ts:15-57`). No inspected route creates a session from an accepted reservation.
- Rating assumes an ended session and the session's listener ID; the route establishes both before insert (`sessions/[id]/rating/route.ts:27-79`). No browser surface reaches it.
- Safety case creation assumes an authenticated caller and a durable session; repository creation is described as atomic, while alert construction returns delivered channel records (`safety-cases/route.ts:8-58`). No active-session page wires the safety control.

## Omitted/unwired surfaces

- No browser OTP onboarding, authenticated session persistence, checkout UI, payment callback, queue status, match offer display, listener availability UI, session join page, end-session transition UI, rating/block form, or counselling offer/booking page was found.
- No inspected queue coordinator invokes domain matching, creates sessions after acceptance, schedules reservation expiry, or rematches after decline/expiry.
- Presence toggle/heartbeat are response-only handlers; no inspected code persists listener availability.
- `trigger/jobs/reservation-expiry.ts` can expire a known reservation when called, but its trigger registration/dispatcher was not found.
- Crisis resources are always visible through the layout banner and `/crisis` page (`apps/web/src/app/layout.tsx:19-27`; `crisis/page.tsx:9-89`). The page includes a hard-coded “last verified” statement and four resources; no configurable source or verification job was found.

## Open questions

- What runtime invokes `POST /api/support-requests` with an authenticated user and converts the response to a persisted, paid, queued request?
- What component selects candidates, calls `findBestMatch`, creates reservations, and dispatches `runReservationExpiryJob`?
- What creates `sessions` and moves support requests from accepted to connected/active?
- Which concrete browser route will own listener queue controls, user queue state, audio join, session end, rating, block, and counselling transitions?
- Are any deployment-only routes, middleware, or external Trigger.dev registrations outside this repository responsible for the missing joins?
- Which clinical/operations owner maintains the crisis resource list and its last-verified value?
