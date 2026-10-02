import { buildBracket } from "./bracket.js";
import { isSameJson } from "#shared/compare.js";
import { nameReadingsCollection, sortParts } from "./readings.js";
import { session, composeState } from "./session.js";
import { TEAMS } from "./teams.js";

const SAVE_FAILED = "Couldn't save your last change. Try again in a moment.";
const LOAD_FAILED = "Couldn't load your saved data, so changes won't be saved this visit.";

let deferredSeason = null;

function createEmptySeason(year) {
  return { year, teams: {}, series: {}, ranking: [], log: [] };
}

// The store hands documents back read-only, and this page edits its copies in place.
const readDoc = (snapshot) =>
  snapshot && snapshot.exists ? JSON.parse(JSON.stringify(snapshot.data())) : null;

const keepKnownClubs = (teams) =>
  Object.fromEntries(Object.entries(teams || {}).filter(([id]) => TEAMS[id]));

function normalizeSeason(doc, year) {
  const season = doc || createEmptySeason(year);
  season.teams = keepKnownClubs(season.teams);
  if (!season.series) season.series = {};
  season.ranking = Array.isArray(season.ranking) ? season.ranking.filter((id) => TEAMS[id]) : [];
  if (!Array.isArray(season.log)) season.log = [];
  return season;
}

// Saving stops once a read fails, so nothing is written over data this page never saw.
export function stopSavingAfterFailedLoad() {
  session.db = null;
  session.saveProblem = LOAD_FAILED;
}

function collectTrackedTitles(docs) {
  const titles = {};
  for (const stored of docs) {
    const doc = stored.data();
    if (!doc || !doc.teams || !doc.series) continue;
    const year = Number(doc.year ?? stored.id);
    const champion = buildBracket({ ...doc, teams: keepKnownClubs(doc.teams) }).ws?.winner;
    if (champion && Number.isFinite(year) && !(titles[champion] >= year)) titles[champion] = year;
  }
  return titles;
}

export async function loadSeasonList() {
  const result = await session.db.collection("seasons").limit(50).get();
  session.trackedTitles = collectTrackedTitles(result.docs);
  const stored = result.docs
    .map((doc) => doc.id)
    .filter((id) => /^\d{4}$/.test(id))
    .sort()
    .reverse();
  const active = String(session.activeYear);
  return stored.includes(active) ? stored : [active, ...stored];
}

// A season keeps a few weeks of readings, a part or two a day, so one listing holds them all.
const READING_PARTS_LIMIT = 100;

// Nothing on the page edits a reading, so the store's read-only copies are used as they are.
const readParts = (docs) => sortParts(docs.map((doc) => doc.data()));

let unwatchYear = [];
let isYearLoaded = false;

function stopWatchingYear() {
  for (const unwatch of unwatchYear) unwatch();
  unwatchYear = [];
  isYearLoaded = false;
}

/**
 * Each watch's first answer, or its first failure, is its part of the year's load. Until the
 * whole year has loaded, answers only fill in the session; after that, a change redraws.
 * @returns {Promise<void>}
 */
function watchYearPart(reference, applyAnswer, onChange) {
  return new Promise((resolve, reject) => {
    const unwatch = reference.onSnapshot((answer) => {
      const hasChanged = applyAnswer(answer);
      resolve();
      if (!hasChanged || !isYearLoaded) return;
      composeState();
      onChange();
    }, reject);
    unwatchYear.push(unwatch);
  });
}

function replaceSeason(incoming) {
  if (isSameJson(incoming, session.seasonDoc)) return false;
  session.seasonDoc = incoming;
  return true;
}

// Saves echo back in order, and the echo of one while a newer save is on its way would put
// back an order this page has moved on from.
let unechoedRankings = [];

function keepNewerRanking(incoming) {
  const index = unechoedRankings.indexOf(incoming.ranking.join());
  if (index === -1) return incoming;
  unechoedRankings = unechoedRankings.slice(index + 1);
  return unechoedRankings.length ? { ...incoming, ranking: session.seasonDoc.ranking } : incoming;
}

// A drag keeps the order it shows, so a season that arrives during one waits for it to end.
function applySeasonAnswer(snapshot, year) {
  const incoming = keepNewerRanking(normalizeSeason(readDoc(snapshot), year));
  if (!session.isReordering) return replaceSeason(incoming);
  deferredSeason = incoming;
  return false;
}

function applyStandingsAnswer(snapshot) {
  const incoming = readDoc(snapshot);
  if (isSameJson(incoming, session.storedStandings)) return false;
  session.storedStandings = incoming;
  return true;
}

// The Worker saves a reading whenever the standings change, and updates are rebuilt from them.
function applyReadingsAnswer({ docs }) {
  const incoming = readParts(docs);
  if (isSameJson(incoming, session.readings)) return false;
  session.readings = incoming;
  return true;
}

/**
 * Watches a year's season, standings, and readings, and resolves once each has answered. It
 * rejects when the season can't be read; standings or readings that can't be read are left out.
 * @param {number} year
 * @param {{ onSeasonChange: () => void, onStandingsChange: () => void, onReadingsChange: () => void }} redraws
 */
export async function watchYear(year, { onSeasonChange, onStandingsChange, onReadingsChange }) {
  stopWatchingYear();
  deferredSeason = null;
  unechoedRankings = [];
  const { db } = session;
  const readings = db.collection(nameReadingsCollection(year)).limit(READING_PARTS_LIMIT);
  await Promise.all([
    watchYearPart(
      db.doc(`seasons/${year}`),
      (snapshot) => applySeasonAnswer(snapshot, year),
      onSeasonChange,
    ),
    watchYearPart(db.doc(`standings/${year}`), applyStandingsAnswer, onStandingsChange).catch(
      () => {
        session.storedStandings = null;
      },
    ),
    watchYearPart(readings, applyReadingsAnswer, onReadingsChange).catch(() => {
      session.readings = null;
    }),
  ]);
  if (year !== session.activeYear) return;
  isYearLoaded = true;
  composeState();
}

// Without the store, the page shows an empty season that it doesn't save.
export function showUnsavedSeason(year) {
  stopWatchingYear();
  session.seasonDoc = normalizeSeason(null, year);
  session.storedStandings = null;
  session.readings = null;
  composeState();
}

// A drag that moved a club keeps its own order over the one in the deferred update.
export function applyDeferredSeason(hasMoved) {
  if (!deferredSeason) return;
  const incoming = hasMoved
    ? { ...deferredSeason, ranking: session.seasonDoc.ranking }
    : deferredSeason;
  deferredSeason = null;
  if (replaceSeason(incoming)) composeState();
}

// Writing the whole document would overwrite fields another open view has changed since.
async function writeSeason(fields) {
  if (!session.db) return;
  try {
    await session.db.doc(`seasons/${session.activeYear}`).update(fields);
    if (session.saveProblem === SAVE_FAILED) session.saveProblem = null;
  } catch (error) {
    session.saveProblem = SAVE_FAILED;
    throw error;
  }
}

export async function saveRanking(order) {
  session.seasonDoc.ranking = order;
  session.state.ranking = order;
  const saved = order.join();
  if (session.db) unechoedRankings.push(saved);
  try {
    await writeSeason({ ranking: order });
  } catch (error) {
    unechoedRankings = unechoedRankings.filter((pending) => pending !== saved);
    throw error;
  }
}

export async function saveSeenAt(at) {
  session.seasonDoc.seenAt = at;
  session.state.seenAt = at;
  await writeSeason({ seenAt: at });
}
