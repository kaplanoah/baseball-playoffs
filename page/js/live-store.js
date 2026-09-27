import * as LogChanges from "./changes.js";
import { sameJson } from "./compare.js";
import * as Readings from "./readings.js";
import { readingsCollection } from "./season-store.js";
import { session, composeState } from "./session.js";
import { renderUpdates } from "./updates.js";

// The store refuses a malformed write the same way every time, so retrying can't help.
const BLOCKING_WRITE_ERROR = "invalid_argument";

let writesBlocked = false;
let writing = Promise.resolve();
let reportedKey = "";
const liveStatus = { error: "", detail: "", write: "" };

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
  const log = LogChanges.mergeLog(doc.log, snapshot.log);
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

function redrawUpdates() {
  composeState();
  renderUpdates();
}

async function writeSeason(year, snapshot) {
  const doc = session.seasonDoc;
  const fields = collectChangedFields(doc, snapshot);
  if (!Object.keys(fields).length) return;
  await writeSeasonFields(year, doc, fields);
  // Applied before the store echoes it back; the echo then redraws nothing, so the log is redrawn here.
  Object.assign(session.seasonDoc, fields);
  if (fields.log) redrawUpdates();
}

const replacePart = (parts, changed) =>
  Readings.sortParts([...parts.filter((part) => part.id !== changed.id), changed]);

// A snapshot without standings came from a partial answer, not a change in them. Each open
// page writes whole parts from its own readings, so whichever writes last leaves a part that
// replays on its own.
async function writeReading(year, snapshot) {
  if (!session.readings || !snapshot.standings) return;
  const dayName = Readings.readReadingDay(snapshot);
  const changed = Readings.addReading(session.readings, dayName, Readings.createReading(snapshot));
  if (!changed) return;
  await runStep("readings", () =>
    session.db.doc(`${readingsCollection(year)}/${changed.id}`).set(changed),
  );
  session.readings = replacePart(session.readings, changed);
  redrawUpdates();
}

// The expired parts' updates move into the saved log before their readings go.
async function removeExpiredReadings(year, snapshot) {
  if (!session.readings) return;
  const dayName = Readings.readReadingDay(snapshot);
  const expired = Readings.findExpiredParts(session.readings, dayName);
  if (!expired.length) return;
  const doc = session.seasonDoc;
  const log = LogChanges.mergeLog(doc.log, Readings.rebuildLog(expired));
  if (!sameJson(doc.log, log)) {
    await writeSeasonFields(year, doc, { log });
    session.seasonDoc.log = log;
  }
  for (const part of expired) {
    await runStep("readings removal", () =>
      session.db.doc(`${readingsCollection(year)}/${part.id}`).delete(),
    );
    session.readings = session.readings.filter((kept) => kept !== part);
  }
  redrawUpdates();
}

async function writeLive(snapshot) {
  if (snapshot.season !== session.activeYear) return;
  const year = snapshot.season;
  await writeSeason(year, snapshot);
  await writeReading(year, snapshot);
  await removeExpiredReadings(year, snapshot);
  await writeStandings(year, snapshot);
}

function describeWriteFailure(error) {
  const code = (error && error.code) || "error";
  if (code === BLOCKING_WRITE_ERROR) writesBlocked = true;
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
  const key = [liveStatus.error, liveStatus.write].join("|");
  if (!session.db || key === reportedKey) return;
  reportedKey = key;
  const doc = { ...liveStatus, at: new Date().toISOString() };
  writing = writing.then(() => session.db.doc("live/status").set(doc)).catch(() => {});
}
