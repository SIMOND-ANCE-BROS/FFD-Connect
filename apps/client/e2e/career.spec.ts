import { expect, test } from "@playwright/test";
import { mockApi } from "./helpers/api-mock";
import { loginAs, TEST_CREDENTIALS } from "./helpers/auth";
import { Page, Route } from "@playwright/test";

const BASE = process.env.EXPO_PUBLIC_API_URL ?? "http://localhost:3000";

const MOCK_CAREER = {
  partnerships: [
    {
      id: "p1",
      status: "ACTIVE",
      startDate: "2024-01-01T00:00:00.000Z",
      endDate: null,
      isCurrent: true,
      clubName: "Test Club",
      secondaryClubName: null,
      partner: {
        id: "u2",
        firstName: "Marie",
        lastName: "Martin",
        clubName: "Test Club",
      },
    },
  ],
  registrations: [
    {
      id: "r1",
      status: "CONFIRMED",
      bibNumber: 42,
      partnerName: "Marie Martin",
      event: {
        id: "e1",
        category: "Standard",
        ageGroup: "Adultes",
        level: null,
      },
      competition: {
        id: "comp-1",
        title: "Championnat Île-de-France 2026",
        date: "2026-05-15T00:00:00.000Z",
        location: "Paris",
        status: "UPCOMING",
      },
    },
  ],
  results: [
    {
      id: "res1",
      eventId: "e1",
      round: "Finale",
      ranking: 3,
      participantLabel: null,
      event: { category: "Standard", ageGroup: "Adultes" },
      competition: {
        title: "Open de Paris 2025",
        date: "2025-04-01T00:00:00.000Z",
      },
    },
  ],
};

async function mockCareerApi(page: Page): Promise<void> {
  await page.route(`${BASE}/career/me`, async (route: Route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(MOCK_CAREER),
    });
  });

  await page.route(`${BASE}/career/search-members*`, async (route: Route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([]),
    });
  });
}

test.describe("Career Screen", () => {
  test.beforeEach(async ({ page }) => {
    await mockApi(page);
    await mockCareerApi(page);
    await page.goto("/");
    await page.waitForSelector('[data-testid="login-email-input"]', {
      timeout: 10_000,
    });
    await loginAs(page, TEST_CREDENTIALS.email, TEST_CREDENTIALS.password);
  });

  test("navigates to career tab", async ({ page }) => {
    // Career screen is the default after login — check it's visible
    await expect(page.getByText(/ma carrière|carrière/i).first()).toBeVisible({
      timeout: 10_000,
    });
  });

  test("career screen shows partnerships section", async ({ page }) => {
    await expect(page.getByText(/partenariats/i).first()).toBeVisible({
      timeout: 10_000,
    });
  });

  test("career screen shows competitions/registrations section", async ({
    page,
  }) => {
    await expect(
      page.getByText(/compétitions|inscriptions/i).first(),
    ).toBeVisible({ timeout: 10_000 });
  });

  test("career screen shows results section", async ({ page }) => {
    await expect(page.getByText(/résultats|classement/i).first()).toBeVisible({
      timeout: 10_000,
    });
  });
});
