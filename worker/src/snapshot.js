import * as MLBSnapshot from "../../page/js/snapshot.js";

const FIRST_SEASON = 1995;
const LAST_SEASON = 2100;
const SEASON_RULE = `season must be a whole year between ${FIRST_SEASON} and ${LAST_SEASON}`;

const UPSTREAM_TIMEOUT_MS = 8000;
const EDGE_CACHE_SECONDS = 15; // under MLB's own 20-second cache
const SNAPSHOT_REUSE_MS = 10000;

const describeError = (error) => (error instanceof Error ? error.message : String(error));

const respondJson = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });

// Reads MLB for the page, so every open page shares one trip to MLB at a time.
export function createSnapshotServer({
  fetchImpl = (input, init) => fetch(input, init),
  now = () => Date.now(),
} = {}) {
  const recentSnapshots = new Map();

  async function fetchMlbJson(path) {
    const response = await fetchImpl(MLBSnapshot.MLB_API + path, {
      headers: { accept: "application/json", "user-agent": "mlb-postseason-page/1.0" },
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
      cf: { cacheTtl: EDGE_CACHE_SECONDS, cacheEverything: true },
    });
    if (!response.ok)
      throw new Error(`MLB Stats API answered ${response.status} for ${path.split("?")[0]}`);
    return response.json();
  }

  function loadSnapshot(season) {
    const requestedAt = now();
    const cached = recentSnapshots.get(season);
    if (cached && requestedAt - cached.at < SNAPSHOT_REUSE_MS) return cached.promise;
    const promise = MLBSnapshot.fetchSnapshot(fetchMlbJson, season, requestedAt);
    recentSnapshots.set(season, { at: requestedAt, promise });
    promise.catch(() => {
      if (recentSnapshots.get(season)?.promise === promise) recentSnapshots.delete(season);
    });
    return promise;
  }

  function readSeason(searchParams) {
    if (!searchParams.has("season")) return MLBSnapshot.easternDay(now()).year;
    const season = Number(searchParams.get("season"));
    const isValid = Number.isInteger(season) && season >= FIRST_SEASON && season <= LAST_SEASON;
    return isValid ? season : null;
  }

  /** @param {URL} url */
  async function serveSnapshot(url) {
    const season = readSeason(url.searchParams);
    if (season == null) return respondJson({ error: SEASON_RULE }, 400);
    try {
      return respondJson(await loadSnapshot(season));
    } catch (error) {
      return respondJson({ error: `Couldn't read MLB: ${describeError(error)}` }, 502);
    }
  }

  return { loadSnapshot, serveSnapshot };
}
