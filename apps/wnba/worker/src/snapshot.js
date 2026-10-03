import * as WNBASnapshot from "../../page/js/snapshot.js";
import { readEasternDay } from "#shared/days.js";
import { serveSeasonSnapshot } from "../../../../shared/worker/seasons.js";
import { createFeedKeeper } from "../../../../shared/worker/feed-keeper.js";
import { createReusedLoader, fetchUpstream } from "../../../../shared/worker/upstream.js";
import { createGameEnds } from "./game-ends.js";
import { createEspnGameReader, readEndTime } from "./lead.js";
import { ESPN_HEADERS, fetchWnbaJson, SEASON_PARAM } from "./wnba.js";

const EDGE_CACHE_SECONDS = 5;
const SNAPSHOT_REUSE_MS = 10000;
const DAY_MS = 24 * 60 * 60 * 1000;
// The schedule, bracket, standings, and players' averages change as games end, and otherwise
// hardly at all, and the stats site is slow and quick to turn away a busy caller.
const SLOW_FEEDS = {
  schedule: { maxAgeMs: DAY_MS, changesWithGames: true },
  standings: { maxAgeMs: DAY_MS, changesWithGames: true },
  players: { maxAgeMs: DAY_MS, changesWithGames: true },
  bracket: { maxAgeMs: DAY_MS, changesWithGames: true },
};

// Where each feed's answer keeps its data.
const FEED_DATA = {
  scoreboard: (answer) => answer?.scoreboard?.games,
  schedule: (answer) => answer?.leagueSchedule?.gameDates,
  bracket: (answer) => answer?.bracket?.playoffBracketSeries,
  standings: (answer) => answer?.resultSets?.[0]?.rowSet,
  players: (answer) => answer?.resultSets?.[0]?.rowSet,
};

const hasFeedData = (name, answer) => Array.isArray(FEED_DATA[name](answer));

// Where a game is on rarely changes, so ESPN's scoreboard is read at most this often.
const NETWORKS_MS = 6 * 60 * 60 * 1000;

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
  const slowFeeds = createFeedKeeper({ feeds: SLOW_FEEDS, leagueName: "The WNBA", now });
  const networkMonths = new Map();
  const espnGames = createEspnGameReader({ fetchImpl });
  const gameEnds = createGameEnds({
    loadEndTime: (game) =>
      espnGames
        .fetchSummary({ away: game.away.team, home: game.home.team, start: game.start })
        .then(readEndTime),
    now,
  });

  /**
   * @param {keyof typeof FEED_DATA} name
   * @param {string} url
   */
  const fetchFeed = (name, url) =>
    fetchWnbaJson(fetchImpl, url, EDGE_CACHE_SECONDS, (answer) => hasFeedData(name, answer));

  /**
   * @param {keyof typeof SLOW_FEEDS} name
   * @param {string} url
   */
  const readSlowFeed = (name, url) => slowFeeds.readFeed(name, url, () => fetchFeed(name, url));

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

  // A month's answer from after the month ended is final, so it's kept for good. Any other month is
  // read again now and then, and a read that fails waits as long as one that answers, with the
  // last good answer standing in meanwhile.
  /**
   * @param {{ answeredAt: number | null }} kept
   * @param {string} month
   */
  const isFinalAnswer = (kept, month) =>
    kept.answeredAt !== null && formatEspnMonth(kept.answeredAt) > month;

  /** @param {string} month */
  function isDueForNetworksRead(month) {
    const kept = networkMonths.get(month);
    if (!kept) return true;
    if (isFinalAnswer(kept, month)) return false;
    return now() - kept.readAt >= NETWORKS_MS;
  }

  /** @param {string} month */
  async function readNetworkMonth(month) {
    const kept = networkMonths.get(month);
    if (!isDueForNetworksRead(month)) return kept.data;
    try {
      const data = await fetchEspnJson(WNBASnapshot.NETWORKS_REQUEST(month));
      networkMonths.set(month, { readAt: now(), answeredAt: now(), data });
      return data;
    } catch {
      const answeredAt = kept?.answeredAt ?? null;
      const data = kept?.data ?? null;
      networkMonths.set(month, { readAt: now(), answeredAt, data });
      return data;
    }
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
    slowFeeds.noteFinalCount(scoreboard ? countFinals(scoreboard) : null);
    const [schedule, bracket, standings, players] = await Promise.all([
      readSlowFeed("schedule", WNBASnapshot.REQUESTS.schedule).catch(() => null),
      readSlowFeed("bracket", WNBASnapshot.REQUESTS.bracket(season)).catch(() => null),
      readSlowFeed("standings", WNBASnapshot.REQUESTS.standings(season)).catch(() => null),
      readSlowFeed("players", WNBASnapshot.REQUESTS.players(season)).catch(() => null),
    ]);
    if (!scoreboard && !schedule && !bracket)
      throw new Error("None of the WNBA's feeds answered with data");
    const [backup, networks] = await Promise.all([
      scoreboard ? null : fetchBackup().catch(() => null),
      readNetworks(schedule, season),
    ]);
    return { scoreboard, schedule, bracket, standings, players, backup, networks };
  }

  /**
   * @param {number} season
   * @param {number} requestedAt
   */
  async function fetchSnapshot(season, requestedAt) {
    const responses = await fetchResponses(season);
    const snapshot = WNBASnapshot.buildSnapshot(responses, { season, now: requestedAt });
    return { ...snapshot, games: await gameEnds.addEnds(snapshot.games) };
  }

  const loadSnapshot = createReusedLoader(fetchSnapshot, SNAPSHOT_REUSE_MS, now);

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
