// Runs in both the browser page and the Worker, so it uses no DOM and no globals.
// The league's own feeds: today's scoreboard and the season's schedule from its CDN, and the
// playoff bracket and standings from its stats site.

import { findTeamCode } from "./teams.js";

const WNBA_CDN = "https://cdn.wnba.com";
const WNBA_STATS = "https://stats.wnba.com";

export const REQUESTS = {
  scoreboard: `${WNBA_CDN}/static/json/liveData/scoreboard/todaysScoreboard_10.json`,
  schedule: `${WNBA_CDN}/static/json/staticData/scheduleLeagueV2_10.json`,
  /** @param {number} season */
  bracket: (season) =>
    `${WNBA_STATS}/stats/playoffbracket?LeagueID=10&SeasonYear=${season}&State=2`,
  /** @param {number} season */
  standings: (season) =>
    `${WNBA_STATS}/stats/leaguestandingsv3?LeagueID=10&Season=${season}&SeasonType=Regular+Season`,
};

export const ROUNDS = {
  1: { name: "First Round", shortName: "1st Rd", bestOf: 3 },
  2: { name: "Semifinals", shortName: "Semis", bestOf: 5 },
  3: { name: "WNBA Finals", shortName: "Finals", bestOf: 7 },
};
const countWinsNeeded = (round) => Math.ceil(ROUNDS[round].bestOf / 2);

// A playoff game's ID spells out where it sits: 104, the season's last two digits, 00, then its
// round, its series in that round from 0, and its game in the series.
const PLAYOFF_GAME_ID = /^104\d{2}00([1-3])(\d)(\d)$/;

/** @param {string} id */
export function readPlayoffGameId(id) {
  const [, round, series, game] = String(id).match(PLAYOFF_GAME_ID) ?? [];
  return round ? { round: Number(round), series: Number(series), game: Number(game) } : null;
}

const nameSeries = (round, series) => `${round}-${series}`;

const GAME_STATES = { 1: "pre", 2: "live", 3: "final" };

// The CDN's clock reads like PT04M32.00S; the page shows 4:32, and tenths under a minute.
export function readClock(clock) {
  const [, minutes, seconds] = String(clock ?? "").match(/^PT(\d+)M([\d.]+)S$/) ?? [];
  if (minutes === undefined) return null;
  const wholeMinutes = Number(minutes);
  const exactSeconds = Number(seconds);
  if (wholeMinutes === 0 && exactSeconds < 60) return exactSeconds.toFixed(1);
  return `${wholeMinutes}:${String(Math.floor(exactSeconds)).padStart(2, "0")}`;
}

const readSide = (team) => ({
  team: team.teamTricode || null,
  seed: team.seed ?? null,
  score: team.score ?? null,
  seriesWins: team.wins ?? null,
  isInBonus: team.inBonus === "1" || team.inBonus === 1 || team.inBonus === true,
  timeouts: team.timeoutsRemaining ?? null,
});

// A playoff game from the scoreboard or the schedule, which name their fields alike.
function normalizeGame(game) {
  const place = readPlayoffGameId(game.gameId);
  const state = GAME_STATES[game.gameStatus] ?? "pre";
  return {
    id: String(game.gameId),
    round: place?.round ?? null,
    series: place ? nameSeries(place.round, place.series) : null,
    number: place?.game ?? null,
    start: game.gameDateTimeUTC ?? game.gameTimeUTC ?? null,
    state,
    status: game.gameStatusText?.trim() || "",
    // A game whose time isn't set yet reads TBD, and its start is a placeholder on its day.
    isTimeSet: !/^TBD$/i.test(game.gameStatusText?.trim() ?? ""),
    period: state === "pre" ? null : (game.period ?? null),
    clock: state === "live" ? readClock(game.gameClock) : null,
    isIfNeeded: !!game.ifNecessary,
    away: readSide(game.awayTeam ?? {}),
    home: readSide(game.homeTeam ?? {}),
  };
}

const readSeed = (tricode, rank) => (tricode ? { team: tricode, seed: rank || null } : null);

function readBracketSeries(series) {
  const top = readSeed(series.highSeedTricode, series.highSeedRank);
  const bottom = readSeed(series.lowSeedTricode, series.lowSeedRank);
  return {
    id: nameSeries(series.roundNumber, series.seriesNumber),
    round: series.roundNumber,
    top: top && { ...top, wins: series.highSeedSeriesWins ?? 0 },
    bottom: bottom && { ...bottom, wins: series.lowSeedSeriesWins ?? 0 },
    winner: findTeamCode(series.seriesWinner),
    status: series.seriesText?.trim() || "",
    nextGame: series.nextGameId
      ? { id: String(series.nextGameId), start: series.nextGameDateTimeUTC || null }
      : null,
  };
}

