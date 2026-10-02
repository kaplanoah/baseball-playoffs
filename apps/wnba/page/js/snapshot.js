// Runs in both the browser page and the Worker, so it uses no DOM and no globals.
// The league's own feeds: today's scoreboard and the season's schedule from its CDN, and the
// playoff bracket, the standings, and the players' season averages from its stats site. When the
// scoreboard doesn't answer, ESPN's stands in for today's scores and clocks. The league's feeds
// don't say where a game is on, so ESPN's scoreboard does.

import { findTeamCode, findTeamCodeByEspnId, TEAMS } from "./teams.js";

const WNBA_CDN = "https://cdn.wnba.com";
const WNBA_STATS = "https://stats.wnba.com";
const ESPN_CORE = "https://sports.core.api.espn.com/v2/sports/basketball/leagues/wnba";
const ESPN_SITE = "https://site.api.espn.com/apis/site/v2/sports/basketball/wnba";

const LEAGUE_FEEDS = ["bracket", "players", "schedule", "scoreboard", "standings"];

export const REQUESTS = {
  scoreboard: `${WNBA_CDN}/static/json/liveData/scoreboard/todaysScoreboard_10.json`,
  schedule: `${WNBA_CDN}/static/json/staticData/scheduleLeagueV2_10.json`,
  /** @param {number} season */
  bracket: (season) =>
    `${WNBA_STATS}/stats/playoffbracket?LeagueID=10&SeasonYear=${season}&State=2`,
  /** @param {number} season */
  standings: (season) =>
    `${WNBA_STATS}/stats/leaguestandingsv3?LeagueID=10&Season=${season}&SeasonType=Regular+Season`,
  /** @param {number} season */
  players: (season) =>
    `${WNBA_STATS}/stats/leaguedashplayerstats?${new URLSearchParams({
      College: "",
      Conference: "",
      Country: "",
      DateFrom: "",
      DateTo: "",
      Division: "",
      DraftPick: "",
      DraftYear: "",
      GameScope: "",
      GameSegment: "",
      Height: "",
      LastNGames: "0",
      LeagueID: "10",
      Location: "",
      MeasureType: "Base",
      Month: "0",
      OpponentTeamID: "0",
      Outcome: "",
      PORound: "0",
      PaceAdjust: "N",
      PerMode: "PerGame",
      Period: "0",
      PlayerExperience: "",
      PlayerPosition: "",
      PlusMinus: "N",
      Rank: "N",
      Season: String(season),
      SeasonSegment: "",
      SeasonType: "Regular Season",
      ShotClockRange: "",
      StarterBench: "",
      TeamID: "0",
      VsConference: "",
      VsDivision: "",
      Weight: "",
    })}`,
};

export const BACKUP_REQUESTS = {
  /**
   * @param {string} firstDay as YYYYMMDD
   * @param {string} lastDay as YYYYMMDD
   */
  events: (firstDay, lastDay) => `${ESPN_CORE}/events?dates=${firstDay}-${lastDay}`,
  /** @param {string} eventId */
  competition: (eventId) => `${ESPN_CORE}/events/${eventId}/competitions/${eventId}`,
};

/** @param {string} day as YYYYMMDD */
export const NETWORKS_REQUEST = (day) => `${ESPN_SITE}/scoreboard?dates=${day}`;

export const ROUNDS = {
  1: { name: "First Round", shortName: "1st Rd", bestOf: 3 },
  2: { name: "Semifinals", shortName: "Semis", bestOf: 5 },
  3: { name: "WNBA Finals", shortName: "Finals", bestOf: 7 },
};
const countWinsNeeded = (round) => Math.ceil(ROUNDS[round].bestOf / 2);

// A playoff game's ID spells out where it sits: 104, the season's last two digits, 00, then its
// round, its series in that round from 0, and its game in the series.
const PLAYOFF_GAME_ID = /^104(\d{2})00([1-3])(\d)(\d)$/;

