import { Page, Route } from "@playwright/test";

const BASE = process.env.EXPO_PUBLIC_API_URL ?? "http://localhost:3000";

const MOCK_USER = {
  id: "user-e2e-1",
  email: "test.e2e@ffd.com",
  firstName: "Test",
  lastName: "E2E",
  role: "LICENSEE",
};

const MOCK_LICENSE = {
  id: "lic-1",
  userId: "user-e2e-1",
  number: "FFD-2026-001",
  category: "Latin",
  validUntil: "2026-08-31T00:00:00.000Z",
  clubName: "Test Club",
  qrCodeSignature: null,
  createdAt: "2025-09-01T00:00:00.000Z",
  updatedAt: "2025-09-01T00:00:00.000Z",
};

const MOCK_COMPETITIONS = {
  data: [
    {
      id: "comp-1",
      title: "Championnat Île-de-France 2026",
      date: "2026-05-15T00:00:00.000Z",
      location: "Paris",
      status: "UPCOMING",
      events: [],
    },
  ],
  meta: { total: 1, page: 1, limit: 10 },
};

/**
 * Intercepts all backend API calls and returns mock data.
 * Call this in `test.beforeEach` or `test.use` to avoid real network requests.
 */
export async function mockApi(page: Page): Promise<void> {
  // Auth — login
  await page.route(`${BASE}/auth/login`, async (route: Route) => {
    const body = route.request().postDataJSON() as {
      username?: string;
      password?: string;
    };
    if (body?.password === "password123") {
      await route.fulfill({
        status: 201,
        contentType: "application/json",
        body: JSON.stringify({
          access_token: "mock-access-token",
          refresh_token: "mock-refresh-token",
          user: MOCK_USER,
        }),
      });
    } else {
      await route.fulfill({
        status: 401,
        body: JSON.stringify({ message: "Unauthorized" }),
      });
    }
  });

  // Auth — refresh
  await page.route(`${BASE}/auth/refresh`, async (route: Route) => {
    await route.fulfill({
      status: 201,
      contentType: "application/json",
      body: JSON.stringify({
        access_token: "new-mock-token",
        refresh_token: "new-mock-refresh",
      }),
    });
  });

  // Auth — logout
  await page.route(`${BASE}/auth/logout`, async (route: Route) => {
    await route.fulfill({
      status: 201,
      contentType: "application/json",
      body: JSON.stringify({ success: true }),
    });
  });

  // Auth — forgot password
  await page.route(`${BASE}/auth/forgot-password`, async (route: Route) => {
    await route.fulfill({
      status: 201,
      contentType: "application/json",
      body: JSON.stringify({ success: true }),
    });
  });

  // Users — me
  await page.route(`${BASE}/users/me`, async (route: Route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(MOCK_USER),
    });
  });

  // Licenses — my
  await page.route(`${BASE}/licenses/my`, async (route: Route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(MOCK_LICENSE),
    });
  });

  // Competitions — list
  await page.route(`${BASE}/competitions*`, async (route: Route) => {
    const url = route.request().url();
    if (
      url.includes("/register") ||
      url.includes("/unregister") ||
      url.includes("/checkin")
    ) {
      await route.continue();
      return;
    }
    if (/\/competitions\/[^/]+$/.test(url)) {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(MOCK_COMPETITIONS.data[0]),
      });
    } else {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(MOCK_COMPETITIONS),
      });
    }
  });

  // Notifications
  await page.route(`${BASE}/notifications*`, async (route: Route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([]),
    });
  });

  // Tracks
  await page.route(`${BASE}/tracks*`, async (route: Route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([]),
    });
  });
}
