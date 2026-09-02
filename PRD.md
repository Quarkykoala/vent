# PRD — Mental Health Funnel Marketplace

**Version:** 1.0  
**Market:** India  
**Platform:** Responsive web/PWA first  
**Primary user:** Adult seeking immediate emotional support  
**Secondary user:** Trained listener  
**Tertiary user:** Counsellor/supervisor/admin

---

## 1. Problem

Many people are distressed enough to want a human conversation but not ready to book “therapy.” Traditional therapy has higher price, commitment, stigma, discovery friction, and scheduling friction.

The product creates a low-friction top-of-funnel:

1. “I need to talk.”
2. Immediate anonymous session with a trained listener.
3. If the user needs structured guidance, offer a qualified counsellor.
4. If they need ongoing clinical care, route to an appropriate therapist.

The listener service is **support**, not diagnosis or treatment.

---

## 2. Product promise

> Talk anonymously to a trained human when you need to be heard.

Secondary promise:

> If you need more than listening, we help you reach the right level of professional care.

### Claims we must NOT make

- “We treat depression/anxiety.”
- “Guaranteed to make you better.”
- “Clinically cures…”
- “Equivalent to therapy.”
- “Crisis support.”
- “Your data is 100% anonymous” if the platform itself retains account/payment identifiers.
- Any unsupported clinical outcome claim.

Use **“anonymous to the listener”** or **“pseudonymous in-session”** unless legal/privacy review supports stronger wording.

---

## 3. Personas

### P1 — Immediate support user
- 18–40, mobile-first.
- Wants to speak now.
- Typical topics: relationship conflict, breakup, loneliness, work stress, family conflict, exam/career stress, grief, overthinking.
- Does not want intake paperwork.
- Values privacy and speed.

### P2 — Returning user
- Has a preferred listener.
- Wants predictable quality.
- May graduate to counselling.
- Higher LTV.

### P3 — Listener
- Vetted and trained.
- Provides active listening only.
- Needs queue control, earnings visibility, safety escalation, session notes limited to structured operational fields.

### P4 — Qualified counsellor
- Has verified professional qualifications.
- Can provide counselling within approved scope.
- Separate product tier and rules.

### P5 — Supervisor
- Clinical/operations lead.
- Handles safety escalations, listener quality, complaints, retraining, suspensions.

---

## 4. MVP scope

### User-facing
- Landing page.
- Topic selection.
- 18+ confirmation.
- Clear service boundary.
- Pseudonymous account / OTP sign-in.
- Buy a session or minutes package.
- “Talk now” queue.
- Listener match.
- Browser audio room.
- Session timer and balance.
- End session.
- 1–5 rating + structured feedback.
- Block listener.
- Request counsellor.
- Booking for counsellor.
- Basic purchase/session history.
- Privacy/delete account request.
- Crisis resources always accessible.

### Listener-facing
- Onboarding status.
- Availability toggle.
- Topics/languages.
- Queue assignment.
- Accept/decline with reason.
- Audio room.
- Session timer.
- “Safety concern” button.
- “User abusive” button.
- End session.
- Structured post-session disposition:
  - completed normally
  - user disconnected
  - technical failure
  - safety escalated
  - abuse
- Earnings ledger.
- Schedule/availability.

### Admin/supervisor
- Listener verification.
- Training completion.
- Activate/suspend.
- Live queue health.
- Session metadata.
- Refund workflow.
- Safety case console.
- Audit log.
- Payout approval.
- Quality dashboard.

---

## 5. Explicit non-goals for MVP

Do not implement:
- Native iOS/Android.
- Video.
- Text chat.
- AI companion.
- AI therapist.
- AI triage.
- AI suicide detection.
- Call recording.
- Transcript storage.
- Community/feed.
- User-to-user messaging.
- Group sessions.
- Child/minor service.
- Couples therapy.
- Prescriptions.
- Insurance.
- Corporate dashboard.
- Loyalty points/gamification.
- User-uploaded media.
- Public listener comments.
- Search-engine indexed user content.
- Cross-border users.
- Crypto/wallet.
- Dynamic surge pricing.

Every added feature increases either safety surface, privacy surface, moderation surface, or operational complexity.

---

## 6. Core user flow

### Flow A — Talk now

1. Landing page → “Talk now”.
2. Age gate: “I confirm I am 18 or older.”
3. Service boundary:
   - trained listener
   - not therapy
   - not crisis/emergency support
   - no diagnosis or medical advice
