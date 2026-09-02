# AGENTS.md

This repository implements a privacy-sensitive emotional-support marketplace. Follow these rules exactly.

## 1. Product scope

MVP flow:

`adult user -> topic/language -> payment -> queue -> trained listener -> private audio -> rating -> optional counsellor referral`

This is NOT:
- an AI therapist
- a medical diagnosis system
- a crisis hotline
- a social network
- a medical-record system

If a requested change expands any of those boundaries, stop and flag it for human product/clinical/legal approval.

---

## 2. Source of truth

Read before coding:
1. `README.md`
2. `PRD.md`
3. `TECHNICAL_PLAN.md`
4. `SECURITY_SAFETY.md`
5. relevant section of `SOP.md`
6. `IMPLEMENTATION_BACKLOG.md`

Priority:
`Safety/legal invariants > PRD acceptance criteria > technical plan > implementation convenience`

---

## 3. Non-negotiable invariants

### Privacy
- Never expose user phone/email to listener.
- Never record audio.
- Never create/store transcripts.
- Never add sensitive free text casually.
- Never use mental-health topic data for ads.
- Never place production data in tests, issues, prompts, fixtures, or logs.

### Safety
- Do not implement AI diagnosis.
- Do not implement AI suicide-risk scoring.
- Do not automate emergency decisions.
- Safety escalation must remain human-controlled and audited.

### Money
- Never trust client payment status/amount.
- Webhook is authoritative after signature validation.
- All payment/refund/payout handlers are idempotent.
- Ledger is append-only.
- No automated listener payout in MVP without human finance approval.

### Authorization
- Service-role secret never appears client-side.
- Every private table has grants + RLS.
- Add ALLOW and DENY tests for new RLS policy.
- UUID secrecy is not authorization.

### Sessions
- One listener <= one active reservation/session.
- One support request <= one active reservation.
- All state transitions use domain functions.
- No direct `UPDATE state=` from UI route code.

---

## 4. Work discipline

One task = one bounded change.

Before coding:
1. identify phase/backlog item
2. list files likely to change
3. identify invariants touched
4. identify tests required

After coding:
1. run relevant unit tests
2. run typecheck
3. run lint
4. run DB/RLS tests if DB touched
5. run E2E if user flow touched
6. summarize exactly what changed
7. list remaining risks

Do not “clean up” unrelated code.

---

## 5. Change size

Prefer PRs:
- <500 net lines when possible
- one domain concern
- one migration concern

Large generated refactors require explicit human approval.

---

## 6. Database rules

- migrations are immutable after merged
- use foreign keys
- use check constraints
- use unique constraints for business invariants
- timestamps in UTC
- money integer paise, never float
- enums/statuses are explicit
- indexes justified by query
- destructive migration requires backup/roll-forward plan

For concurrency:
- use transaction
- lock rows
- re-check condition inside transaction
- rely on DB constraint as final guard

---

## 7. RLS checklist

For every new exposed table:
- RLS enabled
- grants revoked then explicitly granted
- user policy
- listener policy if relevant
- admin strategy
- deny tests

Never disable RLS to make a feature work.

---

## 8. API checklist

Every mutation endpoint:
- authenticate
- authorize
- validate input
- rate limit when abuse-prone
- verify expected state
- apply idempotency if retryable
- write audit event if privileged
- return typed error

Never echo raw provider errors containing secrets.

---

## 9. Matching code

MVP is deterministic.

Do not add:
- embeddings
- LLM ranking
- collaborative filtering
- reinforcement learning
- hidden sensitive attributes

Matching must:
- hard-filter eligibility first
- score second
- persist score components
- atomically reserve

Quality score uses Bayesian smoothing.

If changing weights:
- add fixture-based comparison
- explain expected marketplace effect
- do not optimize only for revenue/session length

---

## 10. Audio

LiveKit token generation is server-only.

Token:
- exact room
- shortest useful TTL
- minimal permissions

Never enable:
- recording
- egress
- transcription
- persistent media storage

Any proposal to do so requires explicit privacy/clinical/product approval.

---

## 11. Safety code

Safety-case creation must be:
- available during active session
- idempotent
- fast
- independently observable

Never:
- block the UI waiting on analytics
- require LLM call
- infer severity from opaque ML
- hide crisis resources behind login/payment

A safety outage is P0/P1 depending on impact.

---

## 12. Payments

Use provider SDK/API from server.

Webhook:
1. raw body if provider requires
2. validate signature
3. check event ID idempotency
4. verify reference/amount
5. transition payment
6. journal ledger
7. emit operational event

Never create entitlement from redirect page alone.

---

## 13. Logging

Allowlist fields.

Good:
```json
{"event":"match_reserved","request_id":"...","listener_id":"...","latency_ms":421}
```

Bad:
```json
{"user_phone":"...","user_story":"My husband...","auth_token":"..."}
```

If unsure whether a field is sensitive, omit it.

---

## 14. Tests required by domain

### Matching
- blocked pair
- stale presence
- concurrent claims
- timeout
- decline/rematch

### Payments
- duplicate webhook
- invalid signature
- partial refund
- failed payment
- reconciliation discrepancy

### Auth/RLS
- user A cannot see B
- listener cannot see PII
- finance cannot see safety note
- anon denied

### Safety
- duplicate button
- supervisor acknowledgement
- backup alert
- audit entry

---

## 15. Prohibited shortcuts

Do not:
- use `any` to bypass domain types
- catch-and-ignore errors
- silently default invalid status
- add “temporary” admin bypass
- hardcode production secrets
- disable tests
- change test expectation to match a bug
- delete failing test without rationale
- bypass DB constraints
- store money as float
- use local time for ledger/session timestamps
- add a dependency for a 20-line utility without reason

---

## 16. Dependency policy

Before adding dependency:
- can platform/library already do it?
- is it maintained?
- license compatible?
- security history acceptable?
- bundle/runtime impact?
- does it process user data?

AGPL/open-core code cannot be copied into proprietary code casually. Study architecture or run separately under compliant terms.

---

## 17. Completion report template

Every agent task ends with:

```text
Task:
Backlog item:
Files changed:
Behavior changed:
Tests run:
Security/privacy impact:
Data migration:
Observability:
Known risks:
Not done:
```

---

## 18. Escalate to human when

- clinical language changes
- safety workflow changes
- minors proposed
- recording/transcription proposed
- new country
- new sensitive data field
- data retention period changes
- sharing data with new vendor
- new payout mechanics
- legal/consent copy changes
- admin access expansion
- AI enters user-support or safety path
