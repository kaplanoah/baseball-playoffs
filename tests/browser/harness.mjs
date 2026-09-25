import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { test as base, expect } from "@playwright/test";
import * as MLBSnapshot from "../../page/js/snapshot.js";
import { wrapPage } from "../../worker/src/page.js";
import { SeasonStore } from "../../worker/src/store.js";
import { createDurableObjectContext } from "../durable-object-context.js";

const loadFixture = (name) =>
  JSON.parse(readFileSync(new URL(`../fixtures/${name}.json`, import.meta.url), "utf8"));
export const EVENING_FIXTURE = loadFixture("2026-09-24-evening");
const FINAL_2025_FIXTURE = loadFixture("2025-final");
const FIXTURES_BY_SEASON = {
  [EVENING_FIXTURE.season]: EVENING_FIXTURE,
  [FINAL_2025_FIXTURE.season]: FINAL_2025_FIXTURE,
};

const RUNTIME_SCRIPT_PATH = fileURLToPath(new URL("runtime.js", import.meta.url));
const PAGE_HTML = readFileSync(new URL("../../page/index.html", import.meta.url), "utf8");

export const buildFixtureSnapshot = (fixture) =>
  MLBSnapshot.buildSnapshot(fixture.responses, {
    season: fixture.season,
    now: Date.parse(fixture.now),
  });

/** @type {import("@playwright/test").Fixtures<{ pageErrors: string[] }, {}, import("@playwright/test").PlaywrightTestArgs>} */
const pageErrorsFixture = {
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

export const test = base.extend(pageErrorsFixture);
export { expect };

const SEASON_PATH = /^\/api\/v1\/seasons\/(\d{4})$/;

function findRecordedResponse(url) {
  const seasonPathMatch = SEASON_PATH.exec(url.pathname);
  if (seasonPathMatch) return FIXTURES_BY_SEASON[seasonPathMatch[1]].responses.season;
  const season = url.searchParams.get("season") || url.searchParams.get("startDate").slice(0, 4);
  const { responses } = FIXTURES_BY_SEASON[season];
  const responseName = {
    "/api/v1/standings": "standings",
    "/api/v1/schedule/postseason": "postseason",
    "/api/v1/schedule": "schedule",
  }[url.pathname];
  return responses[responseName];
}

async function routeMlbToFixtures(page, { directAllowed }) {
  const counter = { requests: 0 };
  await page.route(
    (url) => url.hostname !== "127.0.0.1",
    (route) => {
      const url = new URL(route.request().url());
      if (url.hostname !== "statsapi.mlb.com") return route.abort();
      counter.requests++;
      if (!directAllowed) return route.abort();
      return route.fulfill({ json: findRecordedResponse(url) });
    },
  );
  return counter;
}

// Refused hosts reach the page as a TypeError from fetch, as in the artifact sandbox.
export async function openApp(
  page,
  {
    store = {},
    connectorAdded = true,
    directAllowed = false,
    dbAvailable = true,
    now = EVENING_FIXTURE.now,
    extraSnapshots = {},
  } = {},
) {
  const mlbRequests = await routeMlbToFixtures(page, { directAllowed });
  await page.clock.install({ time: new Date(now) });
  await page.addInitScript((config) => (window.__runtimeConfig = config), {
    store,
    snapshots: {
      ...Object.fromEntries(
        Object.entries(FIXTURES_BY_SEASON).map(([season, fixture]) => [
          season,
          buildFixtureSnapshot(fixture),
        ]),
      ),
      ...extraSnapshots,
    },
    connectorAdded,
    dbAvailable,
  });
  await page.addInitScript({ path: RUNTIME_SCRIPT_PATH });
  await page.goto("/");

  return {
    readDocument: (path) =>
      page.evaluate((documentPath) => window.__runtime.read(documentPath), path),
    countToolCalls: () => page.evaluate(() => window.__runtime.toolCalls.length),
    countMlbRequests: () => mlbRequests.requests,
  };
}

async function answerFromStore(route, store) {
  const request = route.request();
  const answer = await store.fetch(
    new Request(request.url(), {
      method: request.method(),
      headers: request.headers(),
      body: request.postData() ?? undefined,
    }),
  );
  await route.fulfill({
    status: answer.status,
    headers: Object.fromEntries(answer.headers),
    body: Buffer.from(await answer.arrayBuffer()),
  });
}

// The page as the Worker serves it: no claude.ai runtime, and the Worker's store behind it.
export async function openSelfHostedApp(page, { store = {}, now = EVENING_FIXTURE.now } = {}) {
  const context = createDurableObjectContext();
  for (const [path, data] of Object.entries(store)) context.stored.set(path, data);
  const seasonStore = new SeasonStore(context.ctx, {});

  await routeMlbToFixtures(page, { directAllowed: false });
  await page.route(
    (url) => url.pathname === "/snapshot",
    (route) => {
      const season = new URL(route.request().url()).searchParams.get("season");
      return route.fulfill({ json: buildFixtureSnapshot(FIXTURES_BY_SEASON[season]) });
    },
  );
  await page.route(
    (url) => url.pathname === "/",
    (route) =>
      route.fulfill({
        contentType: "text/html",
        body: wrapPage(PAGE_HTML),
      }),
  );
  await page.route(
    (url) => url.pathname.startsWith("/store/"),
    (route) => answerFromStore(route, seasonStore),
  );
  const openSockets = [];
  await page.routeWebSocket(
    (url) => url.pathname === "/watch",
    (socket) => {
      openSockets.push(socket);
      context.ctx.acceptWebSocket({ send: (message) => socket.send(message) });
    },
  );
  await page.clock.install({ time: new Date(now) });
  await page.goto("/");

  return {
    readDocument: async (path) => (await context.ctx.storage.get(path)) ?? null,
    writeFromAnotherDevice: (path, data) =>
      seasonStore.fetch(
        new Request(`http://127.0.0.1/store/${path}`, {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(data),
        }),
      ),
    countOpenSockets: () => openSockets.length,
    dropConnections: async () => {
      await Promise.all(openSockets.map((socket) => socket.close()));
      openSockets.length = 0;
      context.sockets.length = 0;
    },
  };
}
