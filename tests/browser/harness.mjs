import { readFileSync } from "node:fs";
import { test as base, expect } from "@playwright/test";
import * as MLBSnapshot from "../../page/js/snapshot.js";
import { SeasonStore } from "../../worker/src/store.js";
import { createDurableObjectContext } from "../durable-object-context.js";

const loadFixture = (name) =>
  JSON.parse(readFileSync(new URL(`../fixtures/${name}.json`, import.meta.url), "utf8"));
export const EVENING_FIXTURE = loadFixture("2026-09-24-evening");
const FINAL_2025_FIXTURE = loadFixture("2025-final");

export const buildFixtureSnapshot = (fixture) =>
  MLBSnapshot.buildSnapshot(fixture.responses, {
    season: fixture.season,
    now: Date.parse(fixture.now),
  });

// The first game still to come, Astros at Athletics, with both clubs' starters named.
export function buildSnapshotWithStarters() {
  const fixture = structuredClone(EVENING_FIXTURE);
  const game = fixture.responses.schedule.dates
    .flatMap((date) => date.games)
    .find((candidate) => candidate.gamePk === 824950);
  game.teams.away.probablePitcher = { id: 1 };
  game.teams.home.probablePitcher = { id: 2 };
  const describePerson = (id, useLastName, code, era) => ({
    id,
    useLastName,
    pitchHand: { code },
    stats: [{ splits: [{ stat: { era } }] }],
  });
  fixture.responses.pitchers = {
    people: [describePerson(1, "Blubaugh", "R", "3.66"), describePerson(2, "Springs", "L", "4.02")],
  };
  return buildFixtureSnapshot(fixture);
}

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

const isWriteRequest = (request) => request.method() !== "GET";

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

/**
 * The page as the Worker serves it, with the Worker's store and snapshot behind it.
 * @param {import("@playwright/test").Page} page
 * @param {object} [options]
 * @param {object} [options.store]
 * @param {string} [options.now]
 * @param {object} [options.snapshots]
 * @param {boolean} [options.liveAvailable]
 * @param {boolean} [options.portalReadsDocuments] a captive portal answers reading a document
 * @param {Record<number, object>} [options.pitchers] what the Worker answers for each pitcher id
 */
export async function openApp(
  page,
  {
    store = {},
    now = EVENING_FIXTURE.now,
    snapshots = {},
    liveAvailable = true,
    portalReadsDocuments = false,
    pitchers = {},
  } = {},
) {
  const context = createDurableObjectContext();
  for (const [path, data] of Object.entries(store)) context.stored.set(path, data);
  const snapshotsBySeason = {
    [EVENING_FIXTURE.season]: buildFixtureSnapshot(EVENING_FIXTURE),
    [FINAL_2025_FIXTURE.season]: buildFixtureSnapshot(FINAL_2025_FIXTURE),
    ...snapshots,
  };
  const harness = {
    snapshotRequests: 0,
    transformSnapshot: (snapshot) => snapshot,
    failWrites: false,
  };
  const fetchImpl = async () => new Response(null, { status: 201 });
  const loadSnapshot = async (season) =>
    harness.transformSnapshot(structuredClone(snapshotsBySeason[season]));
  const seasonStore = new SeasonStore(
    context.ctx,
    {},
    { loadSnapshot, now: () => Date.parse(now), fetchImpl },
  );
  const openSockets = [];

  await page.route(
    (url) => url.hostname !== "127.0.0.1",
    (route) => route.abort(),
  );
  await page.route(
    (url) => url.pathname === "/snapshot",
    (route) => {
      harness.snapshotRequests++;
      const season = new URL(route.request().url()).searchParams.get("season");
      const snapshot = snapshotsBySeason[season];
      if (!liveAvailable || !snapshot)
        return route.fulfill({ status: 502, json: { error: "Couldn't read MLB: test" } });
      return route.fulfill({ json: harness.transformSnapshot(structuredClone(snapshot)) });
    },
  );
  await page.route(
    (url) => url.pathname === "/pitcher",
    (route) => {
      const pitcher = pitchers[Number(new URL(route.request().url()).searchParams.get("id"))];
      if (!pitcher)
        return route.fulfill({ status: 502, json: { error: "Couldn't read MLB: test" } });
      return route.fulfill({ json: pitcher });
    },
  );
  await page.route(
    (url) => url.pathname.startsWith("/push/"),
    (route) => answerFromStore(route, seasonStore),
  );
  await page.route(
    (url) => url.pathname.startsWith("/store/"),
    (route) => {
      if (harness.failWrites && isWriteRequest(route.request()))
        return route.fulfill({ status: 503, json: { error: { code: "unavailable" } } });
      // A captive portal answers in place of the Worker.
      const isDocumentRead =
        route.request().method() === "GET" &&
        /^\/store\/[^/]+\/[^/]+$/.test(new URL(route.request().url()).pathname);
      if (portalReadsDocuments && isDocumentRead)
        return route.fulfill({ contentType: "text/html", body: "<h1>Sign in to Wi-Fi</h1>" });
      return answerFromStore(route, seasonStore);
    },
  );
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
    writeFromAnotherDevice: (path, data) => seasonStore.docs.write(path, data),
    // What the Worker's alarm does on its own schedule.
    updateFromWorker: () => seasonStore.alarm(),
    countSnapshotRequests: () => harness.snapshotRequests,
    countSubscriptions: () =>
      [...context.stored.keys()].filter((key) => key.startsWith("push:subscription:")).length,
    /** @param {(snapshot: any) => any} transform */
    changeSnapshots: (transform) => {
      harness.transformSnapshot = transform;
    },
    failWrites: () => {
      harness.failWrites = true;
    },
    countOpenSockets: () => openSockets.length,
    dropConnections: async () => {
      await Promise.all(openSockets.map((socket) => socket.close()));
      openSockets.length = 0;
      context.sockets.length = 0;
    },
  };
}

/** @param {import("@playwright/test").Page} page */
export const openSettings = (page) =>
  page.getByRole("button", { name: "Settings", exact: true }).click();

/**
 * Picks a season in the settings panel, then closes it.
 * @param {import("@playwright/test").Page} page
 * @param {string} year
 */
export async function chooseSeason(page, year) {
  await openSettings(page);
  await page.getByRole("combobox", { name: "Season" }).selectOption(year);
  await page.getByRole("button", { name: "Done" }).click();
}
