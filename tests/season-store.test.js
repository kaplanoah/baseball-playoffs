import { beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { session } from "../page/js/session.js";
import {
  applyDeferredSeason,
  loadSeason,
  saveRanking,
  watchSeason,
} from "../page/js/season-store.js";

function createStore(documents, { failUpdates = false } = {}) {
  const writes = [];
  const listeners = {};
  const deliver = (path, data) => {
    documents[path] = data;
    listeners[path]({ id: path.split("/").pop(), exists: true, data: () => data });
  };
  const database = {
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
      onSnapshot: (onNext) => {
        listeners[path] = onNext;
        return () => delete listeners[path];
      },
    }),
  };
  return { database, writes, deliver };
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
  session.isReordering = false;
});

test("a ranking saved to an existing season only updates the ranking", async () => {
  const documents = { "seasons/2026": structuredClone(STORED) };
  const { database, writes } = createStore(documents);
  session.db = database;
  await loadSeason(2026);
  await saveRanking(["NYY"]);
  assert.deepEqual(writes, [
    { path: "seasons/2026", kind: "update", fields: { ranking: ["NYY"] } },
  ]);
  assert.deepEqual(documents["seasons/2026"].teams, STORED.teams);
});

test("a failed save says so and never falls back to overwriting the season", async () => {
  const documents = { "seasons/2026": structuredClone(STORED) };
  const { database, writes } = createStore(documents, { failUpdates: true });
  session.db = database;
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
  const { database, writes } = createStore(documents);
  session.db = database;
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
  session.db = createStore(documents).database;
  await loadSeason(2026);
  assert.deepEqual(Object.keys(session.seasonDoc.teams), ["NYY"]);
});

test("an update that arrives during a drag waits for it, and keeps the drag's order", async () => {
  const documents = { "seasons/2026": structuredClone(STORED) };
  const { database, deliver } = createStore(documents);
  session.db = database;
  await loadSeason(2026);
  let redraws = 0;
  watchSeason(2026, () => redraws++);

  session.isReordering = true;
  session.seasonDoc.ranking = ["NYY"];
  const newEntry = { kind: "elim", team: "SEA", at: "2026-10-01T00:00:00Z" };
  deliver("seasons/2026", { ...structuredClone(STORED), log: [...STORED.log, newEntry] });
  assert.equal(session.seasonDoc.log.length, 1);
  assert.equal(redraws, 0);

  session.isReordering = false;
  applyDeferredSeason();
  assert.deepEqual(session.seasonDoc.log, [...STORED.log, newEntry]);
  assert.deepEqual(session.seasonDoc.ranking, ["NYY"]);
});
