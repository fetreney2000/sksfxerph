import { defineConfig, devices } from "@playwright/test";

/**
 * E2E smoke tests run against the production build on port 3111.
 * `reuseExistingServer` means you don't need a running server — `npm run test:e2e`
 * will start one if it isn't already up.
 */
export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 45_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: "http://localhost:3111",
    trace: "retain-on-failure",
    locale: "ms-MY",
    timezoneId: "Asia/Kuala_Lumpur",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: {
    command: "npx next start -p 3111",
    url: "http://localhost:3111/api/heartbeat",
    reuseExistingServer: true,
    timeout: 60_000,
  },
});
