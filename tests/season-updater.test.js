import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as MLBSnapshot from "../page/js/snapshot.js";
import { createReading } from "../page/js/readings.js";
import { loadCurrentSnapshot } from "../worker/src/season-updater.js";
import { SeasonStore } from "../worker/src/store.js";
import { createDurableObjectContext } from "./durable-object-context.js";

const EVENING = JSON.parse(
  readFileSync(`${import.meta.dirname}/fixtures/2026-09-24-evening.json`, "utf8"),
);
const NOW = Date.parse(EVENING.now);
const SNAPSHOT = MLBSnapshot.buildSnapshot(EVENING.responses, { season: 2026, now: NOW });
const TODAY = SNAPSHOT.slate.today.date;

function createUpdatingStore({ stored = {}, snapshot = SNAPSHOT, now = NOW } = {}) {
  const context = createDurableObjectContext();
  for (const [key, data] of Object.entries(stored)) context.stored.set(key, data);
  const harness = { snapshot, failure: null, requestedSeasons: [] };
  const loadSnapshot = async (season) => {
    harness.requestedSeasons.push(season);
    if (harness.failure) throw harness.failure;
    return structuredClone(harness.snapshot);
  };
  const sent = [];
  context.ctx.acceptWebSocket({ send: (message) => sent.push(JSON.parse(message)) });
  const store = new SeasonStore(context.ctx, {}, { loadSnapshot, now: () => now });
  return { store, context, harness, sent, read: (key) => context.stored.get(key) ?? null };
}

test("the first request starts the updates, and later ones leave the alarm alone", async () => {
  const { store, context } = createUpdatingStore();
  assert.equal(context.alarm.at, null);
  await store.fetch(new Request("https://store/store/seasons/2026"));
  assert.equal(context.alarm.at, NOW);

  context.alarm.at = NOW + 5000;
  await store.fetch(new Request("https://store/store/seasons/2026"));
  assert.equal(context.alarm.at, NOW + 5000);
});

test("an update saves the season, standings, and a reading, and tells open pages", async () => {
  const { store, context, sent, read } = createUpdatingStore();
  await store.alarm();

  const season = read("seasons/2026");
  assert.deepEqual(season.teams, SNAPSHOT.teams);
  assert.deepEqual(season.series, SNAPSHOT.series);
  assert.deepEqual(season.ranking, []);
  assert.deepEqual(read("standings/2026").divisions, SNAPSHOT.standings.divisions);
  assert.deepEqual(read(`readings-2026/${TODAY}-01`).start, createReading(SNAPSHOT));
  assert.deepEqual(read("live/status"), {
    error: "",
    detail: "",
    write: "",
    at: new Date(NOW).toISOString(),
  });
  assert.deepEqual(
    sent.map((message) => message.path),
    ["seasons/2026", `readings-2026/${TODAY}-01`, "standings/2026", "live/status"],
  );
  // A game is live, so the next update is thirty seconds out.
  assert.equal(context.alarm.at, NOW + MLBSnapshot.POLL_LIVE_MS);
});

test("an update keeps what the page saved, and writes nothing when nothing changed", async () => {
  const { store, sent, read } = createUpdatingStore({
    stored: { "seasons/2026": { year: 2026, ranking: ["NYY", "LAD"], seenAt: "2026-09-24" } },
  });
  await store.alarm();
  assert.deepEqual(read("seasons/2026").ranking, ["NYY", "LAD"]);
  assert.equal(read("seasons/2026").seenAt, "2026-09-24");

  sent.length = 0;
  await store.alarm();
  assert.deepEqual(sent, []);
});

test("a change in the field is saved as a new change in today's reading", async () => {
  const { store, harness, read } = createUpdatingStore();
  await store.alarm();
  const { PHI, ...teams } = SNAPSHOT.teams;
  harness.snapshot = { ...SNAPSHOT, teams: { ...teams, NYM: { ...PHI, w: 83, l: 76 } } };
  await store.alarm();

  assert.equal(read(`readings-2026/${TODAY}-01`).changes.length, 1);
  assert.ok("NYM" in read("seasons/2026").teams);
  assert.ok(!("PHI" in read("seasons/2026").teams));
});

test("readings older than two weeks go, and their updates stay in the saved log", async () => {
  const reading = createReading(SNAPSHOT);
  const oldStart = {
    ...reading,
    at: "2026-09-01T20:00:00Z",
    rows: { ...reading.rows, BAL: { ...reading.rows.BAL, wce: "1" } },
    games: {},
  };
  const elimination = { at: "2026-09-01T23:00:00Z", rows: { BAL: { wce: reading.rows.BAL.wce } } };
  const lastStart = { ...reading, at: elimination.at, games: {} };
  const { store, read } = createUpdatingStore({
    stored: {
      "readings-2026/2026-09-01-01": {
        id: "2026-09-01-01",
        day: "2026-09-01",
        number: 1,
        start: oldStart,
        changes: [elimination],
      },
      "readings-2026/2026-09-20-01": {
        id: "2026-09-20-01",
        day: "2026-09-20",
        number: 1,
        start: lastStart,
        changes: [],
      },
    },
  });
  await store.alarm();

  assert.equal(read("readings-2026/2026-09-01-01"), null);
  assert.notEqual(read("readings-2026/2026-09-20-01"), null);
  assert.deepEqual(
    read("seasons/2026").log.map((entry) => [entry.kind, entry.team, entry.at]),
    [["elim", "BAL", "2026-09-01T23:00:00Z"]],
  );
});

test("when MLB can't be read, the status says why and the retries back off", async () => {
  const { store, context, harness, read } = createUpdatingStore();
  harness.failure = new Error("MLB Stats API answered 503 for /api/v1/standings");
  await store.alarm();

  assert.equal(read("seasons/2026"), null);
  assert.deepEqual(read("live/status"), {
    error: "upstream_error",
    detail: "MLB Stats API answered 503 for /api/v1/standings",
    write: "",
    at: new Date(NOW).toISOString(),
  });
  assert.equal(context.alarm.at, NOW + 30e3);
  await store.alarm();
  assert.equal(context.alarm.at, NOW + 60e3);

  harness.failure = null;
  await store.alarm();
  assert.equal(read("live/status").error, "");
  assert.equal(context.alarm.at, NOW + MLBSnapshot.POLL_LIVE_MS);
});

test("the status names the fields MLB stopped sending", async () => {
  const { store, read } = createUpdatingStore({ snapshot: { ...SNAPSHOT, missing: ["gb"] } });
  await store.alarm();
  assert.deepEqual(read("live/status"), {
    error: "mlb_fields_missing",
    detail: "gb",
    write: "",
    at: new Date(NOW).toISOString(),
  });
});

test("with no games to follow, the next update is an hour out", async () => {
  const { store, context } = createUpdatingStore({ snapshot: { ...SNAPSHOT, slate: null } });
  await store.alarm();
  assert.equal(context.alarm.at, NOW + MLBSnapshot.POLL_CHECK_MS);
});

test("before April, the new season is followed once spring training has started", async () => {
  const february = Date.parse("2027-02-10T17:00:00Z");
  const requested = [];
  const loadSnapshot = (springStart) => async (season) => {
    requested.push(season);
    return { season, springStart };
  };

  const before = await loadCurrentSnapshot(loadSnapshot("2027-02-20"), february);
  assert.equal(before.season, 2026);
  assert.deepEqual(requested, [2027, 2026]);

  requested.length = 0;
  const after = await loadCurrentSnapshot(loadSnapshot("2027-02-05"), february);
  assert.equal(after.season, 2027);
  assert.deepEqual(requested, [2027]);
});
