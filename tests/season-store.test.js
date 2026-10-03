import test, { mock } from "node:test";
import assert from "node:assert/strict";
import { createSeasonStore } from "../shared/worker/season-store.js";
import { createDurableObjectContext } from "./durable-object-context.js";

const ORIGIN = "https://app.example";

// A league with nothing to update, whose page saves only when updates were last seen.
const QUIET_LEAGUE = {
  pageFields: { seenAt: (value) => typeof value === "string" },
  createLoadSnapshot: () => async () => ({}),
  loadCurrentSnapshot: async () => ({ season: 2026 }),
  readUpdates: async () => null,
  saveSnapshot: async () => {},
  describeSnapshotStatus: () => ({ error: "" }),
  choosePollDelay: () => 60_000,
  listNotifications: () => [],
};

const NOW = Date.parse("2026-09-30T20:00:00Z");

const patchSeason = (store, body) =>
  store.fetch(
    new Request(`${ORIGIN}/store/seasons/2026`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );

test("a store saves only the page fields its league names", async () => {
  const context = createDurableObjectContext();
  const SeasonStore = createSeasonStore(QUIET_LEAGUE);
  const store = new SeasonStore(context.ctx, {});

  assert.equal((await patchSeason(store, { seenAt: "2026-09-30T20:00:00Z" })).status, 204);
  assert.deepEqual(await context.ctx.storage.get("seasons/2026"), {
    seenAt: "2026-09-30T20:00:00Z",
    year: 2026,
  });

  const refused = await patchSeason(store, { ranking: ["NYL"] });
  assert.equal(refused.status, 400);
  assert.equal((await refused.json()).error.message, "A season takes only seenAt.");
});

test("a store waits as long as its league says before the next update", async () => {
  const context = createDurableObjectContext();
  const SeasonStore = createSeasonStore(QUIET_LEAGUE);
  const store = new SeasonStore(context.ctx, {}, { now: () => NOW });

  await store.alarm();

  assert.equal(await context.ctx.storage.getAlarm(), NOW + 60_000);
});

test("a store whose league's page saves nothing refuses every change", async () => {
  const SeasonStore = createSeasonStore({ ...QUIET_LEAGUE, pageFields: {} });
  const store = new SeasonStore(createDurableObjectContext().ctx, {});

  const refused = await patchSeason(store, { seenAt: "2026-09-30T20:00:00Z" });

  assert.equal(refused.status, 403);
  assert.equal((await refused.json()).error.message, "The page saves nothing here.");
});

test("a store saves the status of each update, with blanks for what it doesn't say", async () => {
  const context = createDurableObjectContext();
  const SeasonStore = createSeasonStore({
    ...QUIET_LEAGUE,
    describeSnapshotStatus: () => ({ error: "feeds_missing", detail: "standings" }),
    statusFields: { standIn: "" },
  });
  const store = new SeasonStore(context.ctx, {}, { now: () => NOW });

  await store.alarm();

  assert.deepEqual(await context.ctx.storage.get("live/status"), {
    at: "2026-09-30T20:00:00.000Z",
    detail: "standings",
    error: "feeds_missing",
    standIn: "",
    write: "",
  });
});

test("a store leaves the saved status alone while it says the same", async () => {
  const context = createDurableObjectContext();
  let now = NOW;
  const SeasonStore = createSeasonStore(QUIET_LEAGUE);
  const store = new SeasonStore(context.ctx, {}, { now: () => now });

  await store.alarm();
  now += 60_000;
  await store.alarm();

  assert.equal((await context.ctx.storage.get("live/status")).at, "2026-09-30T20:00:00.000Z");
});

test("a status saved before its league had a field reads that field as blank", async () => {
  const context = createDurableObjectContext();
  const saved = { at: "2026-09-30T19:00:00.000Z", detail: "", error: "", write: "" };
  await context.ctx.storage.put("live/status", saved);
  const SeasonStore = createSeasonStore({ ...QUIET_LEAGUE, statusFields: { standIn: "" } });
  const store = new SeasonStore(context.ctx, {}, { now: () => NOW });

  await store.alarm();

  assert.deepEqual(await context.ctx.storage.get("live/status"), saved);
});

test("a store that can't read its league says why and waits longer after each failure", async () => {
  const context = createDurableObjectContext();
  const SeasonStore = createSeasonStore({
    ...QUIET_LEAGUE,
    loadCurrentSnapshot: async () => {
      throw new Error("The league answered 503");
    },
  });
  const store = new SeasonStore(context.ctx, {}, { now: () => NOW });
  context.ctx.acceptWebSocket({ send: () => {} });

  const waits = [];
  for (let attempt = 0; attempt < 6; attempt += 1) {
    await store.alarm();
    waits.push((await context.ctx.storage.getAlarm()) - NOW);
  }

  assert.deepEqual(waits, [30e3, 60e3, 2 * 60e3, 5 * 60e3, 10 * 60e3, 10 * 60e3]);
  assert.deepEqual(await context.ctx.storage.get("live/status"), {
    at: "2026-09-30T20:00:00.000Z",
    detail: "The league answered 503",
    error: "upstream_error",
    write: "",
  });
});

const MINUTE_MS = 60 * 1000;

/**
 * A store with the clock at `clock.now`, and pages that open through `openPage`.
 * @param {Partial<typeof QUIET_LEAGUE>} league
 */
function createWatchedStore(league) {
  const context = createDurableObjectContext();
  const SeasonStore = createSeasonStore({ ...QUIET_LEAGUE, ...league });
  const clock = { now: NOW };
  const openSocket = (ctx) => {
    ctx.acceptWebSocket({ send: () => {} });
    return new Response(null);
  };
  const store = new SeasonStore(context.ctx, {}, { now: () => clock.now, openSocket });
  const openPage = () =>
    store.fetch(new Request(`${ORIGIN}/watch`, { headers: { upgrade: "websocket" } }));
  return { context, clock, store, openPage };
}

test("with no page open, a store updates at most every fifty seconds", async () => {
  const { context, store, openPage } = createWatchedStore({ choosePollDelay: () => 15_000 });

  await store.alarm();
  assert.equal(context.alarm.at, NOW + 50_000);

  await openPage();
  await store.alarm();
  assert.equal(context.alarm.at, NOW + 15_000);
});

test("a page that opens brings the next update to when an open page would have had it", async () => {
  const { context, clock, store, openPage } = createWatchedStore({
    choosePollDelay: () => 15_000,
  });
  await store.alarm();

  clock.now = NOW + 5_000;
  await openPage();
  assert.equal(context.alarm.at, NOW + 15_000);
});

test("a page that opens has the season updated once it's fifteen minutes old", async () => {
  for (const [openedAfter, updatedAfter] of [
    [5 * MINUTE_MS, 15 * MINUTE_MS],
    [20 * MINUTE_MS, 20 * MINUTE_MS],
  ]) {
    const { context, clock, store, openPage } = createWatchedStore({
      choosePollDelay: () => 24 * 60 * MINUTE_MS,
    });
    await store.alarm();

    clock.now = NOW + openedAfter;
    await openPage();
    assert.equal(context.alarm.at, NOW + updatedAfter);
  }
});

test("a page that opens while the league isn't answering still waits out the retry", async () => {
  const { context, clock, store, openPage } = createWatchedStore({
    loadCurrentSnapshot: async () => {
      throw new Error("The league answered 503");
    },
  });
  await store.alarm();
  assert.equal(context.alarm.at, NOW + 50_000);

  clock.now = NOW + 10_000;
  await openPage();
  assert.equal(context.alarm.at, NOW + 30_000);
});

test("a store answers a page's close, so the socket stops counting as an open page", () => {
  const { store } = createWatchedStore({});
  let closes = 0;
  store.webSocketClose({
    close: () => {
      closes += 1;
    },
  });
  assert.equal(closes, 1);
});

/** A page's socket, as the store sees it, keeping what the page said it watches. */
function createPageSocket() {
  const sent = [];
  let attachment = null;
  return {
    sent,
    send: (message) => sent.push(JSON.parse(message).path),
    serializeAttachment: (value) => {
      attachment = structuredClone(value);
    },
    deserializeAttachment: () => attachment,
  };
}

test("a page that says what it watches hears only of changes to those documents", async () => {
  const context = createDurableObjectContext();
  const SeasonStore = createSeasonStore(QUIET_LEAGUE);
  const store = new SeasonStore(context.ctx, {});
  const watching = createPageSocket();
  const unsaid = createPageSocket();
  context.ctx.acceptWebSocket(watching);
  context.ctx.acceptWebSocket(unsaid);

  store.webSocketMessage(
    watching,
    JSON.stringify({ watching: ["seasons/2026", "readings-2026/"] }),
  );
  store.webSocketMessage(watching, JSON.stringify({ watching: ["not a path!"] }));
  store.webSocketMessage(watching, "not JSON");
  for (const path of ["seasons/2026", "readings-2026/2026-09-30-01", "standings/2026"])
    await store.docs.write(path, { year: 2026 });

  assert.deepEqual(watching.sent, ["seasons/2026", "readings-2026/2026-09-30-01"]);
  assert.deepEqual(unsaid.sent, ["seasons/2026", "readings-2026/2026-09-30-01", "standings/2026"]);
});

test("each update reads the details of the games pages have open, and saves them when they change", async () => {
  const context = createDurableObjectContext();
  const loads = [];
  const details = { 1: { score: 10 }, 2: { score: 20 } };
  const SeasonStore = createSeasonStore({ ...QUIET_LEAGUE, detailsCollection: "games" });
  const store = new SeasonStore(
    context.ctx,
    {},
    {
      now: () => NOW,
      loadDetails: async (id, snapshot, stored) => {
        loads.push({ id, season: snapshot.season, stored });
        return details[id];
      },
    },
  );
  const page = createPageSocket();
  context.ctx.acceptWebSocket(page);
  store.webSocketMessage(page, JSON.stringify({ watching: ["games/1", "seasons/2026"] }));

  await store.alarm();
  assert.deepEqual(loads, [{ id: "1", season: 2026, stored: null }]);
  assert.deepEqual(await context.ctx.storage.get("games/1"), { score: 10 });
  assert.deepEqual(page.sent, ["games/1"]);

  await store.alarm();
  assert.deepEqual(loads[1].stored, { score: 10 });
  assert.deepEqual(page.sent, ["games/1"]);
});

test("a game's details that fail to load leave the saved ones and don't hold up the update", async () => {
  const context = createDurableObjectContext();
  const SeasonStore = createSeasonStore({ ...QUIET_LEAGUE, detailsCollection: "games" });
  const store = new SeasonStore(
    context.ctx,
    {},
    {
      now: () => NOW,
      loadDetails: async () => {
        throw new Error("The league answered 503");
      },
    },
  );
  context.stored.set("games/1", { score: 10 });
  const page = createPageSocket();
  context.ctx.acceptWebSocket(page);
  store.webSocketMessage(page, JSON.stringify({ watching: ["games/1"] }));
  const logged = mock.method(console, "error", () => {});

  await store.alarm();

  logged.mock.restore();
  assert.deepEqual(await context.ctx.storage.get("games/1"), { score: 10 });
  assert.equal(await context.ctx.storage.getAlarm(), NOW + 60_000);
});

test("a store saves which season is current, and saves it again only when it changes", async () => {
  const context = createDurableObjectContext();
  let season = 2026;
  const SeasonStore = createSeasonStore({
    ...QUIET_LEAGUE,
    loadCurrentSnapshot: async () => ({ season }),
  });
  const store = new SeasonStore(context.ctx, {}, { now: () => NOW });
  const page = createPageSocket();
  context.ctx.acceptWebSocket(page);

  await store.alarm();
  await store.alarm();
  season = 2027;
  await store.alarm();

  assert.deepEqual(await context.ctx.storage.get("live/current"), { season: 2027 });
  assert.deepEqual(
    page.sent.filter((path) => path === "live/current"),
    ["live/current", "live/current"],
  );
});
