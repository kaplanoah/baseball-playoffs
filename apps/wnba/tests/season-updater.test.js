import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildSnapshot } from "../page/js/snapshot.js";
import { listNotifications, readUpdates, saveSnapshot } from "../worker/src/season-updater.js";

const AFTERNOON = JSON.parse(
  readFileSync(`${import.meta.dirname}/fixtures/2026-09-30-afternoon.json`, "utf8"),
);
const NOW = Date.parse(AFTERNOON.now);
const SNAPSHOT = buildSnapshot(AFTERNOON.responses, { season: 2026, now: NOW });

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

test("the season saves its games, series, and standings, and only when they change", async () => {
  const docs = createDocs();
  await saveSnapshot(docs, SNAPSHOT);
  await saveSnapshot(docs, { ...SNAPSHOT, asOf: "2026-09-30T22:00:00Z" });

  assert.deepEqual(docs.writes, ["seasons/2026"]);
  const saved = await readUpdates(docs, 2026);
  assert.equal(saved.games.length, 28);
  assert.equal(saved.series.length, 7);
  assert.equal(saved.standings.length, 15);
});

test("a feed that didn't answer leaves its saved field as it was", async () => {
  const docs = createDocs();
  await saveSnapshot(docs, SNAPSHOT);
  await saveSnapshot(docs, { ...SNAPSHOT, standings: [], missing: ["standings"] });

  assert.equal((await readUpdates(docs, 2026)).standings.length, 15);
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

test("games already finished, or found finished long after, aren't news", () => {
  const after = finishTonight(SNAPSHOT, [84, 79]);
  assert.deepEqual(listNotifications({ before: after, after, now: NOW }), []);
  assert.deepEqual(
    listNotifications({ before: null, after, now: Date.parse("2026-10-02T12:00:00Z") }),
    [],
  );
});
