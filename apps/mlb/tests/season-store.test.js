import { beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { session } from "../page/js/session.js";
import {
  applyDeferredSeason,
  saveRanking,
  showUnsavedSeason,
  watchYear,
} from "../page/js/season-store.js";

// A stand-in for the store: each watch answers with what's stored once the test moves on, or,
// when answers are held, once the test answers them.
function createStore(documents, { failUpdates = false, unreadable = [], isHeld = false } = {}) {
  const writes = [];
  const listeners = {};
  const heldAnswers = [];
  const readStored = (path) => ({
    id: path.split("/").pop(),
    exists: path in documents,
    data: () => documents[path],
  });
  const listStored = (name) => ({
    docs: Object.keys(documents)
      .filter((path) => path.startsWith(`${name}/`))
      .map(readStored),
  });
  const watch = (key, readAnswer) => (onNext, onError) => {
    const listener = { onNext, onError };
    listeners[key] = listener;
    const answer = () => {
      if (listeners[key] !== listener) return;
      if (unreadable.includes(key)) onError(new Error("unreadable"));
      else onNext(readAnswer());
    };
    if (isHeld) heldAnswers.push(answer);
    else queueMicrotask(answer);
    return () => {
      if (listeners[key] === listener) delete listeners[key];
    };
  };
  const database = {
    doc: (path) => ({
      update: async (fields) => {
        writes.push({ path, kind: "update", fields });
        if (failUpdates) throw Object.assign(new Error("try later"), { code: "unavailable" });
        documents[path] = { ...documents[path], ...fields };
      },
      onSnapshot: watch(path, () => readStored(path)),
    }),
    collection: (name) => ({
      limit: () => ({ onSnapshot: watch(name, () => listStored(name)) }),
    }),
  };
  const deliver = (path, data) => {
    documents[path] = data;
    listeners[path]?.onNext(readStored(path));
  };
  const deliverListing = (name) => listeners[name]?.onNext(listStored(name));
  const answerHeld = (index) => heldAnswers[index]();
  return { database, writes, deliver, deliverListing, answerHeld };
}

function countRedraws() {
  const redraws = { season: 0, standings: 0, readings: 0 };
  const onChanges = {
    onSeasonChange: () => redraws.season++,
    onStandingsChange: () => redraws.standings++,
    onReadingsChange: () => redraws.readings++,
  };
  return { redraws, onChanges };
}

const IGNORED_REDRAWS = countRedraws().onChanges;

const STORED = {
  year: 2026,
  teams: { NYY: { league: "AL", seed: 1 } },
  series: { AL_WC1: { winsA: 1, winsB: 0 } },
  ranking: [],
  log: [{ kind: "lock", at: "2026-09-30T00:00:00Z" }],
};

const STANDINGS = { divisions: [], updatedAt: "2026-10-01T00:00:00Z" };
const READING_PART = { id: "2026-10-01-01", start: {}, changes: [] };

beforeEach(() => {
  session.activeYear = 2026;
  session.saveProblem = null;
  session.isReordering = false;
  Object.assign(session, { seasonDoc: null, storedStandings: null, readings: null, live: null });
});

test("a year loads from each watch's first answer, without redrawing", async () => {
  const documents = {
    "seasons/2026": structuredClone(STORED),
    "standings/2026": STANDINGS,
    "readings-2026/2026-10-01-01": READING_PART,
  };
  session.db = createStore(documents).database;
  const { redraws, onChanges } = countRedraws();

  await watchYear(2026, onChanges);

  assert.deepEqual(session.seasonDoc, STORED);
  assert.deepEqual(session.storedStandings, STANDINGS);
  assert.deepEqual(session.readings, [READING_PART]);
  assert.deepEqual(session.state.teams, STORED.teams);
  assert.deepEqual(redraws, { season: 0, standings: 0, readings: 0 });
});

test("answers that come in before the whole year has loaded don't redraw, and later ones do", async () => {
  const documents = { "seasons/2026": structuredClone(STORED) };
  const { database, deliver, answerHeld } = createStore(documents, { isHeld: true });
  session.db = database;
  const { redraws, onChanges } = countRedraws();

  const loaded = watchYear(2026, onChanges);
  answerHeld(0);
  deliver("standings/2026", STANDINGS);
  answerHeld(2);
  await loaded;
  assert.deepEqual(redraws, { season: 0, standings: 0, readings: 0 });
  assert.deepEqual(session.storedStandings, STANDINGS);

  deliver("standings/2026", { ...STANDINGS, updatedAt: "2026-10-01T01:00:00Z" });
  assert.deepEqual(redraws, { season: 0, standings: 1, readings: 0 });
});

test("standings and readings that can't be read are left out of the year's load", async () => {
  const documents = { "seasons/2026": structuredClone(STORED), "standings/2026": STANDINGS };
  session.db = createStore(documents, { unreadable: ["standings/2026", "readings-2026"] }).database;
  session.storedStandings = STANDINGS;

  await watchYear(2026, IGNORED_REDRAWS);

  assert.deepEqual([session.storedStandings, session.readings], [null, null]);
  assert.deepEqual(session.seasonDoc, STORED);
});

test("a season that can't be read fails the year's load", async () => {
  const documents = { "seasons/2026": structuredClone(STORED) };
  session.db = createStore(documents, { unreadable: ["seasons/2026"] }).database;

  await assert.rejects(watchYear(2026, IGNORED_REDRAWS), /unreadable/);
});

test("a ranking saved to an existing season only updates the ranking", async () => {
  const documents = { "seasons/2026": structuredClone(STORED) };
  const { database, writes } = createStore(documents);
  session.db = database;
  await watchYear(2026, IGNORED_REDRAWS);
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
  await watchYear(2026, IGNORED_REDRAWS);
  await assert.rejects(saveRanking(["NYY"]), /try later/);
  assert.deepEqual(
    writes.map((write) => write.kind),
    ["update"],
  );
  assert.deepEqual(documents["seasons/2026"], STORED);
  assert.match(session.saveProblem, /Couldn't save/);
});

test("a season saved for the first time is only updated, which the store creates", async () => {
  const documents = {};
  const { database, writes } = createStore(documents);
  session.db = database;
  await watchYear(2026, IGNORED_REDRAWS);
  await saveRanking(["NYY"]);
  assert.deepEqual(writes, [
    { path: "seasons/2026", kind: "update", fields: { ranking: ["NYY"] } },
  ]);
});

test("without a store, the page shows an empty season", () => {
  session.db = null;
  session.activeYear = 2025;
  showUnsavedSeason(2025);
  assert.deepEqual(session.seasonDoc, { year: 2025, teams: {}, series: {}, ranking: [], log: [] });
});

test("a season that answers after the viewer picked another year is dropped", async () => {
  const documents = {
    "seasons/2025": { ...structuredClone(STORED), year: 2025 },
    "seasons/2026": structuredClone(STORED),
  };
  const { database, answerHeld } = createStore(documents, { isHeld: true });
  session.db = database;
  session.activeYear = 2025;
  watchYear(2025, IGNORED_REDRAWS);
  session.activeYear = 2026;
  const later = watchYear(2026, IGNORED_REDRAWS);
  for (const index of [3, 4, 5]) answerHeld(index);
  await later;
  answerHeld(0);
  assert.equal(session.seasonDoc.year, 2026);
});

test("updates to a year the viewer switched away from are dropped", async () => {
  const documents = { "seasons/2026": structuredClone(STORED) };
  const { database, deliver, deliverListing } = createStore(documents);
  session.db = database;
  await watchYear(2026, IGNORED_REDRAWS);
  session.activeYear = 2025;
  const { redraws, onChanges } = countRedraws();
  await watchYear(2025, onChanges);

  const newEntry = { kind: "elim", team: "SEA", at: "2026-10-01T00:00:00Z" };
  deliver("seasons/2026", { ...structuredClone(STORED), log: [...STORED.log, newEntry] });
  deliver("standings/2026", STANDINGS);
  documents["readings-2026/2026-10-01-01"] = READING_PART;
  deliverListing("readings-2026");

  assert.equal(session.seasonDoc.year, 2025);
  assert.deepEqual([session.storedStandings, session.readings], [null, []]);
  assert.deepEqual(redraws, { season: 0, standings: 0, readings: 0 });
});

test("stored clubs the page doesn't know are dropped on load", async () => {
  const documents = {
    "seasons/2026": { ...structuredClone(STORED), teams: { NYY: STORED.teams.NYY, "<b>": {} } },
  };
  session.db = createStore(documents).database;
  await watchYear(2026, IGNORED_REDRAWS);
  assert.deepEqual(Object.keys(session.seasonDoc.teams), ["NYY"]);
});

test("an update that arrives during a drag waits for it, and keeps the drag's order", async () => {
  const documents = { "seasons/2026": structuredClone(STORED) };
  const { database, deliver } = createStore(documents);
  session.db = database;
  const { redraws, onChanges } = countRedraws();
  await watchYear(2026, onChanges);

  session.isReordering = true;
  session.seasonDoc.ranking = ["NYY"];
  const newEntry = { kind: "elim", team: "SEA", at: "2026-10-01T00:00:00Z" };
  deliver("seasons/2026", { ...structuredClone(STORED), log: [...STORED.log, newEntry] });
  assert.equal(session.seasonDoc.log.length, 1);
  assert.equal(redraws.season, 0);

  session.isReordering = false;
  applyDeferredSeason(true);
  assert.deepEqual(session.seasonDoc.log, [...STORED.log, newEntry]);
  assert.deepEqual(session.seasonDoc.ranking, ["NYY"]);
});

test("a drop that moved nothing takes the ranking from an update that arrived during it", async () => {
  const documents = { "seasons/2026": structuredClone(STORED) };
  const { database, deliver } = createStore(documents);
  session.db = database;
  await watchYear(2026, IGNORED_REDRAWS);

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
  await watchYear(2026, IGNORED_REDRAWS);

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
