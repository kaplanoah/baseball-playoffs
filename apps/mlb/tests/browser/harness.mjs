import { readFileSync } from "node:fs";
import * as MLBSnapshot from "../../page/js/snapshot.js";
import { SeasonStore } from "../../worker/src/store.js";
import {
  test,
  expect,
  createTestStore,
  connectToStore,
  loadPageAt,
} from "../../../../tests/browser/harness.mjs";
import { holdStore } from "../../../../tests/browser/hold-store.mjs";

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

export { test, expect };

const isWriteRequest = (request) => request.method() !== "GET";

/**
 * The page as the Worker serves it, with the Worker's store and snapshot behind it.
 * @param {import("@playwright/test").Page} page
 * @param {object} [options]
 * @param {Record<string, object>} [options.store] documents by path
 * @param {string} [options.now]
 * @param {object} [options.snapshots]
 * @param {boolean} [options.liveAvailable]
 * @param {boolean} [options.portalReadsDocuments] a captive portal answers reading a document
 * @param {Record<number, object>} [options.pitchers] what the Worker answers for each pitcher id
 * @param {Record<string, object>} [options.rotations] what the Worker answers for each club's last
 *   starters
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
    rotations = {},
  } = {},
) {
  const snapshotsBySeason = {
    [EVENING_FIXTURE.season]: buildFixtureSnapshot(EVENING_FIXTURE),
    [FINAL_2025_FIXTURE.season]: buildFixtureSnapshot(FINAL_2025_FIXTURE),
    ...snapshots,
  };
  const harness = {
    snapshotRequests: 0,
    storeReads: [],
    transformSnapshot: (snapshot) => snapshot,
    failWrites: false,
  };
  const loadSnapshot = async (season) =>
    harness.transformSnapshot(structuredClone(snapshotsBySeason[season]));
  const testStore = createTestStore(SeasonStore, { loadSnapshot, now, stored: store });
  const { context, store: seasonStore } = testStore;

  const openSockets = await connectToStore(page, testStore);
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
    (url) => url.pathname === "/rotation",
    (route) => {
      const rotation = rotations[new URL(route.request().url()).searchParams.get("club")];
      if (!rotation)
        return route.fulfill({ status: 502, json: { error: "Couldn't read MLB: test" } });
      return route.fulfill({ json: rotation });
    },
  );
  await page.route(
    (url) => url.pathname.startsWith("/store/"),
    (route) => {
      const url = new URL(route.request().url());
      if (!isWriteRequest(route.request())) harness.storeReads.push(url.pathname + url.search);
      if (harness.failWrites && isWriteRequest(route.request()))
        return route.fulfill({ status: 503, json: { error: { code: "unavailable" } } });
      // A captive portal answers in place of the Worker.
      const isDocumentRead =
        route.request().method() === "GET" && /^\/store\/[^/]+\/[^/]+$/.test(url.pathname);
      if (portalReadsDocuments && isDocumentRead)
        return route.fulfill({ contentType: "text/html", body: "<h1>Sign in to Wi-Fi</h1>" });
      return route.fallback();
    },
  );
  await loadPageAt(page, now);

  return {
    readDocument: async (path) => (await context.ctx.storage.get(path)) ?? null,
    writeFromAnotherDevice: (path, data) => seasonStore.docs.write(path, data),
    // A change the page's socket never hears of, as when a phone sleeps through it.
    writeWhileAway: (path, data) => context.ctx.storage.put(path, data),
    holdStore: () => holdStore(page),
    // What the Worker's alarm does on its own schedule.
    updateFromWorker: () => seasonStore.alarm(),
    countSnapshotRequests: () => harness.snapshotRequests,
    listStoreReads: () => [...harness.storeReads],
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

/**
 * Swipes a finger down a sheet from `target`, one step per move. It runs inside the page
 * so the time between moves is exact, which the sheet reads as the swipe's speed.
 * @param {import("@playwright/test").Page} page
 * @param {{ target: string, distance: number, steps: number, stepMs: number, isCancelled?: boolean }} swipe
 */
export const swipeSheetDown = (page, { target, distance, steps, stepMs, isCancelled = false }) =>
  page
    .locator(target)
    .first()
    .evaluate(
      (element, { distance, steps, stepMs, isCancelled }) => {
        const box = element.getBoundingClientRect();
        const x = box.x + box.width / 2;
        const startY = box.y + box.height / 2;
        const send = (type, y) => {
          const touch = new Touch({ identifier: 1, target: element, clientX: x, clientY: y });
          const isLifted = type === "touchend" || type === "touchcancel";
          const init = { changedTouches: [touch], bubbles: true, cancelable: true };
          element.dispatchEvent(
            new TouchEvent(type, { ...init, touches: isLifted ? [] : [touch] }),
          );
        };
        const wait = () => {
          const until = performance.now() + stepMs;
          while (performance.now() < until);
        };
        send("touchstart", startY);
        for (let step = 1; step <= steps; step++) {
          wait();
          send("touchmove", startY + (distance * step) / steps);
        }
        wait();
        send(isCancelled ? "touchcancel" : "touchend", startY + distance);
      },
      { distance, steps, stepMs, isCancelled },
    );

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
  await page.keyboard.press("Escape");
}
