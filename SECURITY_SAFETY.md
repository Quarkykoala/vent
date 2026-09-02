# Security & Safety Specification

## 1. Threat model

Protect:
- user identity
- listener identity/KYC
- mental-health topic metadata
- safety cases
- payments
- audio room access
- admin privileges
- payout integrity

Threat actors:
- malicious user
- malicious listener
- compromised user device
- compromised listener device
- external attacker
- rogue employee/admin
- third-party processor breach
- coding agent introducing insecure authorization
- accidental analytics/log leakage

---

## 2. Primary threats and controls

### T1 Cross-account data access / IDOR
Controls:
- RLS
- server authorization
- unguessable UUIDs are not authorization
- negative access tests
- no client-supplied ownership fields

### T2 Audio room intrusion
Controls:
- short-lived scoped token
- unpredictable room
- token issued only after accepted reservation
- max two expected human participants plus approved supervisor if escalated
- no room directory
- no recording
- disconnect unauthorized participant

### T3 Listener sees user PII
Controls:
- never send phone/email to listener client
- pseudonym
- backend view with allowlisted fields
- avoid PII in notification body

### T4 Sensitive data in logs
Controls:
- structured logging allowlist
- no request-body default logs
- redact auth/payment headers
- Sentry PII scrubbing
- CI test scans logs in E2E

### T5 Payment forgery
Controls:
- webhook signature
- provider amount/order lookup
- idempotency
- ledger
- reconciliation

### T6 Double match / double payout
Controls:
- row lock
- unique constraints
- state-machine CAS
- idempotent jobs
- ledger uniqueness

### T7 Abuse / grooming
Controls:
- no contact exchange
- user/listener block
- reporting
- review
- repeat-pair monitoring
- boundary training

### T8 Admin abuse
Controls:
- role separation
- MFA
- no shared accounts
- audit
- break-glass workflow
- periodic access review

### T9 Data retention creep
Controls:
- retention registry
- automated deletion
- no “keep forever because useful”
- approval required for new data field

### T10 AI safety failure
Control:
- no AI clinical decisions in MVP
- LLMs may later help internal summarization only on de-identified operational data and with explicit review

---

## 3. Data classification

### Class A — critical sensitive
- safety cases
- listener KYC
- authentication identifiers
- payment identifiers

### Class B — sensitive
- session topic
- rating reason
- counselling booking
- block/report

### Class C — operational
- queue latency
- room join timestamps
- job status

### Class D — public
- marketing pages
- listener public bios (approved fields only)

Access and logging rules depend on class.

---

## 4. Privacy-by-design rules

1. If a field is not necessary, do not collect it.
2. Prefer enum/tag over free text.
3. Prefer pseudonymous ID over contact detail.
4. Never use emotional-support topics for ad targeting.
5. Never sell or broker distress/mental-health data.
6. Do not record calls.
7. Do not train models on sessions.
8. Any new processor requires processor inventory update.
9. Any new analytics property requires privacy review.
10. Production data never goes into developer prompts/issues by default.

---

## 5. Agent/coding safety

Coding agents must never:
- paste production records into prompts
- weaken RLS to “fix” tests
- expose service role in client
- bypass webhook verification
- mutate payment/session state directly
- add recording/transcription
- add free-form “notes” without approval
- add AI risk scoring
- invent legal/clinical logic

Require human review for:
- migrations touching auth/payment/safety
- RLS policy
- payout
- crisis path
- privacy deletion
- secrets/infrastructure

---

## 6. Secure development checklist

Before merge:
- authorization reviewed
- input schema exists
- state transition valid
- idempotency considered
- PII/logging considered
- migration rollback/roll-forward considered
- tests include negative permission case
- monitoring exists for critical failure

---

## 7. Crisis safety testing

Tabletop scenarios:
1. direct imminent self-harm statement
2. vague hopelessness
3. threat to another person
4. domestic violence
5. user disconnects after safety concern
6. supervisor unavailable
7. Tele-MANAS link/number unavailable
8. app outage mid-escalation
9. malicious false escalation
10. listener panics or gives prohibited advice

The clinical lead owns expected responses. Engineering validates buttons, alerts, audit and failover.

---

## 8. Business-continuity fallback

If matching service fails:
- stop accepting “instant” promises
- allow scheduled request / refund
- show clear status

If LiveKit fails:
- do not expose personal phone numbers
- optional approved PSTN fallback
- otherwise refund/rebook

If safety console fails:
- prominently expose crisis resources
- notify on-call supervisor through secondary channel
- disable new sessions if safe supervision cannot be guaranteed

---

## 9. Security launch gates

- external or independent security review
- RLS test suite
- dependency scan
- secret scan
- admin MFA
- backup restore drill
- incident tabletop
- payment replay test
- room intrusion test
- deletion test
- crisis escalation tabletop
