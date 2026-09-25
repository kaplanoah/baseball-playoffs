import * as LogChanges from "./changes.js";
import { easternDay } from "./snapshot.js";

const FRESH_FINAL_MS = 10 * 60 * 1000;
const APRIL = 4;

// A season starts on the day spring training does, which is always before April, so the
// first guess is only in doubt from January through March.
export function guessSeasonYear(now = Date.now()) {
  const { date, year } = easternDay(now);
  return Number(date.slice(5, 7)) >= APRIL ? year : year - 1;
}

export const hasSpringStarted = (springStart, now = Date.now()) =>
  !!springStart && easternDay(now).date >= springStart;

export const session = {
  db: null,
  currentSeason: guessSeasonYear(),
  activeYear: guessSeasonYear(),
  seasonDoc: null,
  storedStandings: null,
  live: null,
  liveProblem: null,
  saveProblem: null,
  state: null,
  standings: null,
  trackedTitles: {},
  isReordering: false,
};

export const seasonYear = () => session.currentSeason;

function overlayLiveSnapshot(doc) {
  const { live } = session;
  if (!live || live.season !== session.activeYear) return doc;
  const slate = live.slate && {
    ...live.slate,
    since: new Date(Date.parse(live.asOf) - FRESH_FINAL_MS).toISOString(),
  };
  return {
    ...doc,
    teams: live.teams,
    series: live.series,
    projected: live.projected,
    slate,
    log: LogChanges.mergeLog(doc.log, live.log),
  };
}

export function composeState() {
  const { live } = session;
  session.state = overlayLiveSnapshot(session.seasonDoc);
  session.standings =
    (live && live.season === session.activeYear && live.standings) || session.storedStandings;
}
