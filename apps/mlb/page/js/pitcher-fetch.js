// A pitcher's side of the matchup sheet, from the Worker, which reads MLB for it.

// Loading the league for the first time in a day takes the Worker a few seconds.
const FETCH_TIMEOUT_MS = 20 * 1000;
// A pitcher's numbers change at most once a game, so a sheet opened again soon reuses them.
const REUSE_MS = 10 * 60 * 1000;

const recent = new Map();

async function requestPitcher(id, season) {
  const response = await fetch(new URL(`pitcher?id=${id}&season=${season}`, location.href), {
    cache: "no-store",
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new Error(body?.error || `The Worker answered ${response.status}`);
  if (!body || body.id !== id) throw new Error("unexpected answer");
  return body;
}

/**
 * @param {number} id
 * @param {number} season
 */
export function fetchPitcher(id, season) {
  const key = `${season}/${id}`;
  const cached = recent.get(key);
  if (cached && Date.now() - cached.at < REUSE_MS) return cached.promise;
  const promise = requestPitcher(id, season);
  recent.set(key, { at: Date.now(), promise });
  promise.catch(() => {
    if (recent.get(key)?.promise === promise) recent.delete(key);
  });
  return promise;
}