/** @param {string} id */
export function readPlayoffGameId(id) {
  const [, season, round, series, game] = String(id).match(PLAYOFF_GAME_ID) ?? [];
  if (!round) return null;
  return {
    season: 2000 + Number(season),
    round: Number(round),
    series: Number(series),
    game: Number(game),
  };
}

const nameSeries = (round, series) => `${round}-${series}`;

const GAME_STATES = { 1: "pre", 2: "live", 3: "final" };

/** @param {number} gameStatus the feeds' 1, 2, or 3 */
export const readGameState = (gameStatus) => GAME_STATES[gameStatus] ?? "pre";

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
  const state = readGameState(game.gameStatus);
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

/**
 * The stats site answers with a table: its column names, then a row of values for each line.
 * @param {any} response
 * @returns {Record<string, any>[]}
 */
function readStatsTable(response) {
  const table = response?.resultSets?.[0];
  if (!table) return [];
  return table.rowSet.map((row) =>
    Object.fromEntries(table.headers.map((header, index) => [header, row[index]])),
  );
}

// The standings' PlayoffRank is the league-wide place, and its LeagueRank the conference place.
function readStandingsRows(response) {
  return readStatsTable(response)
    .map((row) => ({
      team: findTeamCode(row.TeamID),
      conference: row.Conference,
      wins: row.WINS,
      losses: row.LOSSES,
      place: row.PlayoffRank,
      conferencePlace: row.LeagueRank,
      gamesBack: row.LeagueGamesBack ?? null,
      conferenceGamesBack: row.ConferenceGamesBack ?? null,
      clinch: String(row.ClinchIndicator ?? "").replace(/^\s*-\s*/, "") || null,
      streak: row.strCurrentStreak || null,
      lastTen: row.L10 || null,
      pointsFor: row.PointsPG ?? null,
      pointsAgainst: row.OppPointsPG ?? null,
      margin: row.DiffPointsPG ?? null,
      home: row.HOME || null,
      road: row.ROAD || null,
    }))
    .filter((row) => row.team)
    .sort((first, second) => first.place - second.place);
}

// The feed gives a player's name whole; everything after the first space is her last name.
function splitName(name) {
  const [firstName, ...rest] = String(name).split(" ");
  return { firstName, lastName: rest.join(" ") };
}

/**
 * A team's best scorers by points a game. A player who has missed most of the team's games
 * doesn't lead it, however well she scores.
 * @param {any} players the stats site's season averages
 * @param {string} team
 * @param {number} count
 */
function listTeamLeaders(players, team, count) {
  const rows = readStatsTable(players).filter((row) => findTeamCode(row.TEAM_ID) === team);
  const most = Math.max(0, ...rows.map((row) => row.GP));
  return rows
    .filter((row) => row.GP >= most / 2)
    .sort((first, second) => second.PTS - first.PTS)
    .slice(0, count)
    .map((row) => ({
      id: row.PLAYER_ID,
      ...splitName(row.PLAYER_NAME),
      games: row.GP,
      points: row.PTS,
      rebounds: row.REB,
      assists: row.AST,
    }));
}

// A team's sheet and a game's preview each show a team's leading three.
const LEADERS_PER_TEAM = 3;

const listLeaders = (players) =>
  Object.keys(TEAMS).flatMap((team) =>
    listTeamLeaders(players, team, LEADERS_PER_TEAM).map((leader) => ({ team, ...leader })),
  );

// The schedule and the scoreboard hold the last season's games until the league starts the next.
const listPlayoffGames = (games, season) =>
  games.filter((game) => readPlayoffGameId(game.gameId)?.season === season);

// The scoreboard is the freshest word on today's games, so it replaces the schedule's copy.
function mergeGames(schedule, scoreboard, season) {
  const scheduled = listPlayoffGames(
    (schedule?.leagueSchedule?.gameDates ?? []).flatMap((day) => day.games),
    season,
  ).map(normalizeGame);
  const today = listPlayoffGames(scoreboard?.scoreboard?.games ?? [], season).map(normalizeGame);
  const byId = new Map(scheduled.map((game) => [game.id, game]));
  for (const game of today) byId.set(game.id, game);
  return [...byId.values()].sort(
    (first, second) => Date.parse(first.start) - Date.parse(second.start),
  );
}

