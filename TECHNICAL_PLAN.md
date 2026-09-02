# Technical Plan — Mental Health Funnel Marketplace

## 1. Architecture goals

Priorities in order:

1. Safety.
2. Privacy/data minimization.
3. Correctness of money and session state.
4. Reliability of matching/audio.
5. Operational simplicity.
6. Speed of iteration.
7. Cost.
8. Scale.

Do not invert this list.

---

## 2. Recommended architecture

```text
Browser / PWA
   |
   | HTTPS
   v
Next.js App
   |---- Supabase Auth
   |---- Server Actions / API routes
   |---- Postgres (Supabase)
   |---- Trigger.dev jobs
   |---- Razorpay
   |---- LiveKit
   |---- Transactional notification providers
   |---- Sentry
   `---- Privacy-minimized analytics
```

### Why a modular monolith

Use one application repository and one Postgres database.

Do not begin with microservices.

The domain has complexity in **state transitions and safety**, not independent scaling domains. A modular monolith provides:
- atomic DB transactions
- easier observability
- fewer distributed failure modes
- simpler agent-driven development
- cheaper operations

Extract services only when a measured constraint exists.

---

## 3. Suggested repo layout

```text
/apps
  /web
    /app
    /components
    /features
      /auth
      /payments
      /matching
      /sessions
      /listeners
      /counselling
      /safety
      /admin
/packages
  /db
  /domain
  /validation
  /observability
  /ui
  /config
  /test-utils
/supabase
  /migrations
  /tests
/trigger
  /jobs
/docs
  PRD.md
  TECHNICAL_PLAN.md
  SOP.md
  SECURITY_SAFETY.md
