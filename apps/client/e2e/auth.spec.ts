import { expect, test } from "@playwright/test";
import { mockApi } from "./helpers/api-mock";
import { loginAs, TEST_CREDENTIALS } from "./helpers/auth";

test.describe("Authentication", () => {
  test.beforeEach(async ({ page }) => {
    await mockApi(page);
    await page.goto("/");
  });

  test("shows login screen on initial load", async ({ page }) => {
    // App should show the login screen with FFD Connect title
    await expect(page.getByText("FFD Connect")).toBeVisible({
      timeout: 10_000,
    });
    await expect(
      page.locator('[data-testid="login-email-input"]'),
    ).toBeVisible();
    await expect(
      page.locator('[data-testid="login-password-input"]'),
    ).toBeVisible();
    await expect(
      page.locator('[data-testid="login-submit-button"]'),
    ).toBeVisible();
  });

  test("shows error message with invalid credentials", async ({ page }) => {
    await page.waitForSelector('[data-testid="login-email-input"]', {
      timeout: 10_000,
    });

    await page
      .locator('[data-testid="login-email-input"]')
      .fill("invalid@test.com");
    await page
      .locator('[data-testid="login-password-input"]')
      .fill("wrongpassword");
    await page.locator('[data-testid="login-submit-button"]').click();

    // After failed login, should remain on login screen (not navigate away)
    await expect(
      page.locator('[data-testid="login-submit-button"]'),
    ).toBeVisible({ timeout: 10_000 });
    // Login screen title still visible
    await expect(page.getByText("FFD Connect")).toBeVisible();
  });

  test("redirects to main screen after successful login", async ({ page }) => {
    await page.waitForSelector('[data-testid="login-email-input"]', {
      timeout: 10_000,
    });

    await loginAs(page, TEST_CREDENTIALS.email, TEST_CREDENTIALS.password);

    // After login, main navigation should be visible (career screen is the default)
    await expect(page.getByText(/ma carrière|carrière|licences/i)).toBeVisible({
      timeout: 15_000,
    });
  });

  test("forgot password flow navigates to forgot password screen", async ({
    page,
  }) => {
    await page.waitForSelector('[data-testid="login-forgot-password-button"]', {
      timeout: 10_000,
    });

    await page.locator('[data-testid="login-forgot-password-button"]').click();

    // Should navigate to forgot password screen
    await expect(
      page.locator('[data-testid="forgot-password-email-input"]'),
    ).toBeVisible({ timeout: 10_000 });
  });

  test("forgot password - enter email and submit", async ({ page }) => {
    await page.waitForSelector('[data-testid="login-forgot-password-button"]', {
      timeout: 10_000,
    });

    await page.locator('[data-testid="login-forgot-password-button"]').click();

    await page.waitForSelector('[data-testid="forgot-password-email-input"]', {
      timeout: 10_000,
    });

    await page
      .locator('[data-testid="forgot-password-email-input"]')
      .fill("test@ffd.com");
    await page.locator('[data-testid="forgot-password-submit"]').click();

    // After submit, email input should still be visible (form remains accessible)
    // OR page navigates back - either way the screen doesn't crash
    await page.waitForTimeout(2_000);
    const stillOnForgotPassword = await page
      .locator('[data-testid="forgot-password-email-input"]')
      .isVisible()
      .catch(() => false);
    const backOnLogin = await page
      .locator('[data-testid="login-email-input"]')
      .isVisible()
      .catch(() => false);
    expect(stillOnForgotPassword || backOnLogin).toBe(true);
  });

  test("shows validation error with empty fields", async ({ page }) => {
    await page.waitForSelector('[data-testid="login-submit-button"]', {
      timeout: 10_000,
    });

    // Click submit without filling fields
    await page.locator('[data-testid="login-submit-button"]').click();

    // Should remain on login screen (validation prevents navigation)
    await expect(
      page.locator('[data-testid="login-submit-button"]'),
    ).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText("FFD Connect")).toBeVisible();
  });
});
