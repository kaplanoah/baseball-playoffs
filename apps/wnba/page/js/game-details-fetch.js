// A game's details for its sheet, from the Worker, which reads the league for them: the box score
// of a game that has started, and the preview of one that hasn't.
import { reloadWhenSignedOut } from "#shared/access.js";

const FETCH_TIMEOUT_MS = 15 * 1000;
// A box score read as a finger comes down on its game serves the sheet that opens on the tap,
// and a live game's next read, a poll later, is a new one.
const BOX_SCORE_REUSE_MS = 5 * 1000;
// A preview changes at most a few times a day, so a sheet opened again soon reuses it.
const PREVIEW_REUSE_MS = 10 * 60 * 1000;

const recentAnswers = new Map();

/**
 * @param {string} path the Worker's route, relative to the page
 * @returns {Promise<any>}
 */
async function requestJson(path) {
  const response = await fetch(new URL(path, location.href), {
    cache: "no-store",
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  reloadWhenSignedOut(response);
  const body = await response.json().catch(() => null);
  if (!response.ok)
    throw Object.assign(new Error(body?.error || `The Worker answered ${response.status}`), {
      status: response.status,
    });
  if (!body) throw new Error("unexpected answer");
  return body;
}

/**
 * The Worker's answer for a path, or the one already read or under way for it in the last while.
 * @param {string} path
 * @param {number} reuseMs
 * @returns {Promise<any>}
 */
function requestReused(path, reuseMs) {
  const cached = recentAnswers.get(path);
  if (cached && Date.now() - cached.at < reuseMs) return cached.promise;
  const promise = requestJson(path);
  recentAnswers.set(path, { at: Date.now(), promise });
  promise.catch(() => {
    if (recentAnswers.get(path)?.promise === promise) recentAnswers.delete(path);
  });
  return promise;
}

/** @param {string} id */
export async function fetchBoxScore(id) {
  const boxScore = await requestReused(
    `box-score?id=${encodeURIComponent(id)}`,
    BOX_SCORE_REUSE_MS,
  );
  if (boxScore.id !== id) throw new Error("unexpected answer");
  return boxScore;
}

/** @param {{ season: number, away: string, home: string }} game */
export function fetchPreview({ season, away, home }) {
  const query = new URLSearchParams({ season: String(season), away, home });
  return requestReused(`preview?${query}`, PREVIEW_REUSE_MS);
}
