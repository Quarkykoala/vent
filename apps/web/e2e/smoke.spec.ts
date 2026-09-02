import { test, expect } from '@playwright/test';

test.describe('Marketplace Smoke & Safety Flow', () => {
  test('renders landing page with service disclaimer and crisis helplines', async ({ page }) => {
    await page.goto('/');

    // Check crisis helplines in top banner
    await expect(page.getByText('Tele-MANAS: 14416')).toBeVisible();

    // Check heading
    await expect(page.getByRole('heading', { name: /Talk to someone who listens/i })).toBeVisible();

    // Check 18+ age gate requirement
    const submitBtn = page.getByRole('button', { name: /Start Session/i });
    await expect(submitBtn).toBeDisabled();

    // Check crisis page link
    await page.getByRole('link', { name: /Emergency & Crisis Help/i }).click();
    await expect(page).toHaveURL('/crisis');
    await expect(page.getByRole('heading', { name: /Emergency & Crisis Resources/i })).toBeVisible();
    await expect(page.getByText('14416 / 1800 891 4416')).toBeVisible();
  });
});
