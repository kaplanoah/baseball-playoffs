import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { test as base, expect } from "@playwright/test";

const require = createRequire(import.meta.url);
const MLBSnapshot = require("../../page/js/snapshot.js");

const loadFixture = (name) => require(`../fixtures/${name}.json`);
export const EVENING = loadFixture("2026-09-24-evening");
const FINAL_2025 = loadFixture("2025-final");
const FIXTURES = { [EVENING.season]: EVENING, [FINAL_2025.season]: FINAL_2025 };

const RUNTIME = fileURLToPath(new URL("runtime.js", import.meta.url));

export const buildFixtureSnapshot = (fixture) =>
  MLBSnapshot.buildSnapshot(fixture.responses, {
    season: fixture.season,
    now: Date.parse(fixture.now),
  });

export const test = base.extend({
  pageErrors: [
    async ({ page }, use) => {
      const errors = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await use(errors);
      expect(errors).toEqual([]);
    },
    { auto: true },
  ],
});
export { expect };

function findRecordedResponse(url) {
  const season = url.searchParams.get("season") || url.searchParams.get("startDate").slice(0, 4);
  const { responses } = FIXTURES[season];
  const name = {
    "/api/v1/standings": "standings",
    "/api/v1/schedule/postseason": "postseason",
    "/api/v1/schedule": "schedule",
  }[url.pathname];
  return responses[name];
}

// Refused hosts reach the page as a TypeError from fetch, as in the artifact sandbox.
export async function openApp(
  page,
  { store = {}, connectorAdded = true, directAllowed = false } = {},
) {
  let mlbRequests = 0;
  await page.route(
    (url) => url.hostname !== "127.0.0.1",
    (route) => {
      const url = new URL(route.request().url());
      if (url.hostname !== "statsapi.mlb.com") return route.abort();
      mlbRequests++;
      if (!directAllowed) return route.abort();
      return route.fulfill({ json: findRecordedResponse(url) });
    },
  );
  await page.clock.install({ time: new Date(EVENING.now) });
  await page.addInitScript((config) => (window.__runtimeConfig = config), {
    store,
    fixtures: FIXTURES,
    connectorAdded,
  });
  await page.addInitScript({ path: RUNTIME });
  await page.goto("/");

  return {
    read: (path) => page.evaluate((documentPath) => window.__runtime.read(documentPath), path),
    countToolCalls: () => page.evaluate(() => window.__runtime.toolCalls.length),
    countMlbRequests: () => mlbRequests,
  };
}
