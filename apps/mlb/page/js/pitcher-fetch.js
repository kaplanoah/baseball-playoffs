// What the matchup sheet reads from the Worker, which reads MLB for it: a pitcher's side, or the
// last starters of a club that hasn't named one.

// Loading the league for the first time in a day takes the Worker a few seconds.
const FETCH_TIMEOUT_MS = 20 * 1000;
// A pitcher's numbers and a club's starts change at most once a game, so a sheet opened again
// soon reuses them.
const REUSE_MS = 10 * 60 * 1000;

const recent = new Map();

async function requestFromWorker(path, isExpected) {
  const response = await fetch(new URL(path, location.href), {
    cache: "no-store",
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new Error(body?.error || `The Worker answered ${response.status}`);
  if (!body || !isExpected(body)) throw new Error("unexpected answer");
  return body;
}

function fetchReused(path, isExpected) {
  const cached = recent.get(path);
  if (cached && Date.now() - cached.at < REUSE_MS) return cached.promise;
  const promise = requestFromWorker(path, isExpected);
  recent.set(path, { at: Date.now(), promise });
  promise.catch(() => {
    if (recent.get(path)?.promise === promise) recent.delete(path);
  });
  return promise;
}

/**
 * @param {number} id
 * @param {number} season
 */
export const fetchPitcher = (id, season) =>
  fetchReused(`pitcher?id=${id}&season=${season}`, (body) => body.id === id);

/**
 * @param {string} club
 * @param {string} date the league's day of the game the club hasn't named a starter for
 */
export const fetchRotation = (club, date) =>
  fetchReused(
    `rotation?club=${club}&date=${date}`,
    (body) => body.club === club && Array.isArray(body.starters),
  );
