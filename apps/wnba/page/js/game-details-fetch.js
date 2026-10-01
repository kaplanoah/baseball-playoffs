// A game's details for its sheet, from the Worker, which reads the league for them: the box score
// of a game that has started, and the preview of one that hasn't.

import { fetchFromWorker } from "#shared/worker-fetch.js";

const FETCH_TIMEOUT_MS = 15 * 1000;
// A box score read as a finger comes down on its game serves the sheet that opens on the tap,
// and a live game's next read, a poll later, is a new one.
const BOX_SCORE_REUSE_MS = 5 * 1000;
// A preview changes at most a few times a day, so a sheet opened again soon reuses it.
const PREVIEW_REUSE_MS = 10 * 60 * 1000;

/** @param {string} id */
export const fetchBoxScore = (id) =>
  fetchFromWorker(`box-score?id=${encodeURIComponent(id)}`, {
    reuseMs: BOX_SCORE_REUSE_MS,
    timeoutMs: FETCH_TIMEOUT_MS,
    isExpected: (body) => body.id === id,
  });

/** @param {{ season: number, away: string, home: string }} game */
export function fetchPreview({ season, away, home }) {
  const query = new URLSearchParams({ season: String(season), away, home });
  return fetchFromWorker(`preview?${query}`, {
    reuseMs: PREVIEW_REUSE_MS,
    timeoutMs: FETCH_TIMEOUT_MS,
    isExpected: (body) =>
      body.season === season && body.away?.team === away && body.home?.team === home,
  });
}
