import * as MLBSnapshot from "../../page/js/snapshot.js";
import { fetchMlbJson, SEASON_PARAM } from "./mlb.js";
import { serveSeasonSnapshot } from "../../../../shared/worker/seasons.js";
import { createReusedLoader } from "../../../../shared/worker/upstream.js";

const EDGE_CACHE_SECONDS = 15; // under MLB's own 20-second cache
const SNAPSHOT_REUSE_MS = 10000;

// Reads MLB for the page, so every open page shares one trip to MLB at a time.
export function createSnapshotServer({
  fetchImpl = (input, init) => fetch(input, init),
  now = () => Date.now(),
} = {}) {
  const fetchSnapshotJson = (path) => fetchMlbJson(fetchImpl, path, EDGE_CACHE_SECONDS);

  const loadSnapshot = createReusedLoader(
    (season, requestedAt) => MLBSnapshot.fetchSnapshot(fetchSnapshotJson, season, requestedAt),
    SNAPSHOT_REUSE_MS,
    now,
  );

  /** @param {URL} url */
  const serveSnapshot = (url) =>
    serveSeasonSnapshot(url, { seasonParam: SEASON_PARAM, loadSnapshot, leagueName: "MLB", now });

  return { loadSnapshot, serveSnapshot };
}
