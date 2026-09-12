import { test, expect } from '@playwright/test';
import crypto from 'node:crypto';

/**
 * Two-context integrated journey against the local stack.
 *
 * Customer (context 1): sign-in → request → server-priced order → locally
 * signed capture webhook through the real HMAC path → paid queue → session →
 * server end → rating.
 * Listener (context 2): provisioned fixture → sign-in → availability → offer →
 * accept → session convergence.
 *
 * Simulated at this boundary: SMS delivery (local test-OTP map), Razorpay money
 * movement (simulator order id + locally signed webhook), LiveKit media (a real
 * token is requested; no audio packets flow because no LiveKit deployment
 * exists). Everything else — auth, persistence, entitlement, matching,
 * reservation, state transitions — is the production path on the local
 * database.
 */

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || 'http://127.0.0.1:54321';
const SERVICE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';

const CUSTOMER_PHONE = '9999911111';
const LISTENER_PHONE = '9999922222';
const TEST_OTP = '987654';

interface ListenerFixture {
  authUserId: string;
  userId: string;
  profileId: string;
}

async function adminRest(path: string, init: RequestInit = {}) {
  const res = await fetch(`${SUPABASE_URL}${path}`, {
    ...init,
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
      ...(init.headers ?? {}),
    },
  });
  return res;
}

async function provisionListener(): Promise<ListenerFixture> {
  const phone = `+91${LISTENER_PHONE}`;
  const digits = (value: string | undefined) => (value ?? '').replace(/\D/g, '');

  // Reuse or create the auth user for this phone. GoTrue stores the number
  // without the leading '+', so the lookup compares digits only.
  const createRes = await adminRest('/auth/v1/admin/users', {
    method: 'POST',
    body: JSON.stringify({
      phone,
      phone_confirm: true,
      app_metadata: { role: 'listener' },
    }),
  });
  const created = await createRes.json().catch(() => ({}));
  let authUserId: string | undefined = created?.id;

  if (!authUserId) {
    for (let page = 1; page <= 10 && !authUserId; page += 1) {
      const listRes = await adminRest(`/auth/v1/admin/users?page=${page}&per_page=200`);
      const list = await listRes.json().catch(() => ({}));
      const users: Array<{ id: string; phone?: string }> = list?.users ?? [];
      authUserId = users.find((u) => digits(u.phone) === digits(phone))?.id;
      if (users.length < 200) break;
    }
  }
  if (!authUserId) {
    throw new Error(
      `Could not provision listener auth user: ${JSON.stringify(created?.msg ?? created?.error_description ?? created)}`
    );
  }

  const suffix = crypto.randomUUID().slice(0, 8);
  const userRes = await adminRest('/rest/v1/users?on_conflict=auth_user_id', {
    method: 'POST',
    headers: { Prefer: 'resolution=merge-duplicates,return=representation' },
    body: JSON.stringify({
      auth_user_id: authUserId,
      handle: `E2eListener${suffix}`,
      age_verified_at: new Date().toISOString(),
      status: 'active',
    }),
  });
  const userRows = await userRes.json();
  const userId: string = userRows[0].id;

  const profileRes = await adminRest('/rest/v1/listener_profiles?on_conflict=user_id', {
    method: 'POST',
    headers: { Prefer: 'resolution=merge-duplicates,return=representation' },
    body: JSON.stringify({
      user_id: userId,
      display_name: `E2E Listener ${suffix}`,
      status: 'active',
      tier: 'listener',
      languages: ['English', 'Hindi'],
      // Cover the whole topic selector so the fixture stays eligible whatever
      // default the request form submits.
      topics: [
        'Relationship Conflict',
        'Breakup',
        'Loneliness',
        'Work & Career Stress',
        'Family Conflict',
        'Exam & Career Stress',
        'Grief',
        'Overthinking',
      ],
      verified_at: new Date().toISOString(),
      training_expires_at: new Date(Date.now() + 7 * 86_400_000).toISOString(),
    }),
  });
  const profileRows = await profileRes.json();
  const profileId: string = profileRows[0].id;

  await adminRest('/rest/v1/listener_presence?on_conflict=listener_id', {
    method: 'POST',
    headers: { Prefer: 'resolution=merge-duplicates,return=representation' },
    body: JSON.stringify({
      listener_id: profileId,
      state: 'offline',
      heartbeat_at: new Date().toISOString(),
    }),
  });

  return { authUserId, userId, profileId };
}

