import { isSameJson } from "#shared/compare.js";
import { composeLog } from "./readings.js";
import { readEasternDay, hasKnownField } from "./snapshot.js";

const FRESH_FINAL_MS = 10 * 60 * 1000;
const APRIL = 4;

// A season starts on the day spring training does, which is always before April, so the
// first guess is only in doubt from January through March.
export function guessSeasonYear(now = Date.now()) {
  const { date, year } = readEasternDay(now);
  return Number(date.slice(5, 7)) >= APRIL ? year : year - 1;
}

export const hasSpringStarted = (springStart, now = Date.now()) =>
  !!springStart && readEasternDay(now).date >= springStart;

export const session = {
  db: null,
  currentSeason: guessSeasonYear(),
  activeYear: guessSeasonYear(),
  seasonDoc: null,
  storedStandings: null,
  // The active season's parts of readings, oldest first, or null when they couldn't be read.
  readings: null,
  live: null,
  liveProblem: null,
  saveProblem: null,
  state: null,
  standings: null,
  trackedTitles: {},
  isReordering: false,
};

export const readSeasonYear = () => session.currentSeason;

const countDecidedGames = (record) => (record ? record.winsA + record.winsB : -1);

// The Worker saves the season and answers the page's live reads from separate trips to MLB, so
// either can be the one that has seen a game end. A series only moves forward, so each keeps
// whichever record has counted more of its games.
function pickLatestSeries(doc, live) {
  if (!isSameJson(doc.teams, live.teams)) return live.series;
  const saved = doc.series || {};
  return Object.fromEntries(
    Object.entries(live.series).map(([id, record]) => [
      id,
      countDecidedGames(saved[id]) > countDecidedGames(record) ? saved[id] : record,
    ]),
  );
}

function overlayLiveSnapshot(doc) {
  const { live } = session;
  if (!live || live.season !== session.activeYear)
    return { ...doc, log: composeLog(doc.log, session.readings) };
  const slate = live.slate && {
    ...live.slate,
    since: new Date(Date.parse(live.asOf) - FRESH_FINAL_MS).toISOString(),
  };
  const field = hasKnownField(live)
    ? { teams: live.teams, series: pickLatestSeries(doc, live), projected: live.projected }
    : {};
  return {
    ...doc,
    ...field,
    slate,
    log: composeLog(doc.log, session.readings, live.log),
  };
}

export function composeState() {
  const { live } = session;
  session.state = overlayLiveSnapshot(session.seasonDoc);
  session.standings =
    (live && live.season === session.activeYear && live.standings) || session.storedStandings;
}
