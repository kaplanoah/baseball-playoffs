import { existsSync } from "node:fs";
import { defineConfig, devices } from "@playwright/test";
import { listApps } from "./worker/apps.mjs";

const FIRST_PORT = 4173;
const executablePath = process.env.CHROMIUM_PATH;

// Each app with browser tests gets its own project, served from its own port.
const appsWithBrowserTests = listApps().filter((app) =>
  existsSync(new URL(`apps/${app}/tests/browser/`, import.meta.url)),
);
const findPort = (index) => FIRST_PORT + index;

export default defineConfig({
  timeout: 30_000,
  expect: { timeout: 5_000 },
  retries: 0,
  forbidOnly: !!process.env.CI,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: {
    // Tests expect Eastern times unless they pick another zone with test.use({ timezoneId }).
    timezoneId: "America/New_York",
    locale: "en-US",
    trace: "retain-on-failure",
  },
  projects: appsWithBrowserTests.map((app, index) => ({
    name: app,
    testDir: `apps/${app}/tests/browser`,
    use: {
      ...devices["Desktop Chrome"],
      baseURL: `http://127.0.0.1:${findPort(index)}`,
      launchOptions: executablePath ? { executablePath } : {},
    },
  })),
  webServer: appsWithBrowserTests.map((app, index) => ({
    command: `node tests/browser/serve.mjs ${findPort(index)} apps/${app}/page`,
    url: `http://127.0.0.1:${findPort(index)}/index.html`,
    reuseExistingServer: !process.env.CI,
  })),
});
