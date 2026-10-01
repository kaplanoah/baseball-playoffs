import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildSnapshot } from "../page/js/snapshot.js";
import { listNotifications, readUpdates, saveSnapshot } from "../worker/src/season-updater.js";

const AFTERNOON = JSON.parse(
  readFileSync(`${import.meta.dirname}/fixtures/2026-09-30-afternoon.json`, "utf8"),
);
const NOW = Date.parse(AFTERNOON.now);
// The afternoon's recording has no players' averages, so the next day's stand in for them.
const GAMES = JSON.parse(
  readFileSync(`${import.meta.dirname}/fixtures/2026-10-01-games.json`, "utf8"),
);
const RESPONSES = { ...AFTERNOON.responses, players: GAMES.preview.players };
const SNAPSHOT = buildSnapshot(RESPONSES, { season: 2026, now: NOW });

function createDocs() {
  const stored = new Map();
  const writes = [];
  return {
    writes,
    read: async (key) => structuredClone(stored.get(key)) ?? null,
    list: async () => [],
    write: async (key, doc) => {
      writes.push(key);
      stored.set(key, structuredClone(doc));
    },
    remove: async (key) => stored.delete(key),
  };
}

// Tonight's first game, finished, with the series it settles.
function finishTonight(snapshot, [awayScore, homeScore]) {
  const games = snapshot.games.map((game) =>
    game.id === "1042600132"
      ? {
          ...game,
          state: "final",
          status: "Final",
          away: { ...game.away, score: awayScore },
          home: { ...game.home, score: homeScore },
        }
      : game,
  );
  const series = snapshot.series.map((record) =>
    record.id === "1-3"
      ? { ...record, top: { ...record.top, wins: 2 }, winner: "ATL", status: "ATL wins 2-0" }
      : record,
  );
  return { ...snapshot, games, series };
}

test("the season saves its games, series, standings, and top scorers, and only when they change", async () => {
  const docs = createDocs();
  await saveSnapshot(docs, SNAPSHOT);
  await saveSnapshot(docs, { ...SNAPSHOT, asOf: "2026-09-30T22:00:00Z" });

  assert.deepEqual(docs.writes, ["seasons/2026"]);
  const saved = await readUpdates(docs, 2026);
  assert.equal(saved.games.length, 28);
  assert.equal(saved.series.length, 7);
  assert.equal(saved.standings.length, 15);
  assert.equal(saved.leaders.length, 15);
});

test("a feed that didn't answer leaves its saved field as it was", async () => {
  const docs = createDocs();
  await saveSnapshot(docs, SNAPSHOT);
  await saveSnapshot(docs, { ...SNAPSHOT, standings: [], missing: ["standings"] });

  assert.equal((await readUpdates(docs, 2026)).standings.length, 15);
});

test("the top scorers stay as they were when the players' averages didn't answer", async () => {
  const docs = createDocs();
  await saveSnapshot(docs, SNAPSHOT);
  await saveSnapshot(docs, buildWithout(["players"]));

  assert.equal((await readUpdates(docs, 2026)).leaders.length, 15);
});

// The afternoon's feeds, with some that didn't answer.
const buildWithout = (feeds) =>
  buildSnapshot(
    { ...RESPONSES, ...Object.fromEntries(feeds.map((feed) => [feed, null])) },
    { season: 2026, now: NOW },
  );

test("the games stay as they were unless both the scoreboard and the schedule answered", async () => {
  const docs = createDocs();
  const finished = finishTonight(SNAPSHOT, [84, 79]);
  await saveSnapshot(docs, finished);

  await saveSnapshot(docs, buildWithout(["scoreboard"]));
  await saveSnapshot(docs, buildWithout(["schedule"]));

  assert.deepEqual((await readUpdates(docs, 2026)).games, finished.games);
});

test("the games are saved while ESPN stands in for the scoreboard", async () => {
  const docs = createDocs();
  await saveSnapshot(docs, SNAPSHOT);
  const finished = finishTonight(SNAPSHOT, [93, 75]);

  await saveSnapshot(docs, { ...finished, missing: ["scoreboard"], standIn: "espn" });

  assert.deepEqual((await readUpdates(docs, 2026)).games, finished.games);
});

test("while ESPN stands in, a game it lacks keeps what was saved", async () => {
  const docs = createDocs();
  const finished = finishTonight(SNAPSHOT, [93, 75]);
  await saveSnapshot(docs, finished);

  await saveSnapshot(docs, { ...SNAPSHOT, missing: ["scoreboard"], standIn: "espn" });

  assert.deepEqual((await readUpdates(docs, 2026)).games, finished.games);
});

test("while ESPN stands in, the series wait for the bracket", async () => {
  const docs = createDocs();
  const finished = finishTonight(SNAPSHOT, [93, 75]);
  await saveSnapshot(docs, finished);

  await saveSnapshot(docs, { ...SNAPSHOT, missing: ["bracket", "scoreboard"], standIn: "espn" });

  assert.deepEqual((await readUpdates(docs, 2026)).series, finished.series);
});

test("without the bracket, the series stay as they were unless the games answered", async () => {
  const docs = createDocs();
  const finished = finishTonight(SNAPSHOT, [84, 79]);
  await saveSnapshot(docs, finished);

  await saveSnapshot(docs, buildWithout(["bracket", "schedule"]));

  assert.deepEqual((await readUpdates(docs, 2026)).series, finished.series);
});

test("a game that just finished is news, and says where its series stands", async () => {
  const before = { games: SNAPSHOT.games, series: SNAPSHOT.series };
  const after = finishTonight(SNAPSHOT, [84, 79]);

  const notifications = listNotifications({
    before,
    after,
    now: Date.parse("2026-10-01T01:30:00Z"),
  });

  assert.deepEqual(notifications, [
    {
      title: "The Dream beat the Mystics 84-79",
      body: "The Dream win the First Round 2-0.",
      tag: "final:1042600132",
    },
  ]);
});

test("a final's news counts the game itself, even while the bracket hasn't caught up", () => {
  const moment = JSON.parse(
    readFileSync(`${import.meta.dirname}/fixtures/2026-10-01-atlanta-final.json`, "utf8"),
  );
  const now = Date.parse(moment.now);
  const after = buildSnapshot(
    { ...AFTERNOON.responses, ...moment.responses },
    { season: 2026, now },
  );

  const [news] = listNotifications({ before: SNAPSHOT, after, now });

  assert.deepEqual(news, {
    title: "The Dream beat the Mystics 93-75",
    body: "The Dream win the First Round 2-0.",
    tag: "final:1042600132",
  });
});

test("games already finished, or found finished long after, aren't news", () => {
  const after = finishTonight(SNAPSHOT, [84, 79]);
  assert.deepEqual(listNotifications({ before: after, after, now: NOW }), []);
  assert.deepEqual(
    listNotifications({ before: null, after, now: Date.parse("2026-10-02T12:00:00Z") }),
    [],
  );
});
