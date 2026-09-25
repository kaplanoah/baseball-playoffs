import { fullBracket } from "./bracket.js";
import { sameJson } from "./compare.js";
import { session, composeState } from "./session.js";
import { TEAMS } from "./teams.js";

const SAVE_FAILED = "Couldn't save your last change. Try again in a moment.";
const LOAD_FAILED = "Couldn't load your saved data, so changes won't be saved this visit.";

let unwatchSeason = null;
let unwatchStandings = null;
let deferredSeason = null;

export function emptySeason(year) {
  return { year, teams: {}, series: {}, ranking: [], log: [] };
}

// The store hands documents back read-only, and this page edits its copies in place.
const readDoc = (snapshot) =>
  snapshot && snapshot.exists ? JSON.parse(JSON.stringify(snapshot.data())) : null;

const keepKnownClubs = (teams) =>
  Object.fromEntries(Object.entries(teams || {}).filter(([id]) => TEAMS[id]));

function normalizeSeason(doc, year) {
  const season = doc || emptySeason(year);
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
    const champion = fullBracket({ ...doc, teams: keepKnownClubs(doc.teams) }).ws?.winner;
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

export async function loadSeason(year) {
  const snapshot = session.db ? await session.db.doc(`seasons/${year}`).get() : null;
  session.seasonDoc = normalizeSeason(readDoc(snapshot), year);
  composeState();
}

export async function loadStandings(year) {
  session.storedStandings = null;
  if (session.db) {
    try {
      const snapshot = await session.db.doc(`standings/${year}`).get();
      session.storedStandings = readDoc(snapshot);
    } catch {
      session.storedStandings = null;
    }
  }
  composeState();
}

export function watchStandings(year, onChange) {
  if (unwatchStandings) {
    unwatchStandings();
    unwatchStandings = null;
  }
  if (!session.db) return;
  unwatchStandings = session.db.doc(`standings/${year}`).onSnapshot(
    (snapshot) => {
      if (!snapshot.exists) return;
      const incoming = readDoc(snapshot);
      if (sameJson(incoming, session.storedStandings)) return;
      session.storedStandings = incoming;
      composeState();
      onChange();
    },
    () => {},
  );
}

function applySeason(incoming) {
  if (sameJson(incoming, session.seasonDoc)) return false;
  session.seasonDoc = incoming;
  composeState();
  return true;
}

// A drag keeps the order it shows, so an update that arrives during one waits for it to end.
export function watchSeason(year, onChange) {
  if (unwatchSeason) {
    unwatchSeason();
    unwatchSeason = null;
  }
  deferredSeason = null;
  if (!session.db) return;
  unwatchSeason = session.db.doc(`seasons/${year}`).onSnapshot(
    (snapshot) => {
      if (!snapshot.exists) return;
      const incoming = normalizeSeason(readDoc(snapshot), year);
      if (session.isReordering) {
        deferredSeason = incoming;
        return;
      }
      if (applySeason(incoming)) onChange();
    },
    () => {},
  );
}

// The drag's own order wins over the one in the deferred update.
export function applyDeferredSeason() {
  if (!deferredSeason) return;
  const incoming = { ...deferredSeason, ranking: session.seasonDoc.ranking };
  deferredSeason = null;
  applySeason(incoming);
}

// Writing the whole document would overwrite fields another open view has changed since.
async function writeSeason(fields) {
  if (!session.db) return;
  const year = session.activeYear;
  const ref = session.db.doc(`seasons/${year}`);
  try {
    const stored = await ref.get();
    if (stored.exists) await ref.update(fields);
    else await ref.set({ ...emptySeason(year), ...fields });
    if (session.saveProblem === SAVE_FAILED) session.saveProblem = null;
  } catch (error) {
    session.saveProblem = SAVE_FAILED;
    throw error;
  }
}

export async function saveTeams(teams) {
  const ranking = Object.keys(teams).sort(
    (first, second) => teams[first].seed - teams[second].seed,
  );
  Object.assign(session.seasonDoc, { teams, series: {}, ranking });
  composeState();
  await writeSeason({ teams, series: {}, ranking });
}

export async function saveRanking(order) {
  session.seasonDoc.ranking = order;
  session.state.ranking = order;
  await writeSeason({ ranking: order });
}

export async function saveSeenAt(at) {
  session.seasonDoc.seenAt = at;
  session.state.seenAt = at;
  await writeSeason({ seenAt: at });
}
