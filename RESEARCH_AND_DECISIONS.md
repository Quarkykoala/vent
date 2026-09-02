# Research & Architecture Decisions

## 1. Market/product observations

### Venterr
Venterr currently positions itself as:
- anonymous emotional-support conversation
- trained human listeners
- match in seconds/under two minutes
- topics such as relationships, anxiety, loneliness, work stress and family
- scheduled listeners
- communities/feed
- business offering

Engineering lesson: the immediate-listener flow is the wedge. The feed/community is not needed to validate the wedge and materially increases moderation/privacy burden.

### Clarity
Clarity publicly describes:
- paid listener calls/chats
- wallet/recharge
- mostly per-minute pricing around ₹8/min in its FAQ
- anonymous support orientation

Recent public Play reviews also illustrate pricing sensitivity and confusion around per-minute charges. Engineering/product lesson: fixed-duration pricing makes early billing simpler and easier to communicate.

### YourDOST
Shows the natural “care ladder” expansion:
- 24/7 professional access
- counselling
- enterprise wellness
- multiple languages

Lesson: B2B and professional care can be later layers; they do not need to exist in the listener MVP.

---

## 2. Regulatory/privacy research

### Digital Personal Data Protection
The DPDP Rules were notified in November 2025. The Gazette specifies phased commencement: some rules immediate, Rule 4 after one year, and several substantive rules after 18 months.

Build the product now with:
- clear notices
- purpose limitation
- consent records
- withdrawal/deletion workflows
- processor inventory
- security safeguards
- breach readiness

The DPDP Act requires reasonable security safeguards and breach notification duties, and provides for erasure when consent is withdrawn or purpose is no longer served unless retention is legally necessary.

### Mental Healthcare Act
The Mental Healthcare Act, 2017 includes a right to confidentiality concerning mental health, mental healthcare, treatment and physical healthcare.

Even though the “listener” tier is deliberately not therapy, mental-health-related metadata should be treated as highly sensitive.

### Telemedicine
India’s Telemedicine Practice Guidelines provide norms for Registered Medical Practitioners and cover consent, records, privacy/security and platform responsibilities. The listener tier should avoid drifting into medical practice. Qualified professional tiers need separate scope/legal review.

### Crisis resources
- Tele-MANAS: 14416, 24/7 government tele-mental-health service.
- Emergency Response Support System: 112, pan-India emergency number.

---

## 3. Safety research

NIMHANS Gatekeeper Training describes suicide-prevention gatekeepers as people trained to:
- identify warning signs
- communicate empathetically
- assess risk
- support
- refer appropriately

Decision:
**humans own crisis judgement.**

AI can eventually assist non-clinical operations, but not risk grading or emergency decisions in MVP.

---

## 4. Matching research

Uber describes moving from immediate closest-resource matching toward short batched matching to reduce overall wait time.

Application here:
- start greedy because supply is small
- once queue concurrency is meaningful, batch for a few seconds and solve global assignment
- objective is multi-dimensional: wait time + quality + compatibility + fairness
- never optimize one party at the expense of safety

Potential later solver:
- Hungarian algorithm for one-to-one assignment
- min-cost max-flow if capacities/constraints become more complex

No solver is needed initially.

---

## 5. Open-source research

### LiveKit
Repository/docs describe an open-source WebRTC SFU. It handles signalling, NAT traversal, RTP routing and quality-of-service functions.

Decision:
- use LiveKit Cloud first
- retain migration path to self-host
- no recording

Risk:
Self-hosting WebRTC is not “just deploy Docker”; production needs public networking, TLS, TURN and operational tuning.

### Supabase
Postgres + Auth + RLS.

Official docs stress:
- RLS on exposed tables
- grants and policies both matter
- service-role/secret bypasses RLS and must remain server-side

Decision:
Use Supabase managed, with SQL RLS tests in CI.

### Trigger.dev
Open-source TypeScript workflow/job system with retries, queues, long-running tasks and idempotency.

Decision:
Use for timeout/reconciliation/deletion/payout proposal jobs.

### Temporal
Excellent open-source durable execution.

Decision:
Do not use in MVP. Reconsider only if workflow complexity exceeds Trigger.dev.

### Cal.com
Strong scheduling reference.

License:
Open-core/AGPL areas. Study patterns, do not copy proprietary/AGPL code into closed repo without license compliance.

Decision:
Build simple slot scheduling for counsellors initially.

### Formbricks
Privacy-focused survey platform; core is AGPL.

Decision:
Study survey UX; simple 1–5 rating is easier to build than introducing an entire platform.

### Novu
Open-source notification abstraction.