// The standings' PlayoffRank is the league-wide place, and its LeagueRank the conference place.
function readStandingsRows(response) {
  const table = response?.resultSets?.[0];
  if (!table) return [];
  const column = Object.fromEntries(table.headers.map((header, index) => [header, index]));
  return table.rowSet
    .map((row) => ({
      team: findTeamCode(row[column.TeamID]),
      conference: row[column.Conference],
      wins: row[column.WINS],
      losses: row[column.LOSSES],
      place: row[column.PlayoffRank],
      conferencePlace: row[column.LeagueRank],
      gamesBack: row[column.LeagueGamesBack] ?? null,
      conferenceGamesBack: row[column.ConferenceGamesBack] ?? null,
      clinch: String(row[column.ClinchIndicator] ?? "").replace(/^\s*-\s*/, "") || null,
      streak: row[column.strCurrentStreak] || null,
      lastTen: row[column.L10] || null,
    }))
    .filter((row) => row.team)
    .sort((first, second) => first.place - second.place);
}

const listPlayoffGames = (games) => games.filter((game) => readPlayoffGameId(game.gameId));

// The scoreboard is the freshest word on today's games, so it replaces the schedule's copy.
function mergeGames(schedule, scoreboard) {
  const scheduled = listPlayoffGames(
    (schedule?.leagueSchedule?.gameDates ?? []).flatMap((day) => day.games),
  ).map(normalizeGame);
  const today = listPlayoffGames(scoreboard?.scoreboard?.games ?? []).map(normalizeGame);
  const byId = new Map(scheduled.map((game) => [game.id, game]));
  for (const game of today) byId.set(game.id, game);
  return [...byId.values()].sort(
    (first, second) => Date.parse(first.start) - Date.parse(second.start),
  );
}

// A team not known yet has a seed of 0 in the feeds, and goes after the one that is, as in the bracket.
const readSeedOrder = (side) => (side.team ? side.seed : Infinity);

// Without the bracket, a series still counts its wins from the games it has finished.
function countSeriesFromGames(games) {
  const series = {};
  for (const game of games) {
    if (!game.series) continue;
    const [top, bottom] = [game.home, game.away].sort(
      (first, second) => readSeedOrder(first) - readSeedOrder(second),
    );
    series[game.series] ??= {
      id: game.series,
      round: game.round,
      top: top.team ? { team: top.team, seed: top.seed, wins: 0 } : null,
      bottom: bottom.team ? { team: bottom.team, seed: bottom.seed, wins: 0 } : null,
      winner: null,
      status: "",
      nextGame: null,
    };
    const record = series[game.series];
    if (game.state !== "final" || !record.top || !record.bottom) continue;
    const winner = game.home.score > game.away.score ? game.home.team : game.away.team;
    const side = winner === record.top.team ? record.top : record.bottom;
    side.wins += 1;
    if (side.wins >= countWinsNeeded(game.round)) record.winner = side.team;
  }
  return Object.values(series);
}

/**
 * @param {{ scoreboard?: any, schedule?: any, bracket?: any, standings?: any }} responses
 * @param {{ season: number, now?: number }} options
 */
export function buildSnapshot(responses, { season, now = Date.now() }) {
  const games = mergeGames(responses.schedule, responses.scoreboard);
  const bracket = responses.bracket?.bracket?.playoffBracketSeries;
  const series = bracket ? bracket.map(readBracketSeries) : countSeriesFromGames(games);
  return {
    version: 1,
    season,
    asOf: new Date(now).toISOString(),
    games,
    series,
    standings: readStandingsRows(responses.standings),
    missing: Object.entries(responses)
      .filter(([, response]) => !response)
      .map(([name]) => name)
      .sort(),
  };
}

export const POLL_LIVE_MS = 30 * 1000;
const POLL_LEAD_MS = 15 * 60 * 1000;
const POLL_CHECK_MS = 60 * 60 * 1000;

// A start time passed with the game not under way is a late start, so it keeps the fast rate.
export function choosePollDelay(snapshot, now = Date.now()) {
  const games = snapshot?.games ?? [];
  if (games.some((game) => game.state === "live")) return POLL_LIVE_MS;
  const starts = games
    .filter((game) => game.state === "pre" && game.isTimeSet)
    .map((game) => Date.parse(game.start))
    .filter(Number.isFinite);
  const untilLead = Math.min(...starts) - POLL_LEAD_MS - now;
  return Math.min(Math.max(untilLead, POLL_LIVE_MS), POLL_CHECK_MS);
}
