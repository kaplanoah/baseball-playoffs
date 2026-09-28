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
  session.activeYear = 2025;
  await loadSeason(2025);
  assert.deepEqual(session.seasonDoc, { year: 2025, teams: {}, series: {}, ranking: [], log: [] });
});

test("a season that loads after the viewer picked another year is dropped", async () => {
  const documents = {
    "seasons/2025": { ...structuredClone(STORED), year: 2025 },
    "seasons/2026": structuredClone(STORED),
  };
  const { database } = createStore(documents);
  const slowReads = [];
  session.db = {
    ...database,
    doc: (path) => ({
      ...database.doc(path),
      get: () => new Promise((resolve) => slowReads.push(() => resolve(database.doc(path).get()))),
    }),
  };
  session.activeYear = 2025;
  const earlier = loadSeason(2025);
  session.activeYear = 2026;
  const later = loadSeason(2026);
  slowReads[1]();
  await later;
  slowReads[0]();
  await earlier;
  assert.equal(session.seasonDoc.year, 2026);
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
  applyDeferredSeason(true);
  assert.deepEqual(session.seasonDoc.log, [...STORED.log, newEntry]);
  assert.deepEqual(session.seasonDoc.ranking, ["NYY"]);
});

test("a drop that moved nothing takes the ranking from an update that arrived during it", async () => {
  const documents = { "seasons/2026": structuredClone(STORED) };
  const { database, deliver } = createStore(documents);
  session.db = database;
  await loadSeason(2026);
  watchSeason(2026, () => {});

  session.isReordering = true;
  deliver("seasons/2026", { ...structuredClone(STORED), ranking: ["NYY"] });
  session.isReordering = false;
  applyDeferredSeason(false);
  assert.deepEqual(session.seasonDoc.ranking, ["NYY"]);
});

test("while a newer ranking is being saved, the echo of an older one doesn't undo it", async () => {
  const teams = {
    NYY: STORED.teams.NYY,
    TOR: { league: "AL", seed: 2 },
    SEA: { league: "AL", seed: 3 },
  };
  const documents = { "seasons/2026": { ...structuredClone(STORED), teams } };
  const { database, deliver } = createStore(documents);
  session.db = database;
  await loadSeason(2026);
  let redraws = 0;
  watchSeason(2026, () => redraws++);

  const first = ["TOR", "NYY", "SEA"];
  const second = ["TOR", "SEA", "NYY"];
  await Promise.all([saveRanking(first), saveRanking(second)]);
  deliver("seasons/2026", { ...documents["seasons/2026"], ranking: first });
  assert.deepEqual(session.seasonDoc.ranking, second);
  deliver("seasons/2026", { ...documents["seasons/2026"], ranking: second });
  assert.deepEqual(session.seasonDoc.ranking, second);

  const otherDevice = ["SEA", "TOR", "NYY"];
  deliver("seasons/2026", { ...documents["seasons/2026"], ranking: otherDevice });
  assert.deepEqual(session.seasonDoc.ranking, otherDevice);
});
