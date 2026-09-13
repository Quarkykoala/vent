# ACCEPTED_MVP_RISKS.md

This document records accepted P2/P3 risks and deliberate architectural choices during the MVP hardening phase.
Each item documents why the risk is accepted within the MVP operating envelope, operating assumptions, and triggers for revisiting.

---

| ID | Risk / Decision | Severity | Reason Accepted | Operating Assumption | Trigger for Revisiting |
|---|---|---|---|---|---|
| RISK-001 | Single-region deployment | P3 | Within MVP operating envelope (<50,000 users, <1,000 concurrent, India only). | Managed PostgreSQL / Supabase in Mumbai region provides acceptable latency (<100ms) and high availability. | Expansion beyond India or DAU exceeding 50,000. |
| RISK-002 | Manual human finance payout approval | P2 | Deliberate safety & anti-fraud invariant required by `AGENTS.md`. No automated listener payouts permitted without human finance review. | Low listener volume (<500 listeners, weekly batches) allows manual human review and sign-off. | Weekly payout batch volume exceeds operational capacity of finance team. |
| RISK-003 | Deterministic Bayesian listener scoring | P3 | Complies with PRD and `AGENTS.md` prohibiting black-box ML, embeddings, or collaborative filtering. | Rule-based filtering (tier, language, topic, active presence) + Bayesian smoothed rating `(C*m + n*r)/(C+n)` provides fair, observable matches. | Listener pool exceeds 500 or matching latency exceeds 2 seconds. |
| RISK-004 | Test-mode simulator for PG/Webhook and WebRTC in CI | P3 | Allows deterministic end-to-end testing of payments, ledger, and tokens in CI/CD without live monetary transactions or media servers. | Code paths fail closed (HTTP 503) if credentials are unconfigured in production. Simulator flag is strictly disabled in production. | Deployment to production staging environments with live sandboxes. |
| RISK-005 | Retention of pseudonymized ledger records after DPDP erasure | P2 | Legal compliance with Indian Income Tax Act and Companies Act requiring statutory retention of financial transactions. | Ledger entries and payment rows contain zero PII (only UUIDs, integer paise, INR, account codes). User handle, phone, and auth accounts are permanently scrubbed/purged. | Formal notification of DPDP 2023 statutory retention regulations from the Data Protection Board of India. |
| RISK-006 | Strict 20-minute audio session cap | P3 | MVP scope constraint to ensure listener predictability and prevent psychological attachment. | Automatic disconnect and presence release after session duration expiration. | Expansion into multi-tier session duration offerings (e.g. 40 minutes). |

---

### Operating Parameters & Envelope Summary
- **Territory**: India only (`+91` phone numbers, INR currency).
- **Demographics**: Adults 18+ only, verified during onboarding.
- **Capacity**: <50,000 total users, <1,000 concurrent sessions, <500 listeners, <5,000 sessions/day.
- **Invariants**: Strict zero audio recording, zero transcript storage, fail-closed security, append-only double-entry ledger, row-level locking concurrency control in PostgreSQL.
