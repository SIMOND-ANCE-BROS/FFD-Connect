import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  timeout: 30_000,
  // 1 retry in CI catches the truly flaky test without tripling runtime on real failures.
  retries: process.env.CI ? 1 : 0,
  // Use all available CPU cores in CI (Ubuntu runners = 4 vCPU). Locally, default to 50%.
  workers: process.env.CI ? "100%" : undefined,
  // Fail the whole run if test.only is committed
  forbidOnly: !!process.env.CI,
  reporter: process.env.CI
    ? [
        ["github"],
        ["html", { outputFolder: "playwright-report", open: "never" }],
      ]
    : [
        ["list"],
        ["html", { outputFolder: "playwright-report", open: "on-failure" }],
      ],
  use: {
    baseURL:
      (process.env.PLAYWRIGHT_BASE_URL as string | undefined) ??
      "http://localhost:8081",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
    trace: "on-first-retry",
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "Mobile Chrome", use: { ...devices["Pixel 5"] } },
  ],
  // In CI, the web server is started externally (via `npx serve dist/`)
  webServer: process.env.CI
    ? undefined
    : {
        command: "npx expo start --web --port 8081",
        url: "http://localhost:8081",
        reuseExistingServer: true,
        timeout: 60_000,
      },
});