// A team not known yet has a seed of 0 in the feeds, and goes after the one that is, as in the bracket.
const readSeedOrder = (side) => (side.team ? side.seed : Infinity);

// A series counts its wins from the games it has finished, with or without the bracket.
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

function addCountedWins(side, counted) {
  if (!side) return null;
  const countedSide = [counted?.top, counted?.bottom].find((other) => other?.team === side.team);
  return { ...side, wins: Math.max(side.wins, countedSide?.wins ?? 0) };
}

const findSeriesWinner = (round, sides) =>
  sides.find((side) => side && side.wins >= countWinsNeeded(round))?.team ?? null;

// The first game of the series not yet finished.
function findNextGame(seriesId, games) {
  const [next] = games
    .filter((game) => game.series === seriesId && game.state !== "final")
    .sort((first, second) => first.number - second.number);
  return next ? { id: next.id, start: next.start } : null;
}

// The bracket trails a final by minutes, so each side keeps the most wins either the bracket or
// the finished games give it, and a next game already finished gives way to the one after it.
function combineSeries(bracketSeries, countedSeries, games) {
  const countedById = new Map(countedSeries.map((record) => [record.id, record]));
  const finishedIds = new Set(
    games.filter((game) => game.state === "final").map((game) => game.id),
  );
  return bracketSeries.map((record) => {
    const counted = countedById.get(record.id);
    const top = addCountedWins(record.top, counted);
    const bottom = addCountedWins(record.bottom, counted);
    const winner = record.winner ?? findSeriesWinner(record.round, [top, bottom]);
    const isNextGameFinished = !!record.nextGame && finishedIds.has(record.nextGame.id);
    const nextGame = winner
      ? null
      : isNextGameFinished
        ? findNextGame(record.id, games)
        : record.nextGame;
    const hasNewWins = top?.wins !== record.top?.wins || bottom?.wins !== record.bottom?.wins;
    return { ...record, top, bottom, winner, nextGame, status: hasNewWins ? "" : record.status };
  });
}

const BACKUP_STATES = { pre: "pre", in: "live", post: "final" };

/** @param {{ competition: any, status: any, scores: any[] }} answers */
function readBackupGame({ competition, status, scores }) {
  const state = BACKUP_STATES[status?.type?.state] ?? "pre";
  const sides = Object.fromEntries(
    competition.competitors.map((competitor, index) => [
      competitor.homeAway,
      { team: findTeamCodeByEspnId(competitor.id), score: scores[index]?.value ?? null },
    ]),
  );
  return {
    start: competition.date,
    state,
    status: status?.type?.shortDetail?.trim() || "",
    period: state === "pre" ? null : (status?.period ?? null),
    clock: state === "live" ? (status?.displayClock ?? null) : null,
    home: sides.home,
    away: sides.away,
  };
}

const MATCH_WINDOW_MS = 24 * 60 * 60 * 1000;
const isSameMatchup = (game, backup) =>
  game.home.team === backup.home?.team && game.away.team === backup.away?.team;
const measureStartGap = (game, backup) =>
  Math.abs(Date.parse(game.start) - Date.parse(backup.start));

// ESPN numbers its games its own way, so an ESPN game stands for the league's game between the
// same home and away teams that starts nearest it.
function findEspnGame(game, espnGames) {
  const [nearest] = espnGames
    .filter((espnGame) => isSameMatchup(game, espnGame))
    .filter((espnGame) => measureStartGap(game, espnGame) < MATCH_WINDOW_MS)
    .sort((first, second) => measureStartGap(game, first) - measureStartGap(game, second));
  return nearest ?? null;
}

// Each league game a started ESPN game stands for, by the league's game ID. A game ESPN hasn't
// started keeps the league's own word on it.
function matchBackupGames(games, backupGames) {
  const startedGames = backupGames.filter((backup) => backup.state !== "pre");
  return new Map(
    games.map((game) => [game.id, findEspnGame(game, startedGames)]).filter(([, backup]) => backup),
  );
}

