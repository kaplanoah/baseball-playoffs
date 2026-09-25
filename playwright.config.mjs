import { defineConfig, devices } from "@playwright/test";

const PORT = 4173;
const executablePath = process.env.CHROMIUM_PATH;

export default defineConfig({
  testDir: "tests/browser",
  timeout: 30_000,
  expect: { timeout: 5_000 },
  retries: 0,
  forbidOnly: !!process.env.CI,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    timezoneId: "America/New_York",
    locale: "en-US",
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        launchOptions: executablePath ? { executablePath } : {},
      },
    },
  ],
  webServer: {
    command: `node tests/browser/serve.mjs ${PORT}`,
    url: `http://127.0.0.1:${PORT}/index.html`,
    reuseExistingServer: !process.env.CI,
  },
});
