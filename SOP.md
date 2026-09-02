# SOP — Operations, Listener Quality, Safety, Payments, Incidents

## 0. Rule hierarchy

When rules conflict:

1. Immediate human safety.
2. Applicable law/regulatory obligation.
3. Privacy/confidentiality.
4. Clinical supervisor policy.
5. Product SOP.
6. Growth/revenue.

Never optimize conversion over safety.

---

# Part A — Listener operations

## A1. Listener eligibility

Before activation:
- identity verified
- 18+
- signed agreement
- scope-of-service training complete
- privacy/confidentiality training
- harassment/boundary training
- suicide-prevention gatekeeper training approved by clinical lead
- passed scenario assessment
- device/network test
- payout details verified

Psychology degree is not automatically equivalent to platform training. Conversely, a “listener” must never present themselves as a therapist unless verified for the professional tier.

## A2. Listener scope

Listener MAY:
- actively listen
- reflect feelings
- ask open questions
- summarize
- validate emotion without validating harmful beliefs
- encourage appropriate professional support
- provide platform-approved resources

Listener MUST NOT:
- diagnose
- prescribe
- recommend medication changes
- promise outcomes
- claim therapy is being delivered
- conduct treatment without appropriate credential/tier
- encourage dependency
- exchange private contact/social handles
- solicit off-platform payment
- meet user offline
- record session
- request sexual/financial favors
- use user story publicly

## A3. Shift start

1. Sign in with MFA if required.
2. Check headset/mic.
3. Confirm private physical environment.
4. Confirm no recording device.
5. Review incident notices.
6. Set languages/topics.
7. Toggle available.
8. Heartbeat must remain healthy.

## A4. Match offer

Listener sees:
- pseudonymous alias
- topic
- language
- session duration
- no phone/email
- no payment amount beyond listener earning if desired

Accept within configured window.

Decline reason:
- break
- topic mismatch
- language mismatch
- technical issue
- other operational reason

Repeated unexplained decline triggers ops review, not automatic punishment.

## A5. Session opening script

Approved concept:
- greet
- state role as listener
- remind user this is a private listening session, not therapy/emergency care
- invite them to share

Do not repeat a long legal disclosure verbally unless clinical/legal lead requires it; the product already displayed it.

## A6. Session ending

At ~2 minutes remaining:
- gentle time notice
- summarize without clinical diagnosis
- ask whether they want platform resources/counsellor option

End:
- thank user
- do not request personal contact
- select disposition

## A7. Post-session metadata

Allowed structured fields:
- completed
- technical issue
- abuse
- safety escalation
- referral offered
- referral accepted

Do not write detailed “case notes” for listener sessions.

---

# Part B — Quality assurance

## B1. Quality signals
- Bayesian rating
- complaint rate
- block rate
- early termination
- safety protocol adherence
- decline/cancel rate
- repeat affinity
- supervisor review

## B2. Review triggers
Mandatory review if:
- serious complaint
- boundary violation
- off-platform solicitation
- repeated ≤2-star ratings
- safety SOP failure
- unusual session/payout pattern
- confidentiality concern

## B3. Actions
- coach
- retrain
- probation
- topic restriction
- temporary pause
- suspend
- permanent removal

Every disciplinary action has reason code and audit trail.

---

# Part C — Safety escalation

## C1. Training foundation

Use an Indian clinical lead and formal gatekeeper training. NIMHANS describes gatekeeper training as building skill to identify warning signs, communicate empathetically, assess risk, provide immediate support and refer appropriately.

The app itself does not replace trained judgement.

## C2. Crisis boundary

The service is not a crisis line.

Always available:
- Tele-MANAS 14416
- India emergency number 112

The clinical lead must validate the live resource list at least monthly and after any reported failure.

## C3. Trigger examples

Listener opens safety case when:
- user directly says they may harm themselves/someone
- user indicates imminent danger
- severe disorientation or risk creates concern
- violence/abuse situation requires supervisor support
- listener is unsure and wants supervisor review

Do not require perfect certainty before escalating.

## C4. Safety workflow