AGENTS.md
```

Rules:
- domain transitions live in `/packages/domain`
- no payment state transitions from UI components
- no direct service-role DB access from browser
- every privileged mutation passes through server-side authorization

---

## 4. Technology decisions

### Web — Next.js + TypeScript
Why:
- single codebase
- SSR/SEO for acquisition pages
- responsive app
- mature ecosystem
- good agent support

### Database/Auth — Supabase Postgres
Why:
- relational model fits payments, sessions, matching, audit logs
- Postgres transactions and locks
- RLS for defense in depth
- managed backups
- Auth integration

Supabase documentation explicitly recommends enabling RLS and matching grants/policies on exposed tables; service-role/secret credentials must remain server-side.

### Audio — LiveKit
Use LiveKit Cloud initially.

Why:
- open-source WebRTC SFU
- can later self-host
- handles signalling, NAT traversal, RTP, QoS
- browser audio avoids exposing personal phone numbers

Self-hosting LiveKit means operating TLS, UDP, TURN, public IP/load balancing and potentially multi-region network infrastructure. That is unnecessary MVP complexity.

### PSTN fallback — Exotel
Use only when browser audio is insufficient.

Number masking is useful operationally, but remember the telecom provider may retain underlying numbers/logs. “Anonymous” therefore means anonymous to the counterpart, not necessarily to infrastructure providers.

### Jobs — Trigger.dev
Use for:
- match timeout
- reservation expiry
- payout batch generation
- notification retry
- deletion workflow
- reconciliation
- reminder delivery

Why:
- durable long-running tasks
- queues
- retries
- idempotency
- open-source/self-hostable

Do not adopt Temporal in MVP unless workflows become materially more complex. Temporal is excellent durable-execution infrastructure, but adds operational/conceptual weight.

### Payments — Razorpay Checkout
MVP:
- platform collects payment
- internal ledger records platform/listener liabilities
- finance approves weekly payouts

Do not depend on Razorpay Route for launch. Route supports linked-account split settlements, but marketplace/payment-aggregator onboarding and eligibility can add friction. Integrate it after the business qualifies and finance/legal validate the flow.

### Analytics
Capture events, not intimate content.

Allowed:
- `topic_selected=relationship`
- `queue_entered`
- `match_latency_ms`
- `session_duration_bucket`
- `rating`
- `counselling_offer_clicked`

Forbidden:
- transcript
- raw user vent text
- audio
- crisis narrative in analytics
- phone/email in analytics properties

Disable session replay on all authenticated/support/payment/safety pages. Prefer no replay at all in MVP.

### Error tracking
Sentry or equivalent with:
- sendDefaultPii=false
- request body scrubbing
- header/cookie scrubbing
- no audio token logging
- no OTP logging
- no payment secrets
- no safety-note bodies

---

## 5. Core domain model

### `users`
```sql
id uuid pk
auth_user_id uuid unique
handle text unique
age_verified_at timestamptz
status enum(active, suspended, deletion_pending, deleted)
created_at timestamptz
```

Do not duplicate phone/email from auth unless needed.

### `listener_profiles`
```sql
id uuid pk
user_id uuid unique
display_name text
status enum(applicant, training, active, paused, suspended, rejected)
tier enum(listener, counsellor)
languages text[]
topics text[]
verified_at timestamptz
training_expires_at timestamptz
quality_prior numeric
created_at timestamptz
```

### `listener_presence`
Ephemeral-ish database record:
```sql
listener_id uuid pk
state enum(offline, available, reserved, in_session)
heartbeat_at timestamptz
available_since timestamptz
current_reservation_id uuid null
version bigint
```

### `support_requests`
```sql
id uuid pk
user_id uuid
topic text
language text
service_tier text
state request_state
payment_order_id uuid
created_at timestamptz
queued_at timestamptz
matched_at timestamptz
expires_at timestamptz
idempotency_key text unique
```

### `match_reservations`
```sql
id uuid pk
request_id uuid unique
listener_id uuid
state enum(offered, accepted, declined, expired, cancelled)
score numeric
score_components jsonb
offered_at timestamptz
expires_at timestamptz
accepted_at timestamptz
```

Persist score components for debugging/fairness.

### `sessions`
```sql
id uuid pk
request_id uuid unique
user_id uuid
listener_id uuid
state enum(created, connecting, active, ended, failed, safety_ended)
room_name text unique
started_at timestamptz
ended_at timestamptz
duration_seconds int
end_reason text
```

Never store audio.

### `ratings`
```sql
id uuid pk
session_id uuid unique
user_id uuid
listener_id uuid
stars smallint check (stars between 1 and 5)
reason_tags text[]
created_at timestamptz
```

### `blocks`
Unique pair:
```sql
blocker_id uuid
blocked_id uuid
reason_code text null
created_at timestamptz
unique(blocker_id, blocked_id)
```

### `payments`
```sql
id uuid pk
user_id uuid
provider text
provider_order_id text unique
provider_payment_id text unique null
amount_paise bigint
currency char(3)
state enum(created, authorized, captured, failed, refunded, partially_refunded)
created_at timestamptz
captured_at timestamptz
```

### `ledger_entries`
Double-entry-inspired immutable operational ledger:
```sql
id uuid pk
event_id uuid
account_code text
direction enum(debit, credit)
amount_paise bigint
currency char(3)
reference_type text
reference_id uuid
created_at timestamptz
```

Enforce balanced journal per event.

### `listener_earnings`
Can be a view/materialized projection of ledger, not mutable source of truth.

### `safety_cases`
```sql
id uuid pk
session_id uuid
opened_by uuid
severity enum(review, urgent, emergency)
state enum(open, acknowledged, escalated, resolved)
reason_codes text[]
supervisor_id uuid null
opened_at timestamptz
acknowledged_at timestamptz null
resolved_at timestamptz null
resolution_code text null
```

Free text should be strongly limited and access-restricted.

### `audit_events`
Append-only:
```sql
id bigserial pk
actor_id uuid null
actor_role text
action text
entity_type text
entity_id uuid
metadata jsonb
ip_hash text null
created_at timestamptz
```

No secrets or transcript-like content.

---

## 6. State machines

### Support request
```text
CREATED
  -> PAID
  -> QUEUED
  -> RESERVED
  -> ACCEPTED
  -> CONNECTED
  -> COMPLETED
```

Failures:
```text
CREATED -> PAYMENT_FAILED
PAID/QUEUED -> CANCELLED
QUEUED -> EXPIRED
RESERVED -> DECLINED -> QUEUED
RESERVED -> OFFER_EXPIRED -> QUEUED
ACCEPTED -> TECHNICAL_FAILED
CONNECTED -> SAFETY_ESCALATED
```

Transitions occur through domain functions only:

```ts
transitionRequest({
  requestId,
  expectedState: "queued",
  nextState: "reserved",
  actor,
  idempotencyKey,
})
```

Use optimistic version or `WHERE state = expected_state`; require exactly one updated row.

---

## 7. Matching algorithm

### 7.1 Hard-filter query

Conceptually:

```sql
SELECT lp.id
FROM listener_profiles lp
JOIN listener_presence p ON p.listener_id = lp.id
WHERE lp.status = 'active'
  AND lp.training_expires_at > now()
  AND p.state = 'available'
  AND p.heartbeat_at > now() - interval '30 seconds'
  AND :language = ANY(lp.languages)
  AND :topic = ANY(lp.topics)
  AND NOT EXISTS (blocked pair)
