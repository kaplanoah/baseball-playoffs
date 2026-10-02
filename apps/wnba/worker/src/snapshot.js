import * as WNBASnapshot from "../../page/js/snapshot.js";
import { readEasternDay } from "#shared/days.js";
import { serveSeasonSnapshot } from "../../../../shared/worker/seasons.js";
import { createReusedLoader, fetchUpstream } from "../../../../shared/worker/upstream.js";
import { ESPN_HEADERS, fetchWnbaJson, SEASON_PARAM } from "./wnba.js";

const EDGE_CACHE_SECONDS = 5;
const SNAPSHOT_REUSE_MS = 10000;
// The schedule, standings, and players' averages change a few times a day, and the stats site is
// slow and quick to turn away a busy caller, so they're read at most this often. The bracket
// changes only when a game ends, so it's read again then, or after a while regardless.
const SLOW_FEED_MS = {
  schedule: 60 * 60 * 1000,
  standings: 60 * 60 * 1000,
  players: 60 * 60 * 1000,
  bracket: 10 * 60 * 1000,
};
// A slow feed that didn't answer isn't asked again for a while, since a hung read holds up each
// update until it times out.
const FAILED_FEED_WAIT_MS = 5 * 60 * 1000;

// Where each feed's answer keeps its data.
const FEED_DATA = {
  scoreboard: (answer) => answer?.scoreboard?.games,
  schedule: (answer) => answer?.leagueSchedule?.gameDates,
  bracket: (answer) => answer?.bracket?.playoffBracketSeries,
  standings: (answer) => answer?.resultSets?.[0]?.rowSet,
  players: (answer) => answer?.resultSets?.[0]?.rowSet,
};

const hasFeedData = (name, answer) => Array.isArray(FEED_DATA[name](answer));

const DAY_MS = 24 * 60 * 60 * 1000;
// Where a game is on rarely changes, so ESPN's scoreboard is read at most this often.
const NETWORKS_MS = 10 * 60 * 1000;

const formatEspnDay = (ms) => readEasternDay(ms).date.replaceAll("-", "");
const formatEspnMonth = (ms) => formatEspnDay(ms).slice(0, 6);

// ESPN's own links are plain http, so they're read over https instead.
const upgradeLink = (link) => String(link).replace(/^http:/, "https:");

const readEventId = (link) => String(link).match(/\/events\/(\d+)/)?.[1] ?? null;

const countFinals = (scoreboard) =>
  (scoreboard?.scoreboard?.games ?? []).filter((game) => game.gameStatus === 3).length;

