import * as LogChanges from "../../page/js/changes.js";
import { isSameJson } from "#shared/compare.js";
import { readEasternDay } from "#shared/days.js";
import * as Readings from "../../page/js/readings.js";
import { guessSeasonYear, hasSpringStarted } from "../../page/js/session.js";
import * as MLBSnapshot from "../../page/js/snapshot.js";

// Keeps the current season's saved data up to date from MLB, whether or not a page is open.
// `docs` reads and writes the store's documents: read(key), list(collection), write(key, doc),
// and remove(key).

// Before April the new season starts on the day MLB says spring training does.
export async function loadCurrentSnapshot(loadSnapshot, now) {
  const guess = guessSeasonYear(now);
  const { year } = readEasternDay(now);
  if (year !== guess) {
    const upcoming = await loadSnapshot(year);
    if (hasSpringStarted(upcoming.springStart, now)) return upcoming;
  }
  return loadSnapshot(guess);
}

const nameSeasonKey = (year) => `seasons/${year}`;

function collectChangedFields(doc, snapshot) {
  const log = LogChanges.mergeLog(doc.log, snapshot.log);
  const fields = {};
  if (MLBSnapshot.hasKnownField(snapshot)) {
    if (!isSameJson(doc.teams, snapshot.teams)) fields.teams = snapshot.teams;
    if (!isSameJson(doc.series, snapshot.series)) fields.series = snapshot.series;
    if (doc.projected !== snapshot.projected) fields.projected = snapshot.projected;
  }
  if (!isSameJson(doc.log, log)) fields.log = log;
  return fields;
}

// The read and the write happen with no other request in between, so replacing whole fields
// keeps whatever a page saved to the others.
async function saveSeason(docs, year, snapshot) {
  const doc = (await docs.read(nameSeasonKey(year))) ?? { year, ranking: [] };
  const fields = collectChangedFields(doc, snapshot);
  if (Object.keys(fields).length) await docs.write(nameSeasonKey(year), { ...doc, ...fields });
}

// A snapshot without standings came from a partial answer, not a change in them.
async function saveReading(docs, year, snapshot) {
  const collection = Readings.nameReadingsCollection(year);
  const parts = Readings.sortParts(await docs.list(collection));
  if (!snapshot.standings) return parts;
  const dayName = Readings.readReadingDay(snapshot);
  const changed = Readings.addReading(parts, dayName, Readings.createReading(snapshot));
  if (!changed) return parts;
  await docs.write(`${collection}/${changed.id}`, changed);
  return Readings.sortParts([...parts.filter((part) => part.id !== changed.id), changed]);
}

// The expired parts' updates move into the saved log before their readings go.
async function removeExpiredReadings(docs, year, snapshot, parts) {
  const expired = Readings.findExpiredParts(parts, Readings.readReadingDay(snapshot));
  if (!expired.length) return;
  const doc = (await docs.read(nameSeasonKey(year))) ?? { year, ranking: [] };
  const log = LogChanges.mergeLog(doc.log, Readings.rebuildLog(expired));
  if (!isSameJson(doc.log, log)) await docs.write(nameSeasonKey(year), { ...doc, log });
  const collection = Readings.nameReadingsCollection(year);
  for (const part of expired) await docs.remove(`${collection}/${part.id}`);
}

async function saveStandings(docs, year, snapshot) {
  if (!snapshot.standings) return;
  const key = `standings/${year}`;
  const stored = await docs.read(key);
  if (stored && isSameJson(stored.divisions, snapshot.standings.divisions)) return;
  await docs.write(key, { ...snapshot.standings, updatedAt: snapshot.asOf });
}

export async function saveSnapshot(docs, snapshot) {
  const year = snapshot.season;
  await saveSeason(docs, year, snapshot);
  const parts = await saveReading(docs, year, snapshot);
  await removeExpiredReadings(docs, year, snapshot, parts);
  await saveStandings(docs, year, snapshot);
}

// The updates the page would list: the saved log with what the readings rebuild.
export async function readUpdates(docs, year) {
  const doc = await docs.read(nameSeasonKey(year));
  const parts = Readings.sortParts(await docs.list(Readings.nameReadingsCollection(year)));
  return Readings.composeLog(doc?.log || [], parts);
}

export function describeSnapshotStatus(snapshot) {
  const missing = snapshot.missing || [];
  return { error: missing.length ? "mlb_fields_missing" : "", detail: missing.join(", ") };
}
