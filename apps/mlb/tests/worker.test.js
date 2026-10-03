import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import * as MLBSnapshot from "../page/js/snapshot.js";
import { createSnapshotServer } from "../worker/src/snapshot.js";

const EVENING = JSON.parse(
  readFileSync(path.join(import.meta.dirname, "fixtures/2026-09-24-evening.json"), "utf8"),
);
const NOW = Date.parse(EVENING.now);

/** @param {string} url */
const nameRequest = (url) =>
  url.includes("/seasons/")
    ? "season"
    : url.includes("/standings")
      ? "standings"
      : url.includes("/postseason")
        ? "postseason"
        : "schedule";

/** @param {{ status?: number, answers?: Record<string, any> }} [options] */
function createFakeMlb({ status = 200, answers = {} } = {}) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    const kind = nameRequest(url);
    return new Response(JSON.stringify(answers[kind] ?? EVENING.responses[kind]), { status });
  };
  /** @param {string} kind */
  const countCalls = (kind) => calls.filter((call) => nameRequest(call.url) === kind).length;
  return { fetchImpl, calls, countCalls };
}

/** @param {Parameters<typeof createFakeMlb>[0]} [options] */
function createTestServer(options = {}) {
  const mlb = createFakeMlb(options);
  let now = NOW;
  const server = createSnapshotServer({ fetchImpl: mlb.fetchImpl, now: () => now });
  return {
    mlb,
    server,
    requestSnapshot: (query = "?season=2026") =>
      server.serveSnapshot(new URL(`https://mlb-live.example/k3y/snapshot${query}`)),
    advanceClock: (milliseconds) => {
      now += milliseconds;
    },
  };
}

test("the snapshot is built from MLB, with a timeout and a short edge cache", async () => {
  const { mlb, requestSnapshot } = createTestServer();
  const response = await requestSnapshot();
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  const expected = MLBSnapshot.buildSnapshot(EVENING.responses, { season: 2026, now: NOW });
  assert.deepEqual(await response.json(), expected);
  assert.equal(mlb.calls.length, 4);
  assert.equal(mlb.calls[0].init.cf.cacheTtl, 15);
  assert.ok(mlb.calls[0].init.signal);
});

test("season defaults to this year", async () => {
  const { requestSnapshot } = createTestServer();
  assert.equal((await (await requestSnapshot("")).json()).season, 2026);
});

test("pages polling together share one trip to MLB", async () => {
  const { mlb, requestSnapshot, advanceClock } = createTestServer();
  await Promise.all([1, 2, 3].map(() => requestSnapshot()));
  assert.equal(mlb.calls.length, 4);
  advanceClock(11000);
  await requestSnapshot();
  assert.equal(mlb.calls.length, 5);
});

const HOUR_MS = 60 * 60 * 1000;
const SLOW_REQUESTS = ["season", "standings", "postseason"];

test("only the schedule is read every time, the postseason hourly, and the rest daily", async () => {
  const { mlb, requestSnapshot, advanceClock } = createTestServer();
  await requestSnapshot();

  advanceClock(HOUR_MS);
  await requestSnapshot();
  assert.deepEqual(["schedule", ...SLOW_REQUESTS].map(mlb.countCalls), [2, 1, 1, 2]);

  advanceClock(23 * HOUR_MS);
  await requestSnapshot();
  assert.deepEqual(["schedule", ...SLOW_REQUESTS].map(mlb.countCalls), [3, 2, 2, 3]);
});

/** @param {any} schedule */
function finishLiveGame(schedule) {
  const finished = structuredClone(schedule);
  const live = finished.dates
    .flatMap((day) => day.games)
    .find((game) => game.status.abstractGameState === "Live");
  Object.assign(live.status, { abstractGameState: "Final", codedGameState: "F" });
  return finished;
}

