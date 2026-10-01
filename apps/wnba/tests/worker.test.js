import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { REQUESTS } from "../page/js/snapshot.js";
import { createSnapshotServer } from "../worker/src/snapshot.js";

const AFTERNOON = JSON.parse(
  readFileSync(`${import.meta.dirname}/fixtures/2026-09-30-afternoon.json`, "utf8"),
);
const NOW = Date.parse(AFTERNOON.now);
// ESPN's answers the next afternoon, with both games of Sep 30 finished.
const ESPN = JSON.parse(
  readFileSync(`${import.meta.dirname}/fixtures/2026-10-01-espn-core.json`, "utf8"),
);

const FEEDS = {
  [REQUESTS.scoreboard]: "scoreboard",
  [REQUESTS.schedule]: "schedule",
  [REQUESTS.bracket(2026)]: "bracket",
  [REQUESTS.standings(2026)]: "standings",
};

/**
 * Answers the league's feeds from the fixture, or from `answers` in its place, counting reads,
 * unless a feed is told to refuse. ESPN answers from `espn`, by URL, or not at all.
 * @param {{ refuse?: Record<string, "page" | "error">, answers?: Record<string, any>, espn?: Record<string, any> }} [options]
 */
function createLeague({ refuse = {}, answers = {}, espn = {} } = {}) {
  const reads = [];
  const fetchImpl = async (url, init) => {
    if (!FEEDS[url]) {
      reads.push({ feed: "espn", headers: init.headers });
      return url in espn
        ? new Response(JSON.stringify(espn[url]))
        : new Response("", { status: 404 });
    }
    const feed = FEEDS[url];
    reads.push({ feed, headers: init.headers, cacheSeconds: init.cf?.cacheTtl });
    if (refuse[feed] === "page") return new Response("<!DOCTYPE html><html></html>");
    if (refuse[feed] === "error") return new Response("", { status: 503 });
    return new Response(JSON.stringify(answers[feed] ?? AFTERNOON.responses[feed]));
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

test("the scoreboard comes from Cloudflare's cache no more than 5 seconds old", async () => {
  const league = createLeague();
  const server = createSnapshotServer({ fetchImpl: league.fetchImpl, now: () => NOW });

  await server.loadSnapshot(2026);

  const scoreboardRead = league.reads.find((read) => read.feed === "scoreboard");
  assert.ok(scoreboardRead.cacheSeconds <= 5);
});

test("a feed that answers with a web page counts as missing, and the rest still show", async () => {
  const league = createLeague({ refuse: { scoreboard: "page" } });
  const server = createSnapshotServer({ fetchImpl: league.fetchImpl, now: () => NOW });

  const snapshot = await server.loadSnapshot(2026);

  assert.deepEqual(snapshot.missing, ["scoreboard"]);
  assert.equal(snapshot.games.length, 28);
});

test("while the scoreboard doesn't answer, ESPN stands in for the games it has started", async () => {
  const league = createLeague({ refuse: { scoreboard: "page" }, espn: ESPN.answers });
  const server = createSnapshotServer({
    fetchImpl: league.fetchImpl,
    now: () => Date.parse(ESPN.now),
  });

  const snapshot = await server.loadSnapshot(2026);

  assert.deepEqual([snapshot.missing, snapshot.standIn], [["scoreboard"], "espn"]);
  const describe = (id) => {
    const game = snapshot.games.find((candidate) => candidate.id === id);
    return [game.state, game.status, game.period, game.away.score, game.home.score];
  };
  assert.deepEqual(describe("1042600132"), ["final", "Final", 4, 93, 75]);
  assert.deepEqual(describe("1042600112"), ["final", "Final/OT", 5, 100, 108]);
  assert.deepEqual(describe("1042600123"), ["pre", "9:00 pm ET", null, 0, 0]);
});

test("ESPN doesn't stand in until one of its games has started", async () => {
  const espn = structuredClone(ESPN.answers);
  const listing = Object.keys(espn).find((url) => url.includes("/events?dates="));
  espn[listing].items = espn[listing].items.filter((item) => item.$ref.includes("401918022"));
  const league = createLeague({ refuse: { scoreboard: "page" }, espn });
  const server = createSnapshotServer({
    fetchImpl: league.fetchImpl,
    now: () => Date.parse(ESPN.now),
  });

  const snapshot = await server.loadSnapshot(2026);

  assert.deepEqual([snapshot.missing, snapshot.standIn], [["scoreboard"], null]);
});

test("while the scoreboard answers, ESPN isn't read", async () => {
  const league = createLeague({ espn: ESPN.answers });
  const server = createSnapshotServer({ fetchImpl: league.fetchImpl, now: () => NOW });

  const snapshot = await server.loadSnapshot(2026);

  assert.equal(league.countReads("espn"), 0);
  assert.equal(snapshot.standIn, null);
});

test("a feed that answers JSON without its data counts as missing", async () => {
  const league = createLeague({ answers: { scoreboard: { meta: { code: 200 } } } });
  const server = createSnapshotServer({ fetchImpl: league.fetchImpl, now: () => NOW });

  const snapshot = await server.loadSnapshot(2026);

  assert.deepEqual(snapshot.missing, ["scoreboard"]);
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

// Today's scoreboard with its first game finished.
function finishFirstGame(scoreboard) {
  const finished = structuredClone(scoreboard);
  Object.assign(finished.scoreboard.games[0], { gameStatus: 3, gameStatusText: "Final" });
  return finished;
}

const countSlowReads = (league) => ["schedule", "bracket"].map(league.countReads);

test("a game that ends has the schedule and bracket read again right away", async () => {
  const answers = {};
  const league = createLeague({ answers });
  let now = NOW;
  const server = createSnapshotServer({ fetchImpl: league.fetchImpl, now: () => now });
  await server.loadSnapshot(2026);

  answers.scoreboard = finishFirstGame(AFTERNOON.responses.scoreboard);
  now += 11 * 1000;
  await server.loadSnapshot(2026);

  assert.deepEqual(countSlowReads(league), [2, 2]);
});

test("a scoreboard that misses a read doesn't look like a game ending once it's back", async () => {
  /** @type {Record<string, "page" | "error">} */
  const refuse = {};
  const answers = { scoreboard: finishFirstGame(AFTERNOON.responses.scoreboard) };
  const league = createLeague({ refuse, answers });
  let now = NOW;
  const server = createSnapshotServer({ fetchImpl: league.fetchImpl, now: () => now });
  await server.loadSnapshot(2026);

  refuse.scoreboard = "error";
  now += 11 * 1000;
  await server.loadSnapshot(2026);
  delete refuse.scoreboard;
  now += 11 * 1000;
  await server.loadSnapshot(2026);

  assert.deepEqual(countSlowReads(league), [1, 1]);
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