async function cleanupListener(fixture: ListenerFixture) {
  // Diagnostics: keeping fixtures lets a failing run be inspected in the
  // database afterwards (the listener profile cascades to the session).
  if (process.env.E2E_KEEP_FIXTURES === '1') return;
  await adminRest(`/rest/v1/listener_presence?listener_id=eq.${fixture.profileId}`, { method: 'DELETE' });
  await adminRest(`/rest/v1/listener_profiles?id=eq.${fixture.profileId}`, { method: 'DELETE' });
  await adminRest(`/rest/v1/users?id=eq.${fixture.userId}`, { method: 'DELETE' });
  await adminRest(`/auth/v1/admin/users/${fixture.authUserId}`, { method: 'DELETE' });
}

async function signIn(page: import('@playwright/test').Page, phone: string) {
  const checkbox = page.getByRole('checkbox');
  if (await checkbox.count()) {
    await checkbox.first().check();
  }
  await page.getByLabel('Mobile number').fill(phone);
  await page.getByRole('button', { name: /Send code/i }).click();
  await expect(page.getByText(/Code sent to/)).toBeVisible();
  await page.getByLabel('6-digit code').fill(TEST_OTP);
  await page.getByRole('button', { name: /Verify code/i }).click();
}

test.describe('Integrated customer + listener journey', () => {
  // Sign-in credentials are memory-only by design, so every full page load
  // needs a fresh sign-in. Bound each action so a missing control fails fast
  // instead of consuming the whole test timeout.
  test.use({ actionTimeout: 20_000 });

  test('pay → queue → offer → accept → session → end → rate', async ({ browser, request }) => {
    test.slow();
    const listener = await provisionListener();
    const customer = await browser.newContext();
    const listenerCtx = await browser.newContext();
    const cPage = await customer.newPage();
    const lPage = await listenerCtx.newPage();

    try {
      // ---- Customer: sign in + create exactly one request ----
      await cPage.goto('/');
      await cPage.getByRole('checkbox').check();
      await cPage.getByLabel('Mobile number').fill(CUSTOMER_PHONE);
      await cPage.getByRole('button', { name: /Send code/i }).click();
      await expect(cPage.getByText(/Code sent to/)).toBeVisible();
      await cPage.getByLabel('6-digit code').fill(TEST_OTP);
      await cPage.getByRole('button', { name: /Verify code/i }).click();
      await expect(cPage.getByText('Signed in. You can now request a listener.')).toBeVisible();
      await cPage.getByRole('button', { name: /Request a listener/i }).click();
      await expect(cPage.getByText(/Request saved. Topic:/)).toBeVisible();
      const savedText = (await cPage.getByText(/Request ID:/).textContent()) ?? '';
      const requestId = savedText.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i)?.[0];
      expect(requestId).toBeTruthy();

      // ---- Customer: server-priced order through the real order route ----
      await cPage.getByRole('button', { name: /Proceed to checkout/i }).click();
      await expect(cPage.getByText(/Payment order/)).toBeVisible();
      const orderText = (await cPage.getByText(/Order:/).textContent()) ?? '';
      const providerOrderId = orderText.match(/order_sim_[0-9a-f]+/)?.[0];
      expect(providerOrderId).toBeTruthy();

      // ---- Bank webhook (locally signed; real HMAC verification path) ----
      const secret = process.env.E2E_WEBHOOK_SECRET ?? 'e2e_webhook_secret_001';
      const paymentEntityId = `pay_e2e_${Date.now()}`;
      const rawBody = JSON.stringify({
        event: 'payment.captured',
        account_id: 'acc_e2e',
        payload: {
          payment: {
            entity: {
              id: paymentEntityId,
              order_id: providerOrderId,
              amount: 19900,
              currency: 'INR',
              status: 'captured',
            },
          },
        },
      });
      const sig = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
      const hook = await request.post('/api/webhooks/razorpay', {
        data: rawBody,
        headers: { 'content-type': 'application/json', 'x-razorpay-signature': sig },
      });
      expect(hook.ok()).toBe(true);

      // ---- Customer: entitlement comes from the server, never the callback ----
      await cPage.getByRole('button', { name: /I have paid/i }).click();
      await expect(cPage.getByText(/Payment confirmed by the bank/)).toBeVisible();

      // ---- Listener: sign in, go available ----
      await lPage.goto('/listener');
      await signIn(lPage, LISTENER_PHONE);
      await expect(lPage.getByText('Listener console')).toBeVisible();
      await lPage.getByRole('button', { name: /Go available/i }).click();
      await expect(lPage.getByText(/You are now available/)).toBeVisible();

      // ---- Customer: queue drives the deterministic matcher ----
      await cPage.goto(`/queue?requestId=${requestId}`);
      await signIn(cPage, CUSTOMER_PHONE);
      await expect(cPage.getByRole('button', { name: /Check for a match now/i })).toBeVisible({
        timeout: 20_000,
      });
      await cPage.getByRole('button', { name: /Check for a match now/i }).click();
      await expect(cPage.getByText(/offered your request/)).toBeVisible({ timeout: 25_000 });

      // ---- Listener: accept the offer (server creates exactly one session) ----
      await lPage.reload();
      await signIn(lPage, LISTENER_PHONE);
      await expect(lPage.getByRole('button', { name: 'Accept' })).toBeVisible({ timeout: 30_000 });
      await lPage.getByRole('button', { name: 'Accept' }).click();
      await expect(lPage.getByText(/Offer accepted. Session/)).toBeVisible({ timeout: 20_000 });
      const listenerMessage = (await lPage.getByText(/Offer accepted. Session/).textContent()) ?? '';
      const sessionId = listenerMessage.match(
        /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i
      )?.[0];
      expect(sessionId).toBeTruthy();

      // ---- Customer: the same session, with a server-authoritative timer ----
      await cPage.goto(`/session/${sessionId}`);
      await signIn(cPage, CUSTOMER_PHONE);
      await expect(cPage.getByTestId('session-timer')).toBeVisible({ timeout: 20_000 });
      await expect(cPage.getByTestId('session-timer')).toContainText('remaining');
      await expect(cPage.getByTestId('safety-concern')).toBeVisible();

      // ---- Server owns the terminal state ----
      await cPage.getByRole('button', { name: /End session on the server/i }).click();
      await expect(cPage.getByText(/Session ended. Duration/)).toBeVisible({ timeout: 20_000 });

      // Listener console converges on the same terminal state: after a fresh
      // sign-in there is no offer left to accept.
      await lPage.reload();
      await signIn(lPage, LISTENER_PHONE);
      await expect(lPage.getByText(/No offers right now/)).toBeVisible({ timeout: 20_000 });
      await expect(lPage.getByRole('button', { name: 'Accept' })).toHaveCount(0);

      // ---- Customer: rate once, from history ----
      // Scoped to the session this run created: the shared test phone number
      // accumulates history across runs, and rating an arbitrary older session
      // is both flaky and not what this journey is proving.
      await cPage.goto('/history');
      await signIn(cPage, CUSTOMER_PHONE);
      const sessionCard = cPage.locator('li').filter({ hasText: sessionId! }).first();
      await expect(sessionCard.getByRole('button', { name: /Rate this session/i })).toBeVisible({
        timeout: 20_000,
      });
      await sessionCard.getByRole('button', { name: /Rate this session/i }).click();
      await cPage.getByRole('button', { name: '5', exact: true }).first().click();
      const [ratingResponse] = await Promise.all([
        cPage.waitForResponse(
          (r) => r.url().includes(`/api/sessions/${sessionId}/rating`) && r.request().method() === 'POST',
          { timeout: 20_000 }
        ),
        cPage.getByRole('button', { name: /submit/i }).first().click(),
      ]);
      expect(
        ratingResponse.status(),
        `rating API returned ${ratingResponse.status()}: ${await ratingResponse.text()}`
      ).toBe(201);
      await expect(cPage.getByText(/Rated\. Thank you\.|Thank you\. Your rating was recorded\./)).toBeVisible({
        timeout: 20_000,
      });
    } finally {
      await customer.close();
      await listenerCtx.close();
      await cleanupListener(listener);
    }
  });
});