test("a game that ends has the slow requests read again at once, and once more ten minutes on", async () => {
  const answers = {};
  const { mlb, requestSnapshot, advanceClock } = createTestServer({ answers });
  await requestSnapshot();

  answers.schedule = finishLiveGame(EVENING.responses.schedule);
  advanceClock(30 * 1000);
  await requestSnapshot();
  await requestSnapshot();
  advanceClock(30 * 1000);
  await requestSnapshot();
  assert.deepEqual(SLOW_REQUESTS.map(mlb.countCalls), [1, 2, 2]);

  advanceClock(10 * 60 * 1000);
  await requestSnapshot();
  assert.deepEqual(SLOW_REQUESTS.map(mlb.countCalls), [1, 3, 3]);
});

test("a past season read whole is kept", async () => {
  const { mlb, server, advanceClock } = createTestServer();
  await server.loadSnapshot(2025);
  const reads = mlb.calls.length;

  advanceClock(24 * HOUR_MS);
  await server.loadSnapshot(2025);
  assert.equal(mlb.calls.length, reads);
});

test("a past season read while a request failed is read again, and kept once it's whole", async () => {
  const answers = { standings: { records: "not standings" } };
  const { mlb, server, advanceClock } = createTestServer({ answers });
  const partial = await server.loadSnapshot(2025);
  assert.ok(partial.missing.length > 0);

  delete answers.standings;
  advanceClock(25 * HOUR_MS);
  const whole = await server.loadSnapshot(2025);
  assert.deepEqual(whole.missing, []);
  const reads = mlb.calls.length;

  advanceClock(24 * HOUR_MS);
  await server.loadSnapshot(2025);
  assert.equal(mlb.calls.length, reads);
});

test("a season that isn't a whole year in range is refused before anything is fetched", async () => {
  const { mlb, requestSnapshot } = createTestServer();
  for (const query of ["?season=abc", "?season=2026.5", "?season=1800", "?season="]) {
    const response = await requestSnapshot(query);
    assert.equal(response.status, 400, query);
    assert.match((await response.json()).error, /season must be a whole year/);
  }
  assert.equal(mlb.calls.length, 0);
});

test("MLB failing is reported, and not remembered", async () => {
  const { requestSnapshot } = createTestServer({ status: 503 });
  const response = await requestSnapshot();
  assert.equal(response.status, 502);
  assert.match((await response.json()).error, /MLB Stats API answered 503/);
});

test("the deployable bundle builds and exports the Worker and its store", async () => {
  const { buildWorker } = await import("../../../worker/build.mjs");
  const bundle = await import(
    `data:text/javascript,${encodeURIComponent(await buildWorker("mlb"))}`
  );
  assert.equal(typeof bundle.default.fetch, "function");
  assert.equal(typeof bundle.SeasonStore, "function");
});

const importBundle = async (script) => import(`data:text/javascript,${encodeURIComponent(script)}`);
const requestVersion = (bundle) =>
  bundle.default.fetch(new Request("https://mlb-live.example/k3y/version.json"), {
    APP_KEY: "k3y",
  });

test("the bundle serves the release it was built from", async () => {
  const { buildWorker } = await import("../../../worker/build.mjs");
  const release = { version: "2.13.0", commit: "abc1234", builtAt: "2026-09-28T00:10:41.000Z" };
  const response = await requestVersion(await importBundle(await buildWorker("mlb", { release })));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-type"), "application/json");
  assert.deepEqual(await response.json(), release);
});

test("a bundle built without a release has no version file", async () => {
  const { buildWorker } = await import("../../../worker/build.mjs");
  const response = await requestVersion(
    await importBundle(await buildWorker("mlb", { release: null })),
  );
  assert.equal(response.status, 404);
});

test("the release names the version, the commit, and when it was built", async () => {
  const { readRelease } = await import("../../../worker/build.mjs");
  const git = (args) => (args[0] === "log" && args[1] === "-1" ? "b102733\n" : "");
  assert.deepEqual(readRelease("mlb", git, new Date("2026-09-28T00:10:41Z")), {
    version: "2.32.2",
    commit: "b102733",
    builtAt: "2026-09-28T00:10:41.000Z",
  });
});

test("without git, the build has no release", async () => {
  const { readRelease } = await import("../../../worker/build.mjs");
  const release = readRelease("mlb", () => {
    throw new Error("not a git repository");
  });
  assert.equal(release, null);
});
