# Muse Spark 1.3 Contributor: small coding test

2026-09-07. User authorized the supplied Meta API key and Contributor tier for a low-cost test.

**Result: a useful first attempt. The generated phone OTP sign-in component compiled and passed the exercised browser scenarios without source repairs.** It remains an isolated component draft; it is not integrated into Vent and does not establish full authentication or launch readiness.

## API and cost

- Direct endpoint: `https://api.meta.ai/v1/chat/completions`.
- Key/model discovery: HTTP 200 from `/v1/models`; Contributor catalog entry present.
- Exactly one generation request, `muse-spark-1.3-contributor`, medium reasoning, 8,192 completion-token cap, no automatic retry or model fallback.
- Returned model matched; HTTP 200, normal `stop` finish, 34.173 seconds.
- Usage: 492 input + 4,332 output = 4,824 tokens. Output includes 2,578 reasoning tokens; do not add them again.
- Estimated list-price charge: **$0.0009156**, using $0.10/million input and $0.20/million output. This is a token-rate estimate, not an observed account invoice. [Published Contributor rates](https://openrouter.ai/meta/muse-spark-1.3-contributor).
- `generation-result.json` records usage and timing; `request.json` and `prompt.txt` preserve the exact secret-free request content. No credential was added to project files or generated logs. The key was read only from this task's explicitly supplied user message and held in process memory for the authorized request.

## Independent checks

The unchanged `PhoneSignIn.tsx` passed strict TypeScript compilation and browser execution using React 19. The local preview's OTP endpoints returned synthetic fixtures only. No SMS, customer data, live sign-in or real backend operation was involved.

Observed checks:

- Send disabled before the parent age-confirmation flag is set.
- Invalid phone and short OTP rejected without corresponding API requests.
- Ten-digit mobile input normalized to +91; already normalized input accepted.
- Correct phone/code/age fields sent to the expected endpoints.
- Non-JSON HTTP 502 response produced a safe retryable UI error, without rendering the raw provider body.
- HTTP 200 with an empty token did not authenticate.
- Change phone cleared the old OTP/error and used the new number on the next verification.
- Valid verification invoked the parent success callback once and cleared the phone/code state.
- Browser localStorage, sessionStorage and cookies remained empty.

Evidence: saved page snapshots, `compile-result.json`, `synthetic-api-calls.json`, and the three storage checks. The console's missing-favicon 404 came from the preview harness; the 502 was deliberately injected. No application exception was observed. Pending-request races and live provider behavior were not comprehensively tested; no broad reliability claim is made.

## Scope

All 179 source/configuration/migration/test files in the preceding intake inventory remained unchanged. The model's source was preserved verbatim apart from removing optional Markdown fences and adding a final newline. The reviewer created the preview and checks, not the component. No additional model repair call was made. The preview server and its isolated browser were closed after verification.

This supports trying Muse on another small useful task when requested. It does not rank Muse against Gemini/GLM or authorize a longer spend. The user's current priority is completing a lean end-to-end product, with proportionate checks, rather than continuing exhaustive backend hardening or model evaluation.

```text
Task: Test Muse Spark 1.3 Contributor cheaply through the supplied Meta API.
Backlog item: Exploratory phone sign-in component for P1.1; product integration remains pending.
Files changed: Task-local model output, request/usage receipt, preview harness and verification evidence; continuation note.
Behavior changed: None in the application.
Tests run: API/model availability, one generation, strict component typecheck, isolated browser scenarios, storage checks and source integrity.
Security/privacy impact: Contributor use expressly authorized; API credential kept out of project artifacts; synthetic test data only.
Data migration: None.
Observability: Actual model ID, tokens, latency, estimated cost and browser evidence saved.
Known risks: One component test does not establish longer-task reliability or live OTP integration.
Not done: Application integration, live SMS/authentication, database changes, deployment or further paid calls.
```
