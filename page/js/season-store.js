import { fullBracket } from "./bracket.js";
import { sameJson } from "./compare.js";
import { session, composeState } from "./session.js";

let unwatchSeason = null;
let unwatchStandings = null;

export function emptySeason(year) {
  return { year, teams: {}, series: {}, ranking: [], log: [] };
}

// The store hands documents back read-only, and this page edits its copies in place.
const readDoc = (snapshot) =>
  snapshot && snapshot.exists ? JSON.parse(JSON.stringify(snapshot.data())) : null;

function normalizeSeason(doc, year) {
  const season = doc || emptySeason(year);
  if (!season.teams) season.teams = {};
  if (!season.series) season.series = {};
  if (!season.ranking) season.ranking = [];
  if (!Array.isArray(season.log)) season.log = [];
  return season;
}

function collectTrackedTitles(docs) {
  const titles = {};
  for (const stored of docs) {
    const doc = stored.data();
    if (!doc || !doc.teams || !doc.series) continue;
    const year = Number(doc.year ?? stored.id);
    const champion = fullBracket(doc).ws?.winner;
    if (champion && Number.isFinite(year) && !(titles[champion] >= year)) titles[champion] = year;
  }
  return titles;
}

export async function loadSeasonList() {
  const result = await session.db.collection("seasons").limit(50).get();
  session.trackedTitles = collectTrackedTitles(result.docs);
  const stored = result.docs
    .map((doc) => doc.id)
    .sort()
    .reverse();
  const active = String(session.activeYear);
  return stored.includes(active) ? stored : [active, ...stored];
}

export async function loadSeason(year) {
  const snapshot = await session.db.doc(`seasons/${year}`).get();
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

export function watchSeason(year, onChange) {
  if (unwatchSeason) {
    unwatchSeason();
    unwatchSeason = null;
  }
  if (!session.db) return;
  unwatchSeason = session.db.doc(`seasons/${year}`).onSnapshot(
    (snapshot) => {
      if (!snapshot.exists || session.isReordering) return;
      const incoming = normalizeSeason(readDoc(snapshot), year);
      if (sameJson(incoming, session.seasonDoc)) return;
      session.seasonDoc = incoming;
      composeState();
      onChange();
    },
    () => {},
  );
}

// Writing the whole document would overwrite fields another open view has changed since.
export async function writeSeason(fields) {
  if (!session.db) return;
  const year = session.activeYear;
  const ref = session.db.doc(`seasons/${year}`);
  try {
    await ref.update(fields);
  } catch {
    // update() rejects when the document doesn't exist yet.
    await ref.set({ ...emptySeason(year), ...fields });
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
