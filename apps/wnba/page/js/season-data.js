import { session } from "./session.js";

// The Worker keeps each season in the store as it plays out, and pushes every change to the page.

const nameSeasonPath = (year) => `seasons/${year}`;
const STATUS_PATH = "live/status";
const UNREACHABLE = "Can't reach the page's server right now.";

/** @param {number} year */
async function readSeason(year) {
  const snapshot = await session.db.doc(nameSeasonPath(year)).get();
  return snapshot.exists ? snapshot.data() : null;
}

// Before a new season's playoffs, the page shows the last one's.
export async function loadSeason() {
  const thisYear = new Date().getFullYear();
  try {
    session.season = await readSeason(thisYear);
    session.year = thisYear;
    if (!session.season) {
      session.season = await readSeason(thisYear - 1);
      if (session.season) session.year = thisYear - 1;
    }
    session.problem = "";
  } catch {
    session.problem = UNREACHABLE;
  }
}

/** @param {() => void} onChange */
export function watchSeason(onChange) {
  session.db.doc(nameSeasonPath(session.year)).onSnapshot(
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
