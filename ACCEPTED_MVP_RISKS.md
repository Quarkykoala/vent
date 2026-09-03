# ACCEPTED_MVP_RISKS.md

This document records accepted P2/P3 risks during the MVP hardening phase.
Each item documents why the risk is accepted within the MVP operating envelope, the operating assumptions, and triggers for revisiting.

---

| ID | Risk | Severity | Reason Accepted | Operating Assumption | Trigger for Revisiting |
|---|---|---|---|---|---|
| RISK-001 | Single-region deployment | P3 | Within MVP operating envelope (<50k users, India only) | Managed cloud infrastructure provides acceptable uptime | Expansion beyond India or >50k daily active users |
| RISK-002 | Manual finance payout review | P2 | Deliberate safety & anti-fraud control for MVP; automated payouts prohibited by AGENTS.md | Low session volume (<5,000/day) allows human review batching | Daily session volume exceeds operational capacity of finance team |
| RISK-003 | Basic deterministic Bayesian listener scoring | P3 | Complies with PRD & AGENTS.md prohibiting black-box ML/collaborative filtering | Static weights with Bayesian smoothing are sufficient for <500 listeners | Listener pool exceeds 500 or matching latency exceeds 2 seconds |
