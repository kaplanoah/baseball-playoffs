import { readEasternDay } from "#shared/days.js";
import { session } from "./session.js";

// The Worker keeps each season in the store as it plays out, and pushes every change to the page.
// It also says which season is current, so the page never goes by its own clock.

const nameSeasonPath = (year) => `seasons/${year}`;
const STATUS_PATH = "live/status";
const CURRENT_PATH = "live/current";
const UNREACHABLE = "Can't reach the page's server right now.";

/** @param {string} path */
async function readDoc(path) {
  const snapshot = await session.db.doc(path).get();
  return snapshot.exists ? snapshot.data() : null;
}

// A store that hasn't yet said which season is current has this year's, once it has games, and
// otherwise last year's.
async function readUnsaidSeason() {
  const { year } = readEasternDay(Date.now());
  const season = await readDoc(nameSeasonPath(year));
  return season
    ? { year, season }
    : { year: year - 1, season: await readDoc(nameSeasonPath(year - 1)) };
}

async function readCurrentSeason() {
  const current = await readDoc(CURRENT_PATH);
  if (!current) return readUnsaidSeason();
  return { year: current.season, season: await readDoc(nameSeasonPath(current.season)) };
}

export async function loadSeason() {
  try {
    const { year, season } = await readCurrentSeason();
    Object.assign(session, { year, season, problem: "" });
  } catch {
    session.problem = UNREACHABLE;
  }
}

/**
 * Calls `onTurnover` when the store says a season other than the page's is current.
 * @param {() => void} onTurnover
 */
export function watchCurrentSeason(onTurnover) {
  session.db.doc(CURRENT_PATH).onSnapshot(
    (snapshot) => {
      if (snapshot.exists && snapshot.data().season !== session.year) onTurnover();
    },
    () => {},
  );
}

/** @type {(() => void) | null} */
let unwatchSeason = null;

/** @param {() => void} onChange */
export function watchSeason(onChange) {
  unwatchSeason?.();
  unwatchSeason = session.db.doc(nameSeasonPath(session.year)).onSnapshot(
    (snapshot) => {
      if (!snapshot.exists) return;
      session.season = snapshot.data();
      session.problem = "";
      onChange();
    },
    () => {},
  );
}

/** @param {() => void} onChange */
export function watchStatus(onChange) {
  session.db.doc(STATUS_PATH).onSnapshot(
    (snapshot) => {
      session.status = snapshot.exists ? snapshot.data() : null;
      onChange();
    },
    () => {},
  );
}
