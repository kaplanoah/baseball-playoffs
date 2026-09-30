import * as MLBSnapshot from "../../page/js/snapshot.js";
import { fetchMlbJson, readSeasonParam, SEASON_RULE } from "./mlb.js";
import { describeError, respondJson } from "./responses.js";

const EDGE_CACHE_SECONDS = 15; // under MLB's own 20-second cache
const SNAPSHOT_REUSE_MS = 10000;

// Reads MLB for the page, so every open page shares one trip to MLB at a time.
export function createSnapshotServer({
  fetchImpl = (input, init) => fetch(input, init),
  now = () => Date.now(),
} = {}) {
  const recentSnapshots = new Map();

  const fetchSnapshotJson = (path) => fetchMlbJson(fetchImpl, path, EDGE_CACHE_SECONDS);

  function loadSnapshot(season) {
    const requestedAt = now();
    const cached = recentSnapshots.get(season);
    if (cached && requestedAt - cached.at < SNAPSHOT_REUSE_MS) return cached.promise;
    const promise = MLBSnapshot.fetchSnapshot(fetchSnapshotJson, season, requestedAt);
    recentSnapshots.set(season, { at: requestedAt, promise });
    promise.catch(() => {
      if (recentSnapshots.get(season)?.promise === promise) recentSnapshots.delete(season);
    });
    return promise;
  }

  /** @param {URL} url */
  async function serveSnapshot(url) {
    const season = readSeasonParam(url.searchParams, now());
    if (season == null) return respondJson({ error: SEASON_RULE }, 400);
    try {
      return respondJson(await loadSnapshot(season));
    } catch (error) {
      return respondJson({ error: `Couldn't read MLB: ${describeError(error)}` }, 502);
    }
  }

  return { loadSnapshot, serveSnapshot };
}