4. Choose topic.
5. Choose language.
6. Optional: listener preference (no preference / woman / man / previous listener). Only include attributes legally and operationally supportable.
7. Show price and expected wait.
8. Authenticate with phone OTP or existing session.
9. Payment if insufficient balance.
10. Create `support_request`.
11. Matching engine reserves listener.
12. Listener accepts within N seconds.
13. Both receive short-lived LiveKit room tokens.
14. Audio begins.
15. Timer displays.
16. Session ends by user, listener, time/balance limit, or connection failure.
17. Rating.
18. Offer:
    - talk again
    - book counsellor
    - leave

### UX target

From landing page to queue: **<60 seconds** for returning user.  
Match during staffed hours: **median <2 minutes, p90 <5 minutes**.

Do not promise “under 2 minutes” until actual p90 performance supports it.

---

## 7. Counsellor escalation flow

Escalation can be initiated by:
- user choosing “I need guidance”
- post-session recommendation based on listener selecting a **non-diagnostic structured category**
- supervisor after safety/quality review

Listener cannot diagnose or tell the user “you have X disorder.”

Allowed language:
- “You may benefit from speaking with a qualified counsellor.”
- “Would you like me to show you counselling options?”

### Funnel event
`listener_session_completed → counselling_offer_shown → counselling_booking_started → counselling_booking_paid → counselling_session_completed`

Track this as the key business funnel.

---

## 8. Crisis/safety flow

The platform is not a crisis service.

Always-visible crisis page includes:
- Tele-MANAS: 14416.
- India emergency services: 112.
- “If you are in immediate danger or may harm yourself or someone else, contact emergency services now.”

### Safety button during session
Listener presses “Safety concern.”

System:
1. Shows approved supervisor script.
2. Opens a live supervisor escalation channel.
3. Records structured safety event, **not a transcript**.
4. Presents verified crisis resources to user.
5. Supervisor decides next action per approved SOP.
6. All safety actions are timestamped in immutable audit log.

No LLM decides risk level or emergency action.

---

## 9. Pricing model

MVP should choose one model, not three.

Recommended:
- Fixed 20-minute listener session.
- Example launch test price: ₹149–₹249.
- Overtime only if both sides consent and user pays/has balance.
- Counselling priced per scheduled session.

Why fixed sessions first:
- easier checkout
- fewer billing disputes
- simpler timer
- clearer listener compensation
- simpler refunds
- less wallet regulatory/product complexity

Per-minute pricing can be tested later.

---

## 10. Matching requirements

### Hard filters
Listener must be:
- active
- verified
- training current
- online
- not already in session
- language-compatible
- topic-compatible
- not blocked by user
- user not blocked by listener
- allowed for requested service tier

### Ranking
MVP uses deterministic weighted scoring, not ML.

Proposed score:

`score = 0.30*language + 0.25*topic + 0.15*wait_fairness + 0.15*quality + 0.10*repeat_affinity + 0.05*load_balance`

Each component normalized 0–1.

Notes:
- Quality uses Bayesian-smoothed rating, not raw stars.
- Wait fairness rewards listeners who have been available but under-assigned.
- Repeat affinity only applies if user previously rated listener ≥4 and neither party blocked the other.
- Never use protected/sensitive traits unless explicit product/legal approval exists.

### Bayesian quality score
Avoid promoting a listener with one 5-star review above one with 500 reviews.

`quality = (C*m + n*r) / (C+n)`

Where:
- `r` = listener average
- `n` = rated sessions
- `m` = marketplace mean
- `C` = prior strength, initially 20

### Concurrency safety
Claim listener row using a transaction and `FOR UPDATE SKIP LOCKED` or equivalent atomic reservation. The request must have an idempotency key. A listener can have only one active reservation/session.

---

## 11. Matching evolution

### V0 — Greedy
Select highest-scoring available listener for each request.

Use until:
- concurrent waiting requests regularly >10–20
- or p90 wait becomes unstable

### V1 — Small-batch assignment
Every 3–5 seconds, collect waiting users and available listeners, compute pair costs, solve minimum-cost matching/Hungarian assignment.

Research precedent: Uber explains that small batches can reduce average wait compared with always assigning the nearest/first resource immediately.

### V2 — Predictive/ML
Do **not** implement until ≥10,000–50,000 completed sessions and clear offline evaluation labels exist.

Possible labels later:
- match acceptance
- connection success
- session completion
- post-session rating
- repeat request
- refund
- complaint

Never optimize solely for session length or revenue because that can conflict with user welfare.

---

## 12. Functional requirements

### FR-01 Account
- User can sign in with OTP.
- Listener never sees user phone/email.
- Product displays pseudonymous handle/session alias.

