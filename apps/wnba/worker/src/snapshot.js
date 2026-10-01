import * as WNBASnapshot from "../../page/js/snapshot.js";
import { readEasternDate } from "../../page/js/days.js";
import { serveSeasonSnapshot } from "../../../../shared/worker/seasons.js";
import { createReusedLoader, fetchUpstream } from "../../../../shared/worker/upstream.js";
import { FEED_HEADERS, fetchWnbaJson, SEASON_PARAM } from "./wnba.js";

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

// Where each feed's answer keeps its data.
const FEED_DATA = {
  scoreboard: (answer) => answer?.scoreboard?.games,
  schedule: (answer) => answer?.leagueSchedule?.gameDates,
  bracket: (answer) => answer?.bracket?.playoffBracketSeries,
  standings: (answer) => answer?.resultSets?.[0]?.rowSet,
  players: (answer) => answer?.resultSets?.[0]?.rowSet,
};

const hasFeedData = (name, answer) => Array.isArray(FEED_DATA[name](answer));

const BACKUP_HEADERS = { accept: "application/json", "user-agent": FEED_HEADERS["user-agent"] };
const DAY_MS = 24 * 60 * 60 * 1000;

const formatEspnDay = (ms) => readEasternDate(ms).replaceAll("-", "");

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
  let lastFinals = null;

  /**
   * @param {keyof typeof FEED_DATA} name
   * @param {string} url
   */
  const fetchFeed = (name, url) =>
    fetchWnbaJson(fetchImpl, url, EDGE_CACHE_SECONDS, (answer) => hasFeedData(name, answer));

  // A slow feed's last good answer stands in when a read fails. Each season's are kept apart.
  async function readSlowFeed(name, url, isStale) {
    const kept = slowFeeds.get(url);
    if (kept && !isStale && now() - kept.at < SLOW_FEED_MS[name]) return kept.data;
    try {
      const data = await fetchFeed(name, url);
      slowFeeds.set(url, { at: now(), data });
      return data;
    } catch (error) {
      if (kept) return kept.data;
      throw error;
    }
  }

  async function fetchBackupJson(url) {
    const response = await fetchUpstream(fetchImpl, url, {
      headers: BACKUP_HEADERS,
      cacheSeconds: EDGE_CACHE_SECONDS,
    });
    if (!response.ok) throw new Error(`ESPN answered ${response.status}`);
    return response.json();
  }

  async function fetchBackupGame(eventId) {
    const competition = await fetchBackupJson(WNBASnapshot.BACKUP_REQUESTS.competition(eventId));
    const [status, ...scores] = await Promise.all([
      fetchBackupJson(upgradeLink(competition.status.$ref)),
      ...competition.competitors.map((competitor) =>
        fetchBackupJson(upgradeLink(competitor.score.$ref)),
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
    const listing = await fetchBackupJson(request);
    const eventIds = (listing.items ?? []).map((item) => readEventId(item.$ref)).filter(Boolean);
    const games = await Promise.all(eventIds.map((id) => fetchBackupGame(id).catch(() => null)));
    return { games: games.filter(Boolean) };
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
    const backup = scoreboard ? null : await fetchBackup().catch(() => null);
    return { scoreboard, schedule, bracket, standings, players, backup };
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
