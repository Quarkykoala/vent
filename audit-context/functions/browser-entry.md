## `HomePage.handleStartSession` in apps/web/src/app/page.tsx (L15-L50)

**Purpose:** Collects the initial topic/language/age choice and starts the user flow from the landing page.

**Inputs & Assumptions:**
- Form event: trusted browser event.
- Component state: selected topic/language and age checkbox (`L7-L11`). Topic/language options come from domain constants (`L4`, `L75-L101`).
- Age confirmation must be true; this function checks it locally (`L17-L20`). Server handler behavior is a separate dependency.

**Outputs & Effects:**
- POSTs JSON to `/api/support-requests` with a random idempotency key (`L26-L35`).
- Shows returned request ID and price text or an error (`L37-L49`). It does not invoke auth, payment order creation, queue, matching, or navigation.

**Cross-Function Dependencies:**
- `POST /api/support-requests` validates input but returns an in-memory response only (`apps/web/src/app/api/support-requests/route.ts:L5-L30`).
- `DEFAULT_PRICING` supplies display amount/duration (`L4`, `L13`, `L106-L116`).

**Open Questions:**
- No inspected caller establishes the authenticated user, durable request, or next checkout step.