### FR-02 Topic
- User selects exactly one primary topic.
- Optional secondary tags later.

### FR-03 Availability
- Listener can go online/offline.
- Heartbeat marks stale listener offline after configurable TTL.

### FR-04 Queue
- Request states:
  `created → paid → queued → reserved → accepted → connected → completed`
- Failure branches:
  `expired | cancelled | declined | payment_failed | technical_failed | safety_escalated`

### FR-05 Payment
- Payment webhook is source of truth.
- Never mark payment successful from client redirect alone.
- Webhook handler idempotent.

### FR-06 Call
- Server generates short-lived room token.
- User cannot enumerate/join another session.
- Audio only.
- No recording/egress.

### FR-07 Billing
- Immutable ledger.
- Refund is compensating entry, never edit history.

### FR-08 Rating
- 1–5 rating.
- Reason tags for ≤3.
- Free text optional only if privacy/legal lead approves; otherwise structured tags.

### FR-09 Safety
- Dedicated button.
- Supervisor acknowledgement SLA.
- Audit trail.

### FR-10 Block
- User can block listener.
- Block is a hard matching constraint.

### FR-11 Delete
- User can request account deletion.
- Deletion workflow follows retention/legal rules and produces audit evidence.

---

## 13. Quality metrics

### North star
**Completed paid support sessions with ≥4/5 rating and no safety/abuse incident.**

### Marketplace health
- median match time
- p90 match time
- match acceptance rate
- connection success
- completion rate
- listener occupancy
- request abandonment

### User
- first-session conversion
- D7/D30 repeat
- CSAT
- refund rate
- counselling escalation conversion
- complaint rate

### Supply
- listener activation
- hours online
- utilization
- earnings/hour online
- decline rate
- cancellation rate
- quality score

### Safety
- safety escalations / 1,000 sessions
- supervisor response time
- false/duplicate escalations
- unresolved incidents
- prohibited conduct reports

---

## 14. MVP success criteria

After first 1,000 paid sessions:

- Payment success >95% excluding user-bank declines.
- Audio connection success >97%.
- Session completion >90%.
- Median match <3 min during advertised staffed hours.
- p90 match <7 min.
- Mean rating ≥4.4.
- Refund rate <5%.
- Serious complaint rate <1%.
- Every safety event has complete audit trail.
- Zero unresolved P0 privacy or safety incident.
- At least 15% 30-day repeat is an early signal; do not hard-code as universal benchmark until cohort data exists.

---

## 15. Admin permissions

Roles:
- `support_agent`
- `listener_ops`
- `clinical_supervisor`
- `finance`
- `privacy_admin`
- `super_admin`

Principle: least privilege.

Examples:
- Finance can see payment identifiers and payout data but not safety notes.
- Clinical supervisor can see structured safety cases but not full payment details.
- Support sees session status, not private clinical/safety detail unless assigned.
- Super-admin access is break-glass and audited.

---

## 16. Accessibility and language

MVP languages:
- English
- Hindi
Add Marathi/Gujarati only after there is staffed supply.

Requirements:
- WCAG-oriented contrast/focus.
- Large tap targets.
- Low-bandwidth mode.
- Audio reconnect handling.
- Plain-language disclosures.

---

## 17. Product experiments

Allowed after baseline stability:
1. Fixed 20 min vs 30 min.
2. ₹149 vs ₹199 vs ₹249.
3. Topic-first vs listener-first.
4. “Talk now” vs scheduled.
5. Counselling offer timing.
6. Returning-listener shortcut.

Do not A/B test crisis disclosures, consent, privacy rights, or safety controls merely for conversion.

---

## 18. Launch phases

### Phase 0 — Concierge
- Landing page + Razorpay payment link + manually dispatched listener.
- 5–10 listeners.
- 100 paid sessions.
- Validate demand and scripts.

### Phase 1 — Marketplace MVP
- Automated queue/matching.
- Browser audio.
- Admin.
- Ledger.
- Safety console.

### Phase 2 — Care funnel
- Counsellor profiles.
- Booking.
- Referral.
- Better cohort analytics.

### Phase 3 — Scale
- Batch matching.
- supply forecasting
- B2B
- native apps only if web limits growth

---

## 19. Definition of product done

MVP is done only when:
- user can pay → queue → match → connect → complete → rate
- listener can onboard → go online → accept → connect → finish
- admin can refund, suspend, review incident, reconcile payout
- safety escalation has been tabletop-tested
- security review passes
- RLS tests pass
- payment webhook replay tests pass
- no recordings/transcripts are created
- on-call runbook exists
