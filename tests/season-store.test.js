import { beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { session } from "../page/js/session.js";
import { loadSeason, saveRanking } from "../page/js/season-store.js";

function createStore(documents, { failUpdates = false } = {}) {
  const writes = [];
  const db = {
    doc: (path) => ({
      get: async () => ({
        id: path.split("/").pop(),
        exists: path in documents,
        data: () => documents[path],
      }),
      set: async (data) => {
        writes.push({ path, kind: "set", data });
        documents[path] = data;
      },
      update: async (fields) => {
        writes.push({ path, kind: "update", fields });
        if (failUpdates) throw Object.assign(new Error("try later"), { code: "unavailable" });
        documents[path] = { ...documents[path], ...fields };
      },
    }),
  };
  return { db, writes };
}

const STORED = {
  year: 2026,
  teams: { NYY: { league: "AL", seed: 1 } },
  series: { AL_WC1: { winsA: 1, winsB: 0 } },
  ranking: [],
  log: [{ kind: "lock", at: "2026-09-30T00:00:00Z" }],
};

beforeEach(() => {
  session.activeYear = 2026;
  session.saveProblem = null;
});

test("a ranking saved to an existing season only updates the ranking", async () => {
  const documents = { "seasons/2026": structuredClone(STORED) };
  const { db, writes } = createStore(documents);
  session.db = db;
  await loadSeason(2026);
  await saveRanking(["NYY"]);
  assert.deepEqual(writes, [
    { path: "seasons/2026", kind: "update", fields: { ranking: ["NYY"] } },
  ]);
  assert.deepEqual(documents["seasons/2026"].teams, STORED.teams);
});

test("a failed save says so and never falls back to overwriting the season", async () => {
  const documents = { "seasons/2026": structuredClone(STORED) };
  const { db, writes } = createStore(documents, { failUpdates: true });
  session.db = db;
  await loadSeason(2026);
  await assert.rejects(saveRanking(["NYY"]), /try later/);
  assert.deepEqual(
    writes.map((write) => write.kind),
    ["update"],
  );
  assert.deepEqual(documents["seasons/2026"], STORED);
  assert.match(session.saveProblem, /Couldn't save/);
});

test("a season saved for the first time is created whole", async () => {
  const documents = {};
  const { db, writes } = createStore(documents);
  session.db = db;
  await loadSeason(2026);
  await saveRanking(["NYY"]);
  assert.equal(writes[0].kind, "set");
  assert.deepEqual(documents["seasons/2026"].ranking, ["NYY"]);
});

test("without a store, loading a season gives an empty one instead of failing", async () => {
  session.db = null;
  await loadSeason(2025);
  assert.deepEqual(session.seasonDoc, { year: 2025, teams: {}, series: {}, ranking: [], log: [] });
});

test("stored clubs the page doesn't know are dropped on load", async () => {
  const documents = {
    "seasons/2026": { ...structuredClone(STORED), teams: { NYY: STORED.teams.NYY, "<b>": {} } },
  };
  session.db = createStore(documents).db;
  await loadSeason(2026);
  assert.deepEqual(Object.keys(session.seasonDoc.teams), ["NYY"]);
});