1. Listener stays calm and engaged where safe.
2. Press `Safety concern`.
3. Select structured reason.
4. Supervisor alert becomes P0/P1 based on policy.
5. Supervisor acknowledges.
6. App displays crisis resources.
7. Supervisor follows approved clinical/legal script.
8. If emergency intervention is warranted under policy/law, supervisor coordinates.
9. Resolve case with structured disposition.
10. Conduct incident review.

No autonomous AI escalation.

## C5. Information disclosure

Never promise absolute secrecy. The privacy/terms language must explain legally/safety-permitted disclosures.

Only authorized supervisor/privacy/legal personnel can approve disclosure outside normal service, except as explicitly pre-authorized by emergency SOP.

---

# Part D — Abuse and boundary incidents

## D1. User harasses listener
1. Listener warns once if safe/appropriate.
2. Listener may end immediately for threats/sexual harassment.
3. Report structured reason.
4. Ops reviews account.
5. Cooldown/suspend as policy dictates.

## D2. Listener asks user to go off-platform
- immediate review
- preserve relevant platform metadata
- suspend pending investigation when credible
- payout hold only per contract/policy and legal approval

## D3. Doxxing/contact disclosure
- remove exposed data if stored/displayed
- notify privacy/security if system leakage
- block pair
- investigate

---

# Part E — Support/refunds

## E1. Technical failure refund matrix

Example policy; finance/product approve exact values.

- no connection: 100%
- <25% session due platform failure: 100%
- 25–75%: proportional or replacement credit
- >75%: case review
- user voluntarily ends: normally no automatic refund
- safety ended: never auto-deny; supervisor/support review

## E2. Refund procedure
1. Support selects session.
2. System shows payment and connection telemetry.
3. Support selects reason.
4. Refund proposal generated server-side.
5. Authorized role confirms.
6. Provider refund API called idempotently.
7. Ledger compensating entry.
8. User notified.

No manual DB edits.

---

# Part F — Listener payouts

## F1. Weekly payout
1. Job generates eligible sessions.
2. Exclude disputed/held sessions.
3. Calculate earnings from versioned compensation rule.
4. Finance reviews batch.
5. Payout executed.
6. Provider/bank reference stored.
7. Ledger reconciled.
8. Listener statement generated.

## F2. Compensation changes
Never silently change historical earnings.

Store:
- compensation plan version
- effective date
- amount/rate
- session’s applied plan version

---

# Part G — Privacy requests

## G1. Delete request
1. Verify user authentication.
2. Mark deletion pending.
3. Stop marketing/optional analytics association immediately.
4. Determine records legally required to retain.
5. Delete/anonymize remaining personal data.
6. Revoke account.
7. generate completion evidence.
8. Do not place deleted user content in model-training corpora.

## G2. Access/correction/grievance
- route through privacy workflow
- identity verify requester
- log request
- SLA according to approved policy/law
- never email sensitive export without appropriate security

---

# Part H — Incident response

## H1. Severity

### P0
- cross-user data exposure
- unauthorized room access
- leaked session audio
- active safety escalation system unavailable
- payment double charge at scale
- admin compromise

### P1
- audio failure spike
- matching outage
- payment webhook backlog
- safety supervisor notifications delayed
- partial PII leakage

### P2
- analytics outage
- non-critical admin issue

## H2. P0 response
1. Incident commander assigned.
2. Stop damage.
3. Disable affected feature if needed.
4. Preserve logs/evidence.
5. Security/privacy/clinical lead notified as relevant.
6. Determine affected users/data.
7. Regulatory/user notifications per legal runbook.
8. Patch.
9. Validate.
10. Postmortem within 5 business days.

Never hide or delete incident evidence.

---

# Part I — Daily operations checklist

Start of day:
- listener supply by language/topic
- safety supervisor coverage
- failed payments/webhooks
- unresolved refund queue
- unresolved safety cases
- audio join success
- stale jobs
- fraud alerts

End of day:
- queue SLA
- incidents
- payouts/refunds discrepancies
- listener complaints
- next-day staffing gaps

---

# Part J — Weekly quality meeting

Review:
- funnel
- matching
- ratings
- repeat
- listener utilization
- complaints
- refunds
- safety cases
- privacy requests
- fraud
- top failure root causes

Output:
- maximum 3 corrective actions
- owner
- deadline
- measurable expected result

Do not turn this into a feature brainstorm.
