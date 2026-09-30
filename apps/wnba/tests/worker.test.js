import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { REQUESTS } from "../page/js/snapshot.js";
import { createSnapshotServer } from "../worker/src/snapshot.js";

const AFTERNOON = JSON.parse(
  readFileSync(`${import.meta.dirname}/fixtures/2026-09-30-afternoon.json`, "utf8"),
);
const NOW = Date.parse(AFTERNOON.now);

const FEEDS = {
  [REQUESTS.scoreboard]: "scoreboard",
  [REQUESTS.schedule]: "schedule",
  [REQUESTS.bracket(2026)]: "bracket",
  [REQUESTS.standings(2026)]: "standings",
};

/**
 * Answers the league's feeds from the fixture, counting reads, unless a feed is told to refuse.
 * @param {{ refuse?: Record<string, "page" | "error"> }} [options]
 */
function createLeague({ refuse = {} } = {}) {
  const reads = [];
  const fetchImpl = async (url, init) => {
    const feed = FEEDS[url];
    reads.push({ feed, headers: init.headers });
    if (refuse[feed] === "page") return new Response("<!DOCTYPE html><html></html>");
    if (refuse[feed] === "error") return new Response("", { status: 503 });
    return new Response(JSON.stringify(AFTERNOON.responses[feed]));
  };
  return {
    reads,
    fetchImpl,
    countReads: (feed) => reads.filter((read) => read.feed === feed).length,
  };
}

test("the Worker reads every feed as the league's own site would", async () => {
  const league = createLeague();
  const server = createSnapshotServer({ fetchImpl: league.fetchImpl, now: () => NOW });

  const snapshot = await server.loadSnapshot(2026);

  assert.deepEqual(league.reads.map((read) => read.feed).sort(), [
    "bracket",
    "schedule",
    "scoreboard",
    "standings",
  ]);
  for (const { headers } of league.reads) {
    assert.match(headers["user-agent"], /Chrome/);
    assert.equal(headers.referer, "https://www.wnba.com/");
    assert.equal(headers["sec-fetch-mode"], "cors");
  }
  assert.equal(snapshot.games.length, 28);
  assert.deepEqual(snapshot.missing, []);
});

test("a feed that answers with a web page counts as missing, and the rest still show", async () => {
  const league = createLeague({ refuse: { scoreboard: "page" } });
  const server = createSnapshotServer({ fetchImpl: league.fetchImpl, now: () => NOW });

  const snapshot = await server.loadSnapshot(2026);

  assert.deepEqual(snapshot.missing, ["scoreboard"]);
  assert.equal(snapshot.games.length, 28);
});

test("the schedule, bracket, and standings are read again only after a while", async () => {
  const league = createLeague();
  let now = NOW;
  const server = createSnapshotServer({ fetchImpl: league.fetchImpl, now: () => now });

  await server.loadSnapshot(2026);
  now += 11 * 1000;
  await server.loadSnapshot(2026);
  assert.deepEqual(
    ["scoreboard", "schedule", "bracket", "standings"].map(league.countReads),
    [2, 1, 1, 1],
  );

  now += 11 * 60 * 1000;
  await server.loadSnapshot(2026);
  assert.deepEqual(
    ["scoreboard", "schedule", "bracket", "standings"].map(league.countReads),
    [3, 1, 2, 1],
  );
});

test("a slow feed that stops answering keeps its last good answer", async () => {
  /** @type {Record<string, "page" | "error">} */
  const refuse = {};
  const league = createLeague({ refuse });
  let now = NOW;
  const server = createSnapshotServer({ fetchImpl: league.fetchImpl, now: () => now });
  await server.loadSnapshot(2026);

  refuse.bracket = "error";
  now += 11 * 60 * 1000;
  const snapshot = await server.loadSnapshot(2026);

  assert.deepEqual(snapshot.missing, []);
  assert.equal(snapshot.series.find((series) => series.id === "1-0").winner, "NYL");
});

test("the page's snapshot says why it couldn't be read when no feed answers", async () => {
  const league = createLeague({
    refuse: { scoreboard: "error", schedule: "error", bracket: "error", standings: "error" },
  });
  const server = createSnapshotServer({ fetchImpl: league.fetchImpl, now: () => NOW });

  const response = await server.serveSnapshot(
    new URL("https://app.example/k3y/snapshot?season=2026"),
  );

  assert.equal(response.status, 502);
  assert.match((await response.json()).error, /^Couldn't read the WNBA: None of the WNBA's feeds/);
});

test("a season that isn't a year is refused", async () => {
  const server = createSnapshotServer({ fetchImpl: createLeague().fetchImpl, now: () => NOW });
  const response = await server.serveSnapshot(new URL("https://app.example/k3y/snapshot?season=x"));
  assert.equal(response.status, 400);
});

test("the Worker bundles with its page, and exports its store", async () => {
  const { buildWorker } = await import("../../../worker/build.mjs");
  const bundle = await import(
    `data:text/javascript,${encodeURIComponent(await buildWorker("wnba", { release: null }))}`
  );
  assert.equal(typeof bundle.SeasonStore, "function");
  const page = await bundle.default.fetch(new Request("https://app.example/k3y/"), {
    APP_KEY: "k3y",
  });
  assert.equal(page.status, 200);
  assert.match(await page.text(), /<title>WNBA Playoffs<\/title>/);
});
