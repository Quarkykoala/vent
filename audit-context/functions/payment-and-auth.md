## `POST` in apps/web/src/app/api/payments/orders/route.ts (L8-L124)

**Purpose:** Creates a server-priced payment order for an existing authenticated support request.

**Inputs & Assumptions:**
- Bearer auth is required by `authenticateRequest` (`L10`; `auth-guard.ts:L21-L37`).
- Body must satisfy `CreatePaymentOrderSchema` and contain `requestId` (`L12-L22`).
- A matching support request row owned by the authenticated internal user must exist (`L25-L37`). Current support-request route establishes no such row.

**Outputs & Effects:**
- Creates a Razorpay or explicit simulator order, persists a payment row, and links the payment UUID to the support request (`L47-L114`). Amount comes from `DEFAULT_PRICING` (`L40-L41`).
- Returns provider order ID, payment ID, request ID, amount/currency/state, and a client key ID (`L104-L114`).

**Cross-Function Dependencies:**
- `SupabaseAuthService.getUserFromToken` validates the token with Supabase and derives app role/user record (`supabase-auth-service.ts:L112-L160`).
- `PaymentRepository.createPayment` persists the payment record (`packages/db/src/repositories/payment.repository.ts:L16-L39`).
- Webhook completion is separate: `PaymentWebhookProcessor.processWebhook` validates signature and calls atomic capture (`payment-processor.ts:L63-L167`).

**Open Questions:**
- No page or inspected caller performs OTP, invokes this endpoint, opens Razorpay checkout, or handles provider completion.
