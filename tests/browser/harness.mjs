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
 * @param {{ store?: object, now?: string, snapshots?: object, liveAvailable?: boolean }} [options]
 */
export async function openApp(
  page,
  { store = {}, now = EVENING_FIXTURE.now, snapshots = {}, liveAvailable = true } = {},
) {
  const context = createDurableObjectContext();
  for (const [path, data] of Object.entries(store)) context.stored.set(path, data);
  const seasonStore = new SeasonStore(context.ctx, {});
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
    (url) => url.pathname.startsWith("/store/"),
    (route) => {
      if (harness.failWrites && isWriteRequest(route.request()))
        return route.fulfill({ status: 503, json: { error: { code: "unavailable" } } });
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
    writeFromAnotherDevice: (path, data) =>
      seasonStore.fetch(
        new Request(`http://127.0.0.1/store/${path}`, {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(data),
        }),
      ),
    countSnapshotRequests: () => harness.snapshotRequests,
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
