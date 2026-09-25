import * as LogChanges from "./changes.js";
import { sameJson } from "./compare.js";
import { session, composeState } from "./session.js";
import { renderUpdates } from "./updates.js";

const BLOCKING_WRITE_ERRORS = new Set([
  "not_granted",
  "capability_disabled",
  "revoked",
  "invalid_argument",
  "quota_exceeded",
]);

let writesBlocked = false;
let writing = Promise.resolve();
let reportedKey = "";
const liveStatus = { source: "", error: "", detail: "", write: "" };

async function runStep(name, write) {
  try {
    return await write();
  } catch (error) {
    throw Object.assign(error && typeof error === "object" ? error : new Error(String(error)), {
      step: name,
    });
  }
}

// update() merges objects key by key, so a key can't be removed by leaving it out.
function losesKeys(before, after) {
  if (!before || typeof before !== "object" || Array.isArray(before)) return false;
  if (!after || typeof after !== "object" || Array.isArray(after)) return true;
  return Object.keys(before).some((key) => !(key in after) || losesKeys(before[key], after[key]));
}

function collectChangedFields(doc, snapshot) {
  const found = LogChanges.findChanges(
    { teams: doc.teams, projected: doc.projected, standings: session.storedStandings },
    snapshot,
  );
  const log = LogChanges.mergeLog(doc.log, [...snapshot.log, ...found]);
  const fields = {};
  if (!sameJson(doc.teams, snapshot.teams)) fields.teams = snapshot.teams;
  if (!sameJson(doc.series, snapshot.series)) fields.series = snapshot.series;
  if (doc.projected !== snapshot.projected) fields.projected = snapshot.projected;
  if (!sameJson(doc.log, log)) fields.log = log;
  return fields;
}

async function writeSeasonFields(year, doc, fields) {
  const ref = session.db.doc(`seasons/${year}`);
  const exists = (await runStep("season read", () => ref.get())).exists;
  if (!exists) {
    await runStep("season create", () => ref.set({ year, ranking: [], ...fields }));
    return;
  }
  const cleared = Object.keys(fields).filter((key) => losesKeys(doc[key], fields[key]));
  if (cleared.length)
    await runStep("season clear", () =>
      ref.update(Object.fromEntries(cleared.map((key) => [key, null]))),
    );
  await runStep("season", () => ref.update(fields));
}

async function writeStandings(year, snapshot) {
  const stored = session.storedStandings && session.storedStandings.divisions;
  if (!snapshot.standings || sameJson(stored, snapshot.standings.divisions)) return;
  const table = { ...snapshot.standings, updatedAt: snapshot.asOf };
  await runStep("standings", () => session.db.doc(`standings/${year}`).set(table));
  session.storedStandings = table;
}

// Season before standings: if the standings write fails, the old baseline finds the same changes
// again next time, and the log's keys keep them single.
async function writeLive(snapshot) {
  if (snapshot.season !== session.activeYear) return;
  const year = snapshot.season;
  const doc = session.seasonDoc;
  const fields = collectChangedFields(doc, snapshot);

  if (Object.keys(fields).length) {
    await writeSeasonFields(year, doc, fields);
    // Applied before the store echoes it back; the echo then redraws nothing, so the log is redrawn here.
    Object.assign(session.seasonDoc, fields);
    if (fields.log) {
      composeState();
      renderUpdates();
    }
  }
  await writeStandings(year, snapshot);
}

function describeWriteFailure(error) {
  const code = (error && error.code) || "error";
  if (BLOCKING_WRITE_ERRORS.has(code)) writesBlocked = true;
  const step = (error && error.step) || "write";
  return `${step}: ${code}: ${String((error && error.message) || "").slice(0, 160)}`;
}

export function saveLive(snapshot) {
  if (!session.db || writesBlocked) return;
  writing = writing
    .then(() => writeLive(snapshot))
    .then(
      () => reportStatus({ write: "" }),
      (error) => reportStatus({ write: describeWriteFailure(error) }),
    );
}

// Stored so a page that stops updating can be diagnosed without its browser console.
export function reportStatus(change) {
  Object.assign(liveStatus, change);
  const key = [liveStatus.source, liveStatus.error, liveStatus.write].join("|");
  if (!session.db || key === reportedKey) return;
  reportedKey = key;
  const doc = { ...liveStatus, at: new Date().toISOString() };
  writing = writing.then(() => session.db.doc("live/status").set(doc)).catch(() => {});
}
