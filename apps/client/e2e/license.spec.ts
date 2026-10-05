import { expect, test } from "@playwright/test";
import { mockApi } from "./helpers/api-mock";
import { loginAs, TEST_CREDENTIALS } from "./helpers/auth";

test.describe("License Screen", () => {
  test.beforeEach(async ({ page }) => {
    await mockApi(page);
    await page.goto("/");
    await page.waitForSelector('[data-testid="login-email-input"]', {
      timeout: 10_000,
    });
    await loginAs(page, TEST_CREDENTIALS.email, TEST_CREDENTIALS.password);
  });

  test("navigates to license tab after login", async ({ page }) => {
    await page.locator('[data-testid="tab-license"]').click();
    await page.waitForTimeout(500);

    await expect(page.getByText(/mes licences/i).first()).toBeVisible({
      timeout: 10_000,
    });
  });

  test("shows license card or no-license state", async ({ page }) => {
    await page.locator('[data-testid="tab-license"]').click();
    await page.waitForTimeout(1000);

    // Should show either a license card or a guest/empty state
    const hasLicenseCard = await page
      .locator('[data-testid^="license-screen-card-"]')
      .first()
      .isVisible()
      .catch(() => false);

    const hasGuestCard = await page
      .locator('[data-testid="license-screen-guest-card"]')
      .isVisible()
      .catch(() => false);

    const hasScrollView = await page
      .locator('[data-testid="license-screen-scroll-view"]')
      .isVisible()
      .catch(() => false);

    expect(hasLicenseCard || hasGuestCard || hasScrollView).toBeTruthy();
  });

  test("license screen scroll view is visible", async ({ page }) => {
    await page.locator('[data-testid="tab-license"]').click();
    await page.waitForTimeout(500);

    await expect(
      page.locator('[data-testid="license-screen-scroll-view"]'),
    ).toBeVisible({ timeout: 10_000 });
  });
});
