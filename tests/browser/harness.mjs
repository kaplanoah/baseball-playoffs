import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { test as base, expect } from "@playwright/test";
import * as MLBSnapshot from "../../page/js/snapshot.js";

const loadFixture = (name) =>
  JSON.parse(readFileSync(new URL(`../fixtures/${name}.json`, import.meta.url), "utf8"));
export const EVENING = loadFixture("2026-09-24-evening");
const FINAL_2025 = loadFixture("2025-final");
const FIXTURES = { [EVENING.season]: EVENING, [FINAL_2025.season]: FINAL_2025 };

const RUNTIME = fileURLToPath(new URL("runtime.js", import.meta.url));

export const buildFixtureSnapshot = (fixture) =>
  MLBSnapshot.buildSnapshot(fixture.responses, {
    season: fixture.season,
    now: Date.parse(fixture.now),
  });

/** @type {import("@playwright/test").Fixtures<{ pageErrors: string[] }, {}, import("@playwright/test").PlaywrightTestArgs>} */
const failOnPageErrors = {
  pageErrors: [
    async ({ page }, use) => {
      const errors = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await use(errors);
      expect(errors).toEqual([]);
    },
    { auto: true },
  ],
};

export const test = base.extend(failOnPageErrors);
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
    snapshots: Object.fromEntries(
      Object.entries(FIXTURES).map(([season, fixture]) => [season, buildFixtureSnapshot(fixture)]),
    ),
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
