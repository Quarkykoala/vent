## Matching, reservation, and session/audio boundary

**Purpose:** The domain and SQL provide the intended queue-to-audio handoff primitives.

**Inputs & Assumptions:**
- `findBestMatch` takes a request, candidate listener records, reciprocal block IDs, and clock (`packages/domain/src/matching/matcher.ts:L51-L56`).
- It assumes candidate presence/training/status/rating fields are current; it hard-filters these before scoring (`L63-L113`).
- `atomic_reserve_match` assumes a queued durable request and locked profile/presence rows (`supabase/migrations/20260903000002_atomic_matching_transactions.sql:L26-L66`).

**Outputs & Effects:**
- Pure matcher returns listener ID, rounded score, and components or null (`matcher.ts:L115-L134`).
- Atomic SQL inserts an offered reservation, marks presence reserved, and marks request reserved (`20260903000002_atomic_matching_transactions.sql:L102-L142`).
- Accept/decline endpoints delegate to locked state transitions (`apps/web/src/app/api/matches/[id]/accept/route.ts:L24-L31`; decline `L35-L44`).
- Token route derives participant role from the session row and issues a short-lived exact-room token (`apps/web/src/app/api/sessions/[id]/token/route.ts:L15-L90`).

**Cross-Function Dependencies:**
- Reservation expiry job calls repository lookup then expiry RPC for offered expired reservations (`trigger/jobs/reservation-expiry.ts:L11-L30`).
- `AudioCallRoom` consumes a token/url and connects through `useLiveKitRoom` (`apps/web/src/features/audio/AudioCallRoom.tsx:L20-L37`).

**Open Questions:**
- No inspected coordinator creates the candidate list, calls the matcher, creates a session after acceptance, or mounts the audio room in a page.
