## Session completion, rating, block, and safety boundaries

**Purpose:** Server handlers provide post-session quality and human safety workflow primitives.

**Inputs & Assumptions:**
- End-session requires authentication and delegates the state change to `atomic_end_session` (`apps/web/src/app/api/sessions/[id]/end/route.ts:L10-L30`).
- Rating requires an authenticated session owner, ended session, valid stars/tags, and no existing rating (`apps/web/src/app/api/sessions/[id]/rating/route.ts:L11-L65`).
- Safety creation requires authentication and structured reason codes (`apps/web/src/app/api/safety-cases/route.ts:L8-L31`).

**Outputs & Effects:**
- End returns duration/end metadata (`end/route.ts:L33-L40`).
- Rating inserts one row, updates Bayesian quality, and optionally inserts a block (`rating/route.ts:L68-L140`).
- Safety repository creation returns case metadata; notification builder returns primary/dashboard and high-severity backup channels (`safety-cases/route.ts:L25-L58`; `packages/domain/src/safety/safety-manager.ts:L62-L85`).

**Cross-Function Dependencies:**
- Session repository fallback computes duration and journals balanced completion entries (`packages/db/src/repositories/session.repository.ts:L64-L125`).
- Safety reason severity mapping is deterministic and structured (`packages/domain/src/safety/safety-manager.ts:L24-L50`).

**Open Questions:**
- No inspected UI mounts rating, block, or safety controls. No inspected page submits the session end or counselling follow-on flow.