function applyBackupGame(game, backup) {
  const { state, status, period, clock } = backup;
  return {
    ...game,
    state,
    status,
    period,
    clock,
    away: { ...game.away, score: backup.away.score },
    home: { ...game.home, score: backup.home.score },
  };
}

const isNational = (broadcast) => broadcast.market === "national";
const isLocal = (broadcast) => !isNational(broadcast);

// What an ESPN scoreboard game is on, its national channels first.
function readNetworkGame(event) {
  const competition = event.competitions?.[0] ?? {};
  const sides = Object.fromEntries(
    (competition.competitors ?? []).map((competitor) => [
      competitor.homeAway,
      { team: findTeamCodeByEspnId(competitor.id) },
    ]),
  );
  const broadcasts = competition.broadcasts ?? [];
  const ordered = [...broadcasts.filter(isNational), ...broadcasts.filter(isLocal)];
  return {
    start: competition.date ?? event.date,
    home: sides.home,
    away: sides.away,
    networks: [...new Set(ordered.flatMap((broadcast) => broadcast.names ?? []))],
  };
}

const isWatchable = (game) => game.state === "pre" || game.state === "live";

/**
 * Where each game still to come or under way is on, as far as ESPN knows.
 * @param {any[]} games
 * @param {any[]} networkGames
 */
const addNetworks = (games, networkGames) =>
  games.map((game) => ({
    ...game,
    networks: isWatchable(game) ? (findEspnGame(game, networkGames)?.networks ?? []) : [],
  }));

/**
 * @param {{ scoreboard?: any, schedule?: any, bracket?: any, standings?: any, players?: any, backup?: { games: any[] } | null, networks?: any[] | null }} responses
 * @param {{ season: number, now?: number }} options
 */
export function buildSnapshot(responses, { season, now = Date.now() }) {
  const backupGames =
    !responses.scoreboard && responses.backup ? responses.backup.games.map(readBackupGame) : [];
  const leagueGames = mergeGames(responses.schedule, responses.scoreboard, season);
  const standIns = matchBackupGames(leagueGames, backupGames);
  const games = addNetworks(
    leagueGames.map((game) =>
      standIns.has(game.id) ? applyBackupGame(game, standIns.get(game.id)) : game,
    ),
    (responses.networks ?? []).flatMap((answer) => answer.events ?? []).map(readNetworkGame),
  );
  const bracket = responses.bracket?.bracket?.playoffBracketSeries;
  const countedSeries = countSeriesFromGames(games);
  const series = bracket
    ? combineSeries(bracket.map(readBracketSeries), countedSeries, games)
    : countedSeries;
  return {
    version: 1,
    season,
    asOf: new Date(now).toISOString(),
    games,
    series,
    standings: readStandingsRows(responses.standings),
    leaders: listLeaders(responses.players),
    missing: LEAGUE_FEEDS.filter((name) => !responses[name]),
    standIn: standIns.size ? "espn" : null,
  };
}

export const POLL_LIVE_MS = 15 * 1000;
const POLL_LEAD_MS = 15 * 60 * 1000;
const POLL_CHECK_MS = 60 * 60 * 1000;
const LATE_START_LIMIT_MS = 3 * 60 * 60 * 1000;

// A start time passed with the game not under way is a late start, so it keeps the fast rate. A
// game still waiting hours after its start was put off, or isn't needed and the schedule hasn't
// dropped it yet.
export function choosePollDelay(snapshot, now = Date.now()) {
  const games = snapshot?.games ?? [];
  if (games.some((game) => game.state === "live")) return POLL_LIVE_MS;
  const starts = games
    .filter((game) => game.state === "pre" && game.isTimeSet)
    .map((game) => Date.parse(game.start))
    .filter((start) => start > now - LATE_START_LIMIT_MS);
  const untilLead = Math.min(...starts) - POLL_LEAD_MS - now;
  return Math.min(Math.max(untilLead, POLL_LIVE_MS), POLL_CHECK_MS);
}