Decision:
Deferred. Direct provider integrations are simpler initially.

### Sentry
Mature error/performance monitoring.

Decision:
Use hosted with aggressive PII scrubbing; no sensitive payloads.

---

## 6. Why not AI first

An LLM seems tempting for:
- triage
- listener replacement
- session summary
- risk detection
- matching

Do not do it in MVP.

Reasons:
1. user safety
2. hard-to-evaluate failure modes
3. sensitive data sent to another processor
4. clinical/legal ambiguity
5. undermines “real human” wedge
6. adds prompt/eval/moderation infrastructure before product-market fit

Safe early AI use:
- internal code generation
- synthetic test fixtures
- de-identified support-ticket classification
- operations documentation

Not user clinical care.

---

## 7. Why not community/feed

Venterr already advertises communities/feed. Do not copy it initially.

A public/semipublic emotional feed adds:
- harmful-content moderation
- suicide/self-harm content
- bullying
- grooming
- spam
- minors
- doxxing
- legal takedowns
- 24/7 moderation
- recommendation-system safety
- much more data retention

It is a separate product, not an MVP feature.

---

## 8. Why fixed sessions instead of per-minute

Per-minute:
+ aligns usage
+ familiar in listener marketplaces
- wallet/balance UX
- surprising spend
- timer anxiety
- payout complexity
- incentive to extend conversations

Fixed 20-minute:
+ one checkout
+ clear price
+ clear listener earnings
+ easy refund
+ easy testing

Decision:
Start fixed. Add extensions later.

---

## 9. Why browser audio instead of phone call

Browser/WebRTC:
+ user/listener do not exchange phone numbers
+ lower identity leakage
+ richer app state
+ easier session timer
+ cross-platform
- network/mic permission failures

PSTN:
+ familiar
+ works without browser mic permissions
- telecom/vendor complexity
- phone number exists in underlying provider systems
- masking/telephony constraints
- potentially higher cost

Decision:
WebRTC primary, PSTN fallback later.

---

## 10. Key unresolved questions requiring human decision

### Clinical/legal
- exact boundary between trained listener and counselling
- credential requirements
- safety disclosure/exceptions
- whether any structured safety notes are health records for specific legal purposes
- retention periods
- minors policy (MVP says no)
- professional liability/insurance

### Commercial
- launch price
- listener compensation
- refund policy
- payout hold period
- GST/accounting treatment
- payment marketplace onboarding

### Operations
- staffed hours vs 24/7 claim
- language launch set
- supervisor coverage
- listener-to-supervisor ratio

---

## 11. Sources reviewed

Official / high-authority:
- Government of India, Mental Healthcare Act 2017 (India Code)
- MeitY, Digital Personal Data Protection Rules 2025 and Gazette notification
- Digital Personal Data Protection Act 2023 (India Code)
- Ministry of Health & Family Welfare / PIB, Telemedicine Practice Guidelines
- Ministry of Health & Family Welfare / PIB, Tele-MANAS launch; 14416
- Government of India ERSS / 112.gov.in
- NIMHANS Gatekeeper Training Program
- WHO digital health privacy/data-protection guidance

Technical:
- LiveKit documentation
- Supabase RLS/security documentation
- Trigger.dev repository/documentation
- Temporal documentation
- Razorpay Route documentation
- Exotel number-masking documentation
- Uber marketplace matching explanation
- Cal.com GitHub
- Formbricks GitHub
- Novu GitHub
- Sentry GitHub/documentation

Product:
- Venterr website
- Clarity App FAQ and Google Play listing/reviews
- YourDOST website

---

## 12. Direct source URLs

https://www.venterr.com/
https://www.clarityapp.in/faqs/
https://yourdost.com/
https://www.indiacode.nic.in/handle/123456789/2249
https://www.indiacode.nic.in/bitstream/123456789/22037/1/a2023-22.pdf
https://www.meity.gov.in/documents/act-and-policies/digital-personal-data-protection-rules-2025-gDOxUjMtQWa
https://www.mohfw.gov.in/tele-manas
https://112.gov.in/
https://nimhans.co.in/gate-keeper-training/
https://supabase.com/docs/guides/database/postgres/row-level-security
https://docs.livekit.io/transport/self-hosting/
https://trigger.dev/
https://docs.temporal.io/
https://razorpay.com/docs/payments/route/
https://docs.exotel.com/contact-center/number-masking
https://www.uber.com/gb/en/marketplace/matching/
https://github.com/calcom/cal.com
https://github.com/formbricks/formbricks
https://github.com/novuhq/novu
https://github.com/getsentry/sentry