ORDER BY ...
LIMIT 20;
```

### 7.2 Score

```ts
score =
  0.30 * languageScore +
  0.25 * topicScore +
  0.15 * waitFairness +
  0.15 * bayesianQuality +
  0.10 * repeatAffinity +
  0.05 * loadBalance;
```

MVP language/topic scores can be binary.

### 7.3 Reservation transaction

```text
BEGIN

1. lock support_request if state = QUEUED
2. choose candidate
3. lock listener_presence FOR UPDATE SKIP LOCKED
4. re-check availability + block constraints
5. insert match_reservation
6. set listener_presence = RESERVED
7. set support_request = RESERVED

COMMIT
```

On listener decline/timeout:
- reservation → declined/expired
- listener → available
- request → queued
- increment attempt count
- schedule immediate rematch with jitter

### 7.4 Idempotency
Every external or retryable operation requires deterministic key:
- payment webhook: provider event ID
- create request: user + client-generated UUID
- reservation expiry: reservation ID + action
- payout: ledger period + listener ID
- refund: payment ID + refund request UUID

Idempotency table:
```sql
key text pk
operation text
response jsonb
created_at timestamptz
```

---

## 8. Audio architecture

### Flow
1. Reservation accepted.
2. Backend creates opaque `room_name`.
3. Backend returns short-lived token scoped to:
   - exact room
   - publish audio
   - subscribe audio
   - no admin permission
4. User/listener join.
5. Server records connection events, not media.
6. Room auto-closes after configured grace.

### Rules
- audio only
- disable recording/egress
- disable participant identity metadata beyond random session alias
- tokens expire quickly
- room name unpredictable
- user and listener never receive each other's internal IDs
- no permanent LiveKit room credentials in client

### Network fallback
- standard WebRTC
- TURN/TLS if needed via provider
- if failure persists, offer Exotel/PSTN fallback only after explicit consent

---

## 9. Payments and ledger

### Payment flow
```text
client -> create order
server -> Razorpay order
client -> checkout
Razorpay -> webhook
server -> verify signature
server -> idempotently mark captured
server -> post balanced ledger event
server -> unlock session purchase
```

Never trust:
- browser “success” callback
- amount from client
- listener ID from client
- refund amount from UI without server calculation

### Suggested accounts
- Cash/PG clearing
- Customer service revenue
- Listener payable
- Payment processing expense
- Refund liability
- GST/tax accounts per accountant

### Refund
Refund is a new ledger event.
Never delete/edit captured payment.

### Listener payout
MVP:
- weekly
- only completed, non-disputed sessions older than hold window
- generate payout proposal
- finance reviews
- execute payout
- attach provider/bank reference
- ledger payable decreases

Do not let an automated agent initiate money movement without human approval during MVP.

---

## 10. Jobs

Trigger.dev jobs:

### `reservation-expiry`
- input reservation ID
- idempotent
- if still `offered` after expiry:
  - expire reservation
  - release listener
  - requeue request

### `stale-presence-sweeper`
Every minute:
- mark listeners offline if heartbeat TTL exceeded and not in active session
- never terminate active session solely from presence heartbeat

### `payment-reconcile`
Daily:
- compare provider captured/refunded transactions with local records
- produce discrepancy report
- no automatic destructive fix

### `session-reconcile`
- detect accepted but never connected
- detect connected without end event
- close after safe grace
- flag for support

### `payout-proposal`
- compute eligible listener earnings
- output review batch

### `deletion-workflow`
- freeze account
- determine legally-required retained records
- delete/anonymize optional data
- revoke auth
- emit audit event

---

## 11. API surface

Use REST-like server endpoints or server actions with explicit schemas.

Examples:
```text
POST /api/support-requests
POST /api/support-requests/:id/cancel
POST /api/matches/:id/accept
POST /api/matches/:id/decline
POST /api/sessions/:id/token
POST /api/sessions/:id/end
POST /api/sessions/:id/rating
POST /api/safety-cases
POST /api/payments/orders
POST /api/webhooks/razorpay
POST /api/privacy/delete-request
```

Every endpoint:
- auth
- role check
- Zod/typed validation
- rate limit
- idempotency where relevant
- domain transition
- audit event for privileged action

---

## 12. Authorization/RLS

RLS is defense in depth, not the only authorization.

Examples:

### User
Can select:
- own profile
- own requests
- own sessions
- own payments
- own ratings

Cannot select:
- listener legal identity
- listener KYC
- other user/session
- safety case internal notes

### Listener
Can select:
- own profile
- reservations explicitly assigned to them
- limited session metadata for current/previous assigned sessions
- own earnings

Cannot select:
- user's phone/email
- payment instrument
- other listener earnings
- unrelated safety cases

### Admin
Use server-side privileged API, not a browser-exposed service role key.

Write SQL tests for both ALLOW and DENY behavior.

---

## 13. Privacy design

Collect minimum viable data.

### User
Need:
- phone/email for authentication (platform only)
- 18+ confirmation
- topic
- language
- payment record
- session operational metadata

Do not need:
- legal name for listener product
- DOB
- address
- gender unless a concrete feature requires it
- exact location
- contact list
- microphone recordings
- diagnosis
- therapy notes

### Listener
May require:
- legal identity
- KYC
- qualifications
- payout details
- background/training records

Store listener private/KYC data in restricted schema/bucket.

### Retention
Create a table-driven retention policy:
```text
data_class | purpose | retention | deletion_method | legal_basis | owner
```

Do not invent legal retention periods. Counsel/finance/clinical leads approve them.

---

## 14. DPDP readiness

As of the 2025 rules, implementation is phased; several substantive rules have an 18-month commencement period from Gazette publication. Build to the stricter end-state now rather than delaying privacy architecture.

Required engineering capabilities:
- clear notice versioning
- consent timestamp/version
- easy withdrawal
- data deletion workflow
- data export/access workflow as legally required
- processor inventory
- security safeguards
- breach response
- purpose limitation
- retention enforcement
- grievance/contact workflow

The DPDP Act also requires reasonable security safeguards and breach notification duties, and requires erasure when consent is withdrawn/purpose ends unless retention is legally required.

---

## 15. Mental-health confidentiality

The Mental Healthcare Act recognizes confidentiality rights concerning mental health and treatment information. Even if the listener tier is intentionally outside clinical treatment, build the platform assuming emotional/mental-health information is highly sensitive.

Engineering consequence:
- no transcripts
- no unnecessary free text
- strict access
- audit
- no advertising profile built from topics/safety data
- no sale of distress data
- no retargeting based on sensitive support topics

---

## 16. Security controls

### Secrets
- secret manager only
- rotate
- separate prod/staging
- no `.env` committed
- no service-role secret in browser

### Encryption
- TLS everywhere
- managed encryption at rest
- encrypt especially sensitive application fields if threat model requires
- avoid “roll your own crypto”

### Rate limits
- OTP
- login
- create request
- listener accept/decline
- safety button
- promo/refund
- admin export

### Session security
- SameSite/secure cookies
- CSRF protection where applicable
- short session lifetimes for admin
- MFA for staff/admin
- mandatory MFA for super-admin

### Audit
Audit:
- listener activation/suspension
- safety case access
- refund
- payout approval
- user data export/delete
- admin impersonation if ever added
- role changes

---

## 17. Abuse controls

### User abuse
- listener can end session for harassment/threat
- structured report
- user cooldown/suspension
- no direct contact exchange
- rate limit repeat account creation
- risk-based phone/device signals later

### Listener abuse
- user block/report
- low-rating reason tags
- supervisor review
- quality thresholds
- sudden complaint spike alert
- mystery quality audits where lawful/ethical
- no off-platform solicitation

### Fraud
- payment webhook verification
- payout hold window
- no payout for self-match/suspicious pair
- anomaly rules:
  - repeated same user/listener high volume
  - many short sessions
  - refund concentration
  - device/account clusters

Start with deterministic rules and manual review. Do not build a fraud ML system early.

---

## 18. Observability

Technical:
- request error rate
- DB latency
- payment webhook lag
- job failures
- LiveKit join success
- reconnect count
- queue age
- reservation expiry
- RLS/auth errors

Business:
- conversion
- match latency
- completion
- repeat
- rating
- escalation

Safety:
- open safety cases
- acknowledgement SLA
- high-severity count

Alerts:
- P0: payments double-captured, cross-user data exposure, room access breach, safety console unavailable
- P1: match queue > threshold, audio failure spike, webhook backlog
- P2: analytics/job lag

---

## 19. Testing strategy

### Unit
- state transition guards
- matching score
- pricing
- payout calculation
- rating Bayesian score
- retention policy logic

### Property tests
Ledger:
- journal always balances
- refunds never produce negative impossible states
- idempotent replay gives same result

Matching:
- blocked pairs never match
- unavailable listener never matches
- listener cannot have >1 active reservation

### Integration
- Razorpay webhook signature + replay
- LiveKit token scope
- Auth/RLS
- job retry

### E2E
1. new user pays and completes session
2. returning user
3. listener decline then rematch
4. listener timeout
5. browser disconnect/reconnect
6. payment callback without webhook
7. duplicate webhook
8. cancellation/refund
9. safety escalation
10. blocked pair
11. stale listener
12. deletion request

### Security tests
- IDOR
- privilege escalation
- RLS deny tests
- room token tampering
- webhook forgery
- OTP brute force
- admin MFA
- log leakage

---

## 20. CI/CD

PR gates:
```text
lint
typecheck
unit tests
db migration lint
RLS tests
integration tests
build
secret scan
dependency audit
```

Staging deploy:
- migration dry run
- smoke tests
- synthetic payment in test mode
- synthetic audio connection

Production:
- protected branch
- human approval
- migration backup
- roll-forward plan
- feature flags for risky feature
- no Friday-night migration unless incident

---

## 21. Deployment

### MVP
- Vercel: web
- Supabase managed: Postgres/Auth
- LiveKit Cloud
- Trigger.dev Cloud
- Razorpay
- Cloudflare DNS/WAF optionally
- Sentry

### Regions
Prefer infrastructure/data residency compatible with Indian legal/privacy requirements and vendor availability. Record all processors and data locations.

### Environments
- local
- staging (fake users/test payments)
- production

Never copy production mental-health data into staging.

---

## 22. Scale plan

Do not pre-optimize.

### 0–10k sessions/month
Single managed Postgres, simple matcher, LiveKit Cloud.

### 10k–100k sessions/month
- tune indexes
- connection pool
- read models/materialized views
- batch matching if queue demands it
- Redis only if measured need
- dedicated workers
- warehouse with de-identified event data

### >100k sessions/month
Evaluate:
- RTC cost/self-host
- multi-region
- dedicated matching service
- streaming/event bus
- warehouse
- supply forecasting

No scale architecture before evidence.

---

## 23. Open-source components to study/reuse

### LiveKit
Use for WebRTC, do not fork.

### Trigger.dev
Use for durable jobs; study its idempotency/retry patterns.

### Supabase
Use managed Postgres/Auth and RLS patterns.

### Formbricks
Useful for survey/feedback architecture ideas. **License warning:** core is AGPL; do not copy code into a proprietary product without satisfying license obligations. Easier: use as a separate service or build simple internal surveys.

### Cal.com
Useful to study scheduling, availability, timezone handling. **License warning:** AGPL/open-core; do not casually paste/fork code into proprietary repo.

### Novu
Potential notification orchestration later. MVP probably does not need it; direct provider integration is simpler.

### Sentry
Error/trace patterns; self-hosting is possible but not an MVP priority.

### Temporal
Study durable execution concepts; do not add unless Trigger.dev becomes insufficient.

---

## 24. Technical weaknesses to watch

1. **“Anonymous” marketing vs reality.** Payments/auth vendors necessarily know identifiers.
2. **Supply liquidity.** A technically perfect matcher cannot match if nobody is online.
3. **WebRTC reliability on poor mobile networks.**
4. **Payment dispute/refund edge cases.**
5. **Listener quality variance.**
6. **Safety events create high-severity operational burden.**
7. **Sensitive analytics can accidentally become surveillance.**
8. **Agent-generated code can weaken RLS or state machines unless guarded by tests.**
9. **Premature community/chat dramatically increases moderation risk.**
10. **Clinical scope can drift silently as listeners start giving advice.**
11. **Off-platform leakage:** listeners/users exchange contact details.
12. **Incentive problem:** paying by minute may reward longer sessions; design compensation carefully.
13. **Rating bias:** users may reward advice despite listener rules.
14. **Payment split compliance/onboarding can delay automation.**
15. **Crisis resource accuracy must be maintained operationally.**

---

## 25. Architecture decision records to create

`ADR-001 modular-monolith.md`  
`ADR-002 no-recording.md`  
`ADR-003 deterministic-matching.md`  
`ADR-004 fixed-session-pricing.md`  
`ADR-005 managed-livekit.md`  
`ADR-006 internal-ledger.md`  
`ADR-007 no-ai-clinical-decisions.md`  
`ADR-008 adults-only.md`  
`ADR-009 privacy-minimized-analytics.md`

Every future reversal must state:
- observed constraint
- options
- risks
- migration
- rollback
