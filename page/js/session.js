import * as LogChanges from "./changes.js";

const FRESH_FINAL_MS = 10 * 60 * 1000;
const SEPTEMBER = 8;

// Until September the latest postseason is last year's.
export function seasonYear(now = new Date()) {
  const year = now.getFullYear();
  return now.getMonth() >= SEPTEMBER ? year : year - 1;
}

export const session = {
  db: null,
  activeYear: seasonYear(),
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
