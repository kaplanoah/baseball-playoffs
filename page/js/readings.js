import * as LogChanges from "./changes.js";
import { sameJson } from "./compare.js";
import { easternDay } from "./snapshot.js";

// Updates are rebuilt from these readings every time, so a fix to how changes.js finds them
// reaches every update a kept reading covers. Readings are saved in parts, each one day's or
// less: the reading the part started from, then each change after it, field by field.

const KEPT_DAYS = 14;

// Well under the Worker store's 64 KiB, so a busy day moves on to a new part before a write fails.
const MAX_PART_LENGTH = 40 * 1024;

// A reading keeps only what findChanges reads: the field, the standings without each club's
// schedule, and the day's final scores.
export function createReading(snapshot) {
  const rows = {};
  for (const [division, clubs] of Object.entries(snapshot.standings?.divisions || {})) {
    for (const { next, then, ...row } of clubs) rows[row.id] = { ...row, div: division };
  }
  const games = {};
  for (const game of snapshot.slate?.today?.games || []) {
    if (game.state === "final") games[`${game.away}-${game.home}-${game.doubleheader || 1}`] = game;
  }
  return {
    at: snapshot.asOf,
    projected: snapshot.projected,
    teams: snapshot.teams || {},
    rows,
    games,
  };
}

export const readReadingDay = (snapshot) =>
  snapshot.slate?.today?.date || easternDay(Date.parse(snapshot.asOf)).date;

// A field missing on either side counts as null, which is how it is stored.
function diffRecords(before, after) {
  const changes = {};
  for (const [id, record] of Object.entries(after)) {
    const old = before[id];
    if (!old) {
      changes[id] = record;
      continue;
    }
    const keys = new Set([...Object.keys(old), ...Object.keys(record)]);
    const fields = {};
    for (const key of keys) {
      if (!sameJson(old[key], record[key])) fields[key] = record[key] ?? null;
    }
    if (Object.keys(fields).length) changes[id] = fields;
  }
  for (const id of Object.keys(before)) {
    if (!(id in after)) changes[id] = null;
  }
  return changes;
}

function applyRecords(records, changes = {}) {
  const applied = { ...records };
  for (const [id, fields] of Object.entries(changes)) {
    if (fields === null) delete applied[id];
    else applied[id] = { ...applied[id], ...fields };
  }
  return applied;
}

const RECORD_GROUPS = ["teams", "rows", "games"];

function diffReadings(before, after) {
  const change = { at: after.at };
  if (before.projected !== after.projected) change.projected = after.projected;
  for (const group of RECORD_GROUPS) {
    const records = diffRecords(before[group], after[group]);
    if (Object.keys(records).length) change[group] = records;
  }
  return change;
}

const isEmptyChange = (change) => Object.keys(change).length === 1;

function applyChange(reading, change) {
  const applied = { at: change.at, projected: change.projected ?? reading.projected };
  for (const group of RECORD_GROUPS) applied[group] = applyRecords(reading[group], change[group]);
  return applied;
}

function replayPart(part) {
  let reading = part.start;
  const entries = [];
  for (const change of part.changes) {
    const next = applyChange(reading, change);
    entries.push(...LogChanges.findChanges(reading, next));
    reading = next;
  }
  return { entries, last: reading };
}

export const sortParts = (parts) =>
  [...parts].sort((first, second) => (first.id < second.id ? -1 : 1));

export const rebuildLog = (parts) => parts.flatMap((part) => replayPart(part).entries);

// The saved log keeps found entries only from before the oldest kept reading; after it, the
// rebuild has them.
export function composeLog(savedLog, parts, liveLog = []) {
  if (!parts || !parts.length) return LogChanges.mergeLog(savedLog, liveLog);
  const since = Date.parse(parts[0].start.at);
  const saved = savedLog.filter(
    (entry) => !LogChanges.isFoundEntry(entry) || Date.parse(entry.at) <= since,
  );
  return LogChanges.mergeLog(saved, [...rebuildLog(parts), ...liveLog]);
}

function createPart(dayName, number, start, changes) {
  return {
    id: `${dayName}-${String(number).padStart(2, "0")}`,
    day: dayName,
    number,
    start,
    changes,
  };
}

// The part `reading` goes into, or null when it adds nothing. A new day starts from the last
// reading before it, without its final scores, since those belong to the day before.
export function addReading(parts, dayName, reading) {
  const latest = parts[parts.length - 1];
  if (!latest) return createPart(dayName, 1, reading, []);
  if (latest.day > dayName) return null;
  const last = replayPart(latest).last;
  if (latest.day < dayName) {
    const start = { ...last, games: {} };
    const change = diffReadings(start, reading);
    return isEmptyChange(change) ? null : createPart(dayName, 1, start, [change]);
  }
  const change = diffReadings(last, reading);
  if (isEmptyChange(change)) return null;
  const extended = { ...latest, changes: [...latest.changes, change] };
  if (JSON.stringify(extended).length <= MAX_PART_LENGTH) return extended;
  return createPart(dayName, latest.number + 1, last, [change]);
}

function shiftDay(dayName, days) {
  const [year, month, day] = dayName.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

// The newest part stays whatever its age, as the start for the next one.
export function findExpiredParts(parts, dayName) {
  const cutoff = shiftDay(dayName, -KEPT_DAYS);
  return parts.slice(0, -1).filter((part) => part.day < cutoff);
}
