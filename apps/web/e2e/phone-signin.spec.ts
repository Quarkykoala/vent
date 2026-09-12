import { test, expect } from '@playwright/test';

test.describe('Phone sign-in journey', () => {
  test('shows sign-in, gates on age, and creates a request after genuine OTP verify', async ({ page }) => {
    await page.goto('/');

    await expect(page.getByText('Sign in with your mobile number')).toBeVisible();
    const sendBtn = page.getByRole('button', { name: /Send code/i });
    await expect(sendBtn).toBeDisabled();

    await page.getByRole('checkbox').check();
    await expect(sendBtn).toBeEnabled();

    await page.getByLabel('Mobile number').fill('9999911111');
    await sendBtn.click();
    await expect(page.getByText(/Code sent to/)).toBeVisible();

    await page.getByLabel('6-digit code').fill('98765');
    await page.getByRole('button', { name: /Verify code/i }).click();
    await expect(page.getByText('Enter the 6-digit code.')).toBeVisible();

    await page.getByLabel('6-digit code').fill('987654');
    await page.getByRole('button', { name: /Verify code/i }).click();
    await expect(page.getByText('Signed in. You can now request a listener.')).toBeVisible();
    await expect(page.getByText(/Signed in. Your number stays private/)).toBeVisible();

    const requestBtn = page.getByRole('button', { name: /Request a listener/i });
    await expect(requestBtn).toBeEnabled();
    await requestBtn.click();
    await expect(page.getByText(/Request saved. Topic:/)).toBeVisible();
    await expect(page.getByText(/Your next step is payment/)).toBeVisible();

    // A second click must not silently create another request.
    await expect(page.getByRole('button', { name: /Request saved/i })).toBeDisabled();
    await expect(page.getByText('Saved request')).toBeVisible();

    // An explicit new request starts a fresh submission.
    await page.getByRole('button', { name: /Start a new request/i }).click();
    await expect(page.getByRole('button', { name: /Request a listener/i })).toBeEnabled();
  });

  test('shows a clear error for a wrong code', async ({ page }) => {
    await page.goto('/');

    await page.getByRole('checkbox').check();
    await page.getByLabel('Mobile number').fill('9999911111');
    await page.getByRole('button', { name: /Send code/i }).click();
    await expect(page.getByText(/Code sent to/)).toBeVisible();

    await page.getByLabel('6-digit code').fill('000000');
    await page.getByRole('button', { name: /Verify code/i }).click();
    await expect(page.getByText(/Invalid code|expired/i).first()).toBeVisible();
  });
});
