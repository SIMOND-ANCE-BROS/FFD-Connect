import { Page } from "@playwright/test";

/**
 * Helper function to log in as a user via the web app.
 *
 * @param page - Playwright page instance
 * @param email - User email
 * @param password - User password
 */
export async function loginAs(
  page: Page,
  email: string,
  password: string,
): Promise<void> {
  await page.goto("/");

  // Wait for login screen to appear
  await page.waitForSelector(
    '[data-testid="login-email-input"], input[placeholder*="email" i], input[type="email"]',
    {
      timeout: 10_000,
    },
  );

  // Fill email
  const emailInput = page.locator('[data-testid="login-email-input"]').first();
  await emailInput.fill(email);

  // Fill password
  const passwordInput = page
    .locator('[data-testid="login-password-input"]')
    .first();
  await passwordInput.fill(password);

  // Submit
  const submitButton = page
    .locator('[data-testid="login-submit-button"]')
    .first();
  await submitButton.click();

  // Wait for navigation away from login screen
  await page
    .waitForURL((url) => !url.pathname.includes("login"), {
      timeout: 15_000,
    })
    .catch(() => {
      // Navigation may not change URL in React Native Web, just continue
    });
}

/**
 * Default test credentials
 */
export const TEST_CREDENTIALS = {
  email: "test.e2e@ffd.com",
  password: "password123",
};
