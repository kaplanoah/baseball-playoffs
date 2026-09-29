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

function createFakeMlb({ status = 200 } = {}) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    const kind = url.includes("/seasons/")
      ? "season"
      : url.includes("/standings")
        ? "standings"
        : url.includes("/postseason")
          ? "postseason"
          : "schedule";
    return new Response(JSON.stringify(EVENING.responses[kind]), { status });
  };
  return { fetchImpl, calls };
}

function createTestServer(options = {}) {
  const mlb = createFakeMlb(options);
  let now = NOW;
  const server = createSnapshotServer({ fetchImpl: mlb.fetchImpl, now: () => now });
  return {
    mlb,
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
  assert.equal(mlb.calls.length, 8);
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
  const { buildWorker } = await import("../worker/build.mjs");
  const bundle = await import(`data:text/javascript,${encodeURIComponent(await buildWorker())}`);
  assert.equal(typeof bundle.default.fetch, "function");
  assert.equal(typeof bundle.SeasonStore, "function");
});

const importBundle = async (script) => import(`data:text/javascript,${encodeURIComponent(script)}`);
const requestVersion = (bundle) =>
  bundle.default.fetch(new Request("https://mlb-live.example/k3y/version.json"), {
    APP_KEY: "k3y",
  });

test("the bundle serves the release it was built from", async () => {
  const { buildWorker } = await import("../worker/build.mjs");
  const release = { version: "2.13.0", commit: "abc1234", builtAt: "2026-09-28T00:10:41.000Z" };
  const response = await requestVersion(await importBundle(await buildWorker({ release })));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-type"), "application/json");
  assert.deepEqual(await response.json(), release);
});

test("a bundle built without a release has no version file", async () => {
  const { buildWorker } = await import("../worker/build.mjs");
  const response = await requestVersion(await importBundle(await buildWorker({ release: null })));
  assert.equal(response.status, 404);
});

test("the release names the version, the commit, and when it was built", async () => {
  const { readRelease } = await import("../worker/build.mjs");
  const git = (args) => (args[0] === "log" && args[1] === "-1" ? "b102733\n" : "");
  assert.deepEqual(readRelease(git, new Date("2026-09-28T00:10:41Z")), {
    version: "2.12.2",
    commit: "b102733",
    builtAt: "2026-09-28T00:10:41.000Z",
  });
});

test("without git, the build has no release", async () => {
  const { readRelease } = await import("../worker/build.mjs");
  const release = readRelease(() => {
    throw new Error("not a git repository");
  });
  assert.equal(release, null);
});