// Reads the league for the page, so every open page shares one trip to it at a time.
export function createSnapshotServer({
  fetchImpl = (input, init) => fetch(input, init),
  now = () => Date.now(),
} = {}) {
  const slowFeeds = new Map();
  const failedFeeds = new Map();
  let lastFinals = null;
  const networkMonths = new Map();

  /**
   * @param {keyof typeof FEED_DATA} name
   * @param {string} url
   */
  const fetchFeed = (name, url) =>
    fetchWnbaJson(fetchImpl, url, EDGE_CACHE_SECONDS, (answer) => hasFeedData(name, answer));

  /**
   * @param {keyof typeof SLOW_FEED_MS} name
   * @param {string} url
   * @param {boolean} isStale
   */
  function isDueForRead(name, url, isStale) {
    const failedAt = failedFeeds.get(url);
    if (failedAt !== undefined && now() - failedAt < FAILED_FEED_WAIT_MS) return false;
    const kept = slowFeeds.get(url);
    return !kept || isStale || now() - kept.at >= SLOW_FEED_MS[name];
  }

  // A slow feed's last good answer stands in when a read fails or waits. Each season's are kept
  // apart.
  async function readSlowFeed(name, url, isStale) {
    const kept = slowFeeds.get(url);
    if (!isDueForRead(name, url, isStale)) {
      if (kept) return kept.data;
      throw new Error(`The WNBA didn't answer ${name} a moment ago`);
    }
    try {
      const data = await fetchFeed(name, url);
      slowFeeds.set(url, { at: now(), data });
      failedFeeds.delete(url);
      return data;
    } catch (error) {
      failedFeeds.set(url, now());
      if (kept) return kept.data;
      throw error;
    }
  }

  async function fetchEspnJson(url) {
    const response = await fetchUpstream(fetchImpl, url, {
      headers: ESPN_HEADERS,
      cacheSeconds: EDGE_CACHE_SECONDS,
    });
    if (!response.ok) throw new Error(`ESPN answered ${response.status}`);
    return response.json();
  }

  async function fetchBackupGame(eventId) {
    const competition = await fetchEspnJson(WNBASnapshot.BACKUP_REQUESTS.competition(eventId));
    const [status, ...scores] = await Promise.all([
      fetchEspnJson(upgradeLink(competition.status.$ref)),
      ...competition.competitors.map((competitor) =>
        fetchEspnJson(upgradeLink(competitor.score.$ref)),
      ),
    ]);
    return { competition, status, scores };
  }

  // Yesterday's games too, since a late game is still being played after midnight Eastern. A game
  // ESPN didn't answer for is left out, so it doesn't keep the others from standing in.
  async function fetchBackup() {
    const request = WNBASnapshot.BACKUP_REQUESTS.events(
      formatEspnDay(now() - DAY_MS),
      formatEspnDay(now()),
    );
    const listing = await fetchEspnJson(request);
    const eventIds = (listing.items ?? []).map((item) => readEventId(item.$ref)).filter(Boolean);
    const games = await Promise.all(eventIds.map((id) => fetchBackupGame(id).catch(() => null)));
    return { games: games.filter(Boolean) };
  }

  // A month that's over keeps its first good answer for good. This month's and later ones are read
  // again now and then, and a read that fails waits as long as one that answers, with the last
  // good answer standing in meanwhile.
  /** @param {string} month */
  function isDueForNetworksRead(month) {
    const kept = networkMonths.get(month);
    if (!kept) return true;
    if (kept.data && month < formatEspnMonth(now())) return false;
    return now() - kept.readAt >= NETWORKS_MS;
  }

  /** @param {string} month */
  async function readNetworkMonth(month) {
    if (!isDueForNetworksRead(month)) return networkMonths.get(month).data;
    const data = await fetchEspnJson(WNBASnapshot.NETWORKS_REQUEST(month)).catch(
      () => networkMonths.get(month)?.data ?? null,
    );
    networkMonths.set(month, { readAt: now(), data });
    return data;
  }

  // Each month with a playoff game, and yesterday's and today's, since a late game is still being
  // played after midnight Eastern, and the schedule may not have answered.
  function listNetworkMonths(schedule, season) {
    const starts = WNBASnapshot.listScheduledStarts(schedule, season).map(Date.parse);
    const times = [now() - DAY_MS, now(), ...starts].filter(Number.isFinite);
    return [...new Set(times.map(formatEspnMonth))].sort();
  }

  async function readNetworks(schedule, season) {
    const months = listNetworkMonths(schedule, season);
    const answers = await Promise.all(months.map(readNetworkMonth));
    return answers.filter(Boolean);
  }

  async function fetchResponses(season) {
    const scoreboard = await fetchFeed("scoreboard", WNBASnapshot.REQUESTS.scoreboard).catch(
      () => null,
    );
    // A scoreboard that didn't answer counts no finals, so it leaves the count as it was.
    const finals = scoreboard ? countFinals(scoreboard) : lastFinals;
    const hasNewFinal = lastFinals !== null && finals > lastFinals;
    lastFinals = finals;
    const [schedule, bracket, standings, players] = await Promise.all([
      readSlowFeed("schedule", WNBASnapshot.REQUESTS.schedule, hasNewFinal).catch(() => null),
      readSlowFeed("bracket", WNBASnapshot.REQUESTS.bracket(season), hasNewFinal).catch(() => null),
      readSlowFeed("standings", WNBASnapshot.REQUESTS.standings(season), false).catch(() => null),
      readSlowFeed("players", WNBASnapshot.REQUESTS.players(season), false).catch(() => null),
    ]);
    if (!scoreboard && !schedule && !bracket)
      throw new Error("None of the WNBA's feeds answered with data");
    const [backup, networks] = await Promise.all([
      scoreboard ? null : fetchBackup().catch(() => null),
      readNetworks(schedule, season),
    ]);
    return { scoreboard, schedule, bracket, standings, players, backup, networks };
  }

  const loadSnapshot = createReusedLoader(
    (season, requestedAt) =>
      fetchResponses(season).then((responses) =>
        WNBASnapshot.buildSnapshot(responses, { season, now: requestedAt }),
      ),
    SNAPSHOT_REUSE_MS,
    now,
  );

  /** @param {URL} url */
  const serveSnapshot = (url) =>
    serveSeasonSnapshot(url, {
      seasonParam: SEASON_PARAM,
      loadSnapshot,
      leagueName: "the WNBA",
      now,
    });

  return { loadSnapshot, serveSnapshot };
}
