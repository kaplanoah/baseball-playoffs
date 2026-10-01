// A game's details for its sheet, from the Worker, which reads the league for them: the box score
// of a game that has started, and the preview of one that hasn't.

const FETCH_TIMEOUT_MS = 15 * 1000;
// A preview changes at most a few times a day, so a sheet opened again soon reuses it.
const PREVIEW_REUSE_MS = 10 * 60 * 1000;

const recentPreviews = new Map();

/**
 * @param {string} path the Worker's route, relative to the page
 * @returns {Promise<any>}
 */
async function requestJson(path) {
  const response = await fetch(new URL(path, location.href), {
    cache: "no-store",
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  const body = await response.json().catch(() => null);
  if (!response.ok)
    throw Object.assign(new Error(body?.error || `The Worker answered ${response.status}`), {
      status: response.status,
    });
  if (!body) throw new Error("unexpected answer");
  return body;
}

/** @param {string} id */
export async function fetchBoxScore(id) {
  const boxScore = await requestJson(`box-score?id=${encodeURIComponent(id)}`);
  if (boxScore.id !== id) throw new Error("unexpected answer");
  return boxScore;
}

/** @param {{ season: number, away: string, home: string }} game */
export function fetchPreview({ season, away, home }) {
  const query = new URLSearchParams({ season: String(season), away, home });
  const key = query.toString();
  const cached = recentPreviews.get(key);
  if (cached && Date.now() - cached.at < PREVIEW_REUSE_MS) return cached.promise;
  const promise = requestJson(`preview?${query}`);
  recentPreviews.set(key, { at: Date.now(), promise });
  promise.catch(() => {
    if (recentPreviews.get(key)?.promise === promise) recentPreviews.delete(key);
  });
  return promise;
}
