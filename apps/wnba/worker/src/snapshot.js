import * as WNBASnapshot from "../../page/js/snapshot.js";
import { describeError, respondJson } from "../../../../shared/worker/responses.js";

const FIRST_SEASON = 1997;
const LAST_SEASON = 2100;
const SEASON_RULE = `season must be a whole year between ${FIRST_SEASON} and ${LAST_SEASON}`;

const UPSTREAM_TIMEOUT_MS = 8000;
const EDGE_CACHE_SECONDS = 15;
const SNAPSHOT_REUSE_MS = 10000;
// The schedule and standings change a few times a day, and the stats site is slow and quick to
// turn away a busy caller, so they're read at most this often. The bracket changes only when a
// game ends, so it's read again then, or after a while regardless.
const SLOW_FEED_MS = {
  schedule: 60 * 60 * 1000,
  standings: 60 * 60 * 1000,
  bracket: 10 * 60 * 1000,
};

// The league's feeds answer only what looks like its own site in a browser: without these, the
// CDN answers with a web page and the stats site never answers at all.
const FEED_HEADERS = {
  accept: "application/json, text/plain, */*",
  "accept-language": "en-US,en;q=0.9",
  "user-agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36",
  origin: "https://www.wnba.com",
  referer: "https://www.wnba.com/",
  "sec-fetch-dest": "empty",
  "sec-fetch-mode": "cors",
  "sec-fetch-site": "same-site",
};

const countFinals = (scoreboard) =>
  (scoreboard?.scoreboard?.games ?? []).filter((game) => game.gameStatus === 3).length;

// Reads the league for the page, so every open page shares one trip to it at a time.
export function createSnapshotServer({
  fetchImpl = (input, init) => fetch(input, init),
  now = () => Date.now(),
} = {}) {
  const recentSnapshots = new Map();
  const slowFeeds = new Map();
  let lastFinals = null;

  // A refusal comes back as a web page with a 200, so only JSON counts as an answer.
  async function fetchFeed(url) {
    const response = await fetchImpl(url, {
      headers: FEED_HEADERS,
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
      cf: { cacheTtl: EDGE_CACHE_SECONDS, cacheEverything: true },
    });
    const path = new URL(url).pathname;
    if (!response.ok) throw new Error(`The WNBA answered ${response.status} for ${path}`);
    const text = await response.text();
    try {
      return JSON.parse(text);
    } catch {
      throw new Error(`The WNBA answered ${path} with something other than data`);
    }
  }

  // A slow feed's last good answer stands in when a read fails.
  async function readSlowFeed(name, url, isStale) {
    const kept = slowFeeds.get(name);
    if (kept && !isStale && now() - kept.at < SLOW_FEED_MS[name]) return kept.data;
    try {
      const data = await fetchFeed(url);
      slowFeeds.set(name, { at: now(), data });
      return data;
    } catch (error) {
      if (kept) return kept.data;
      throw error;
    }
  }

  async function fetchResponses(season) {
    const scoreboard = await fetchFeed(WNBASnapshot.REQUESTS.scoreboard).catch(() => null);
    // A scoreboard that didn't answer counts no finals, so it leaves the count as it was.
    const finals = scoreboard ? countFinals(scoreboard) : lastFinals;
    const hasNewFinal = lastFinals !== null && finals > lastFinals;
    lastFinals = finals;
    const [schedule, bracket, standings] = await Promise.all([
      readSlowFeed("schedule", WNBASnapshot.REQUESTS.schedule, hasNewFinal).catch(() => null),
      readSlowFeed("bracket", WNBASnapshot.REQUESTS.bracket(season), hasNewFinal).catch(() => null),
      readSlowFeed("standings", WNBASnapshot.REQUESTS.standings(season), false).catch(() => null),
    ]);
    if (!scoreboard && !schedule && !bracket)
      throw new Error("None of the WNBA's feeds answered with data");
    return { scoreboard, schedule, bracket, standings };
  }

  function loadSnapshot(season) {
    const requestedAt = now();
    const cached = recentSnapshots.get(season);
    if (cached && requestedAt - cached.at < SNAPSHOT_REUSE_MS) return cached.promise;
    const promise = fetchResponses(season).then((responses) =>
      WNBASnapshot.buildSnapshot(responses, { season, now: requestedAt }),
    );
    recentSnapshots.set(season, { at: requestedAt, promise });
    promise.catch(() => {
      if (recentSnapshots.get(season)?.promise === promise) recentSnapshots.delete(season);
    });
    return promise;
  }

  function readSeason(searchParams) {
    if (!searchParams.has("season")) return new Date(now()).getUTCFullYear();
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
      return respondJson({ error: `Couldn't read the WNBA: ${describeError(error)}` }, 502);
    }
  }

  return { loadSnapshot, serveSnapshot };
}
