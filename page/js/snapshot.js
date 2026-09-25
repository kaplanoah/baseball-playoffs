// Runs in both the browser page and the Worker, so it uses no DOM and no globals.

export const MLB_API = "https://statsapi.mlb.com";

// Postseason placeholders ("AL #3 Seed") have made-up ids, so a miss means no real club yet.
const MLB_TEAM = {
  108: "LAA",
  109: "ARI",
  110: "BAL",
  111: "BOS",
  112: "CHC",
  113: "CIN",
  114: "CLE",
  115: "COL",
  116: "DET",
  117: "HOU",
  118: "KC",
  119: "LAD",
  120: "WSH",
  121: "NYM",
  133: "ATH",
  134: "PIT",
  135: "SD",
  136: "SEA",
  137: "SF",
  138: "STL",
  139: "TB",
  140: "TEX",
  141: "TOR",
  142: "MIN",
  143: "PHI",
  144: "ATL",
  145: "CWS",
  146: "MIA",
  147: "NYY",
  158: "MIL",
};
const MLB_DIVISION = {
  200: "AL West",
  201: "AL East",
  202: "AL Central",
  203: "NL West",
  204: "NL East",
  205: "NL Central",
};

const GAME_FIELDS = [
  "dates",
  "date",
  "games",
  "gamePk",
  "gameType",
  "gameDate",
  "officialDate",
  "status",
  "abstractGameState",
  "detailedState",
  "codedGameState",
  "startTimeTBD",
  "teams",
  "away",
  "home",
  "team",
  "id",
  "name",
  "score",
  "seriesGameNumber",
  "seriesDescription",
  "linescore",
  "currentInning",
  "gameInfo",
  "firstPitch",
  "gameDurationMinutes",
].join(",");
const STANDINGS_FIELDS = [
  "records",
  "division",
  "id",
  "teamRecords",
  "team",
  "wins",
  "losses",
  "winningPercentage",
  "divisionGamesBack",
  "wildCardGamesBack",
  "eliminationNumber",
  "wildCardEliminationNumber",
  "divisionChamp",
  "divisionLeader",
  "divisionRank",
  "wildCardRank",
  "leagueRank",
  "clinchIndicator",
].join(",");

// The requests filter with `fields=`, so a field MLB renames or drops comes back as nothing.
const isNumber = (value) => typeof value === "number" && Number.isFinite(value);
const isText = (value) => typeof value === "string" && value !== "";
const isBoolean = (value) => typeof value === "boolean";
const isNumericText = (value) => isText(value) && Number.isFinite(Number(value));
const isDay = (value) => typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
const isTime = (value) => isText(value) && !Number.isNaN(Date.parse(value));
const isPresent = (value) => value !== undefined && value !== null && value !== "";
const hasPlayed = (record) => record.wins + record.losses > 0;
const isFinal = (game) => readGameState(game.status || {}) === "final";
const hasStarted = (game) => ["live", "final"].includes(readGameState(game.status || {}));

// With `onSome`, a field is only missing when no item it applies to has it.
/**
 * @param {string} path
 * @param {(value: any) => boolean} isValid
 * @param {(item: any) => boolean} [appliesTo]
 * @param {boolean} [onSome]
 */
const requireField = (path, isValid, appliesTo = () => true, onSome = false) => ({
  path,
  isValid,
  appliesTo,
  onSome,
});
const FIELD_RULES = {
  division: [requireField("division.id", isNumber), requireField("teamRecords", Array.isArray)],
  club: [
    requireField("team.id", isNumber),
    requireField("wins", isNumber),
    requireField("losses", isNumber),
    requireField("winningPercentage", isNumericText, hasPlayed),
    requireField("divisionRank", isNumericText, hasPlayed),
    requireField("leagueRank", isNumericText, hasPlayed),
    requireField("divisionGamesBack", isPresent, hasPlayed),
    requireField("wildCardGamesBack", isPresent, hasPlayed),
    requireField("eliminationNumber", isPresent, hasPlayed),
    requireField("wildCardEliminationNumber", isPresent, hasPlayed),
    requireField("divisionChamp", isBoolean, hasPlayed),
    requireField("divisionLeader", isBoolean, hasPlayed),
    requireField(
      "wildCardRank",
      isNumericText,
      (record) => hasPlayed(record) && record.divisionLeader === false,
    ),
    requireField("clinchIndicator", isText, (record) => record.divisionChamp === true),
  ],
  date: [requireField("date", isDay), requireField("games", Array.isArray)],
  game: [
    requireField("gamePk", isNumber),
    requireField("gameType", isText),
    requireField("gameDate", isTime),
    requireField("officialDate", isDay),
    requireField("status.abstractGameState", isText),
    requireField("status.detailedState", isText),
    requireField("status.codedGameState", isText),
    requireField("status.startTimeTBD", isBoolean),
    requireField("teams.away.team.id", isNumber),
    requireField("teams.away.team.name", isText),
    requireField("teams.home.team.id", isNumber),
    requireField("teams.home.team.name", isText),
    requireField("teams.away.score", isNumber, isFinal),
    requireField("teams.home.score", isNumber, isFinal),
    requireField("gameInfo.firstPitch", isTime, isFinal, true),
    requireField("gameInfo.gameDurationMinutes", isNumber, isFinal, true),
  ],
  scheduleGame: [requireField("linescore.currentInning", isNumber, hasStarted, true)],
  postseasonGame: [
    requireField("seriesGameNumber", isNumber),
    // The series' league comes from this name.
    requireField(
      "seriesDescription",
      (value) => /^(AL|NL)\b/.test(value),
      (game) => game.gameType !== "W",
    ),
  ],
};
export const CHECKED_FIELDS = [
  ...new Set(
    Object.values(FIELD_RULES).flatMap((rules) => rules.flatMap((rule) => rule.path.split("."))),
  ),
  "records",
  "dates",
];

const readPath = (object, path) =>
  path.split(".").reduce((value, key) => (value == null ? undefined : value[key]), object);

function findInvalidFields(items, rules) {
  return rules
    .filter(({ path, isValid, appliesTo, onSome }) => {
      const applicable = items.filter(appliesTo);
      const invalid = applicable.filter((item) => !isValid(readPath(item, path)));
      return invalid.length > 0 && (!onSome || invalid.length === applicable.length);
    })
    .map((rule) => rule.path);
}

function findMissingStandingsFields(standings) {
  if (!Array.isArray(standings?.records)) return ["records"];
  const clubs = standings.records.flatMap((division) => division.teamRecords || []);
  return [
    ...findInvalidFields(standings.records, FIELD_RULES.division),
    ...findInvalidFields(clubs, FIELD_RULES.club),
  ];
}

function findMissingGameFields(schedule, extraRules) {
  if (!Array.isArray(schedule?.dates)) return ["dates"];
  const games = schedule.dates.flatMap((date) => date.games || []);
  return [
    ...findInvalidFields(schedule.dates, FIELD_RULES.date),
    ...findInvalidFields(games, [...FIELD_RULES.game, ...extraRules]),
  ];
}

export function findMissingFields(responses) {
  const missing = [
    ...findMissingStandingsFields(responses.standings),
    ...findMissingGameFields(responses.postseason, FIELD_RULES.postseasonGame),
    ...(responses.schedule
      ? findMissingGameFields(responses.schedule, FIELD_RULES.scheduleGame)
      : []),
  ];
  return [...new Set(missing)];
}

export const LEAGUES = ["AL", "NL"];
export const BEST_OF = { WC: 3, DS: 5, CS: 7, WS: 7 };
export const countWinsNeeded = (round) => Math.ceil(BEST_OF[round] / 2);

// The bracket is fixed, not reseeded: 1 draws the 4/5 winner, 2 the 3/6.
const LEAGUE_SERIES = [
  { key: "WC1", round: "WC", sides: [{ seed: 3 }, { seed: 6 }] },
  { key: "WC2", round: "WC", sides: [{ seed: 4 }, { seed: 5 }] },
  { key: "DS1", round: "DS", sides: [{ seed: 1 }, { winnerOf: "WC2" }] },
  { key: "DS2", round: "DS", sides: [{ seed: 2 }, { winnerOf: "WC1" }] },
  { key: "CS", round: "CS", sides: [{ winnerOf: "DS1" }, { winnerOf: "DS2" }] },
];

/**
 * Walks the bracket in playing order. `decideWinner` names each series' winner, or null.
 * @param {Record<string, { league: string, seed: number }>} teams
 * @param {(seriesId: string, round: string, teamA: string | null, teamB: string | null) => string | null} decideWinner
 */
export function resolveBracket(teams, decideWinner) {
  const holderOfSeed = {};
  for (const [id, team] of Object.entries(teams)) holderOfSeed[`${team.league}${team.seed}`] = id;
  const bracket = {};
  const findWinner = (seriesId) => (bracket[seriesId] ? bracket[seriesId].winner : null);
  const settleSeries = (id, round, teamA, teamB) => {
    bracket[id] = { id, round, teamA, teamB, winner: decideWinner(id, round, teamA, teamB) };
  };
  for (const league of LEAGUES) {
    for (const { key, round, sides } of LEAGUE_SERIES) {
      const [teamA, teamB] = sides.map((side) =>
        side.seed
          ? holderOfSeed[`${league}${side.seed}`] || null
          : findWinner(`${league}_${side.winnerOf}`),
      );
      settleSeries(`${league}_${key}`, round, teamA, teamB);
    }
  }
  settleSeries("WS", "WS", findWinner("AL_CS"), findWinner("NL_CS"));
  return bracket;
}

// `side` is 0 for teamA and 1 for teamB.
export function findFeederSeries(seriesId, side) {
  if (seriesId === "WS") return side === 0 ? "AL_CS" : "NL_CS";
  const [league, key] = seriesId.split("_");
  const series = LEAGUE_SERIES.find((candidate) => candidate.key === key);
  const winnerOf = series && series.sides[side].winnerOf;
  return winnerOf ? `${league}_${winnerOf}` : null;
}

const GAME_TYPES = new Set(["R", "F", "D", "L", "W"]);

// MLB caches its responses for 20 seconds, so polling faster only refetches the same answer.
export const POLL_LIVE_MS = 30 * 1000;
const POLL_LEAD_MS = 15 * 60 * 1000;
export const POLL_CHECK_MS = 60 * 60 * 1000;

// Baseball's day is Eastern: a game ending after midnight belongs to the night before.
const EASTERN = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/New_York",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  hourCycle: "h23",
});
export function easternDay(ms) {
  const parts = {};
  for (const { type, value } of EASTERN.formatToParts(new Date(ms))) parts[type] = value;
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    hour: Number(parts.hour),
    year: Number(parts.year),
  };
}
function addDays(date, days) {
  const [year, month, day] = date.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

export function mlbRequests(season, now) {
  const today = easternDay(now);
  const requests = {
    standings:
      `/api/v1/standings?leagueId=103,104&season=${season}` +
      `&standingsTypes=regularSeason&fields=${STANDINGS_FIELDS}`,
    postseason: `/api/v1/schedule/postseason?season=${season}&hydrate=gameInfo&fields=${GAME_FIELDS}`,
    schedule: null,
  };
  if (season === today.year) {
    // Four days each way spans a postseason off day back and every club's next game ahead.
    requests.schedule =
      `/api/v1/schedule?sportId=1&startDate=${addDays(today.date, -4)}` +
      `&endDate=${addDays(today.date, 4)}&hydrate=linescore,gameInfo&fields=${GAME_FIELDS}`;
  }
  return requests;
}

export async function fetchSnapshot(getJson, season, now = Date.now()) {
  const requests = mlbRequests(season, now);
  const [standings, postseason, schedule] = await Promise.all([
    getJson(requests.standings),
    getJson(requests.postseason),
    requests.schedule ? getJson(requests.schedule) : null,
  ]);
  return buildSnapshot({ standings, postseason, schedule }, { season, now });
}

// Postponed and cancelled games read "Final" in abstractGameState, so check the coded state first.
function readGameState(status) {
  const isCalledOff =
    ["C", "D", "T", "U"].includes(status.codedGameState) ||
    /postpon|cancel|suspend/i.test(status.detailedState || "");
  if (isCalledOff) return "off";
  if (status.abstractGameState === "Live") return "live";
  if (status.abstractGameState === "Final") return "final";
  return "pre";
}

// Without gameInfo, three hours past the scheduled start is close enough to order finals.
function estimateEnd(game) {
  const info = game.gameInfo || {};
  const firstPitch = Date.parse(info.firstPitch || game.gameDate);
  if (Number.isNaN(firstPitch)) return null;
  const minutes = info.gameDurationMinutes || (info.firstPitch ? 0 : 180);
  return new Date(firstPitch + minutes * 60000).toISOString().replace(".000Z", "Z");
}

function normalizeGame(game) {
  const readSide = (key) => {
    const side = (game.teams && game.teams[key]) || {};
    const team = side.team || {};
    return { id: MLB_TEAM[team.id] || null, name: team.name || "", score: side.score };
  };
  const status = game.status || {};
  const state = readGameState(status);
  const league = /^(AL|NL)\b/.exec(game.seriesDescription || "");
  return {
    type: game.gameType,
    date: game.officialDate,
    start: game.gameDate,
    tbd: !!status.startTimeTBD,
    state,
    away: readSide("away"),
    home: readSide("home"),
    inning: game.linescore ? game.linescore.currentInning : undefined,
    number: game.seriesGameNumber,
    league: league ? league[1] : null,
    end: state === "final" ? estimateEnd(game) : null,
  };
}

// A suspended game is listed again on the day it resumes; the later listing counts.
function listScheduledGames(response) {
  const gamesByPk = new Map();
  for (const day of (response && response.dates) || []) {
    for (const game of day.games || []) {
      if (GAME_TYPES.has(game.gameType)) gamesByPk.set(game.gamePk, normalizeGame(game));
    }
  }
  return [...gamesByPk.values()];
}

const hasBothClubs = (game) => !!(game.away.id && game.home.id);
const compareStarts = (first, second) => Date.parse(first.start) - Date.parse(second.start);
const compareEnds = (first, second) => Date.parse(first.end) - Date.parse(second.end);

function summarizeGame(game) {
  const summary = { away: game.away.id, home: game.home.id, state: game.state, start: game.start };
  if (game.tbd) summary.tbd = true;
  if (game.state !== "pre") summary.score = [game.away.score || 0, game.home.score || 0];
  if (game.state === "live") summary.inning = game.inning || 1;
  if (game.state === "final") summary.end = game.end;
  return summary;
}

// Before 6am Eastern, today is still last night.
function buildSlate(games, now) {
  const clock = easternDay(now);
  const playable = games.filter((game) => game.state !== "off" && hasBothClubs(game));
  const listGamesOn = (date) => playable.filter((game) => game.date === date).sort(compareStarts);
  let day = clock.date;
  if (clock.hour < 6 && listGamesOn(addDays(day, -1)).length) day = addDays(day, -1);

  const nextDay = [...new Set(playable.map((game) => game.date))]
    .filter((date) => date > day)
    .sort()[0];
  const lastFinal = playable
    .filter((game) => game.state === "final" && game.date < day)
    .sort(compareEnds)
    .pop();
  return {
    today: { date: day, games: listGamesOn(day).map(summarizeGame) },
    nextDay: nextDay ? { date: nextDay, games: listGamesOn(nextDay).map(summarizeGame) } : null,
    lastFinal: lastFinal ? summarizeGame(lastFinal) : null,
  };
}

function listStandingsRows(response) {
  const rows = [];
  for (const divisionRecord of (response && response.records) || []) {
    const division = MLB_DIVISION[divisionRecord.division && divisionRecord.division.id];
    if (!division) continue;
    for (const record of divisionRecord.teamRecords || []) {
      const id = MLB_TEAM[record.team && record.team.id];
      if (id) rows.push({ id, division, record });
    }
  }
  return rows;
}

function listUpcomingGames(games) {
  const upcoming = {};
  const gamesAhead = games
    .filter((game) => game.type === "R" && game.state === "pre" && hasBothClubs(game))
    .sort(compareStarts);
  for (const game of gamesAhead) {
    for (const [club, opponent, home] of [
      [game.away.id, game.home.id, false],
      [game.home.id, game.away.id, true],
    ]) {
      (upcoming[club] = upcoming[club] || []).push({
        at: game.start,
        opp: opponent,
        home,
        tbd: game.tbd,
      });
    }
  }
  return upcoming;
}

const readRank = (value) => Number(value) || 99;

function buildStandingsRow(id, record) {
  return {
    id,
    w: record.wins,
    l: record.losses,
    pct: record.winningPercentage,
    gb: record.divisionGamesBack,
    wcgb: record.wildCardGamesBack,
    elim: record.eliminationNumber,
    wce: record.wildCardEliminationNumber,
    magic: null,
    // Not clinchIndicator: its "x" and "w" mean a playoff spot, not the division.
    clinched: !!record.divisionChamp,
    lead: !!record.divisionLeader,
    // MLB's own marker: x a playoff spot, w a wild card, y the division, z a bye.
    clinch: record.clinchIndicator || null,
    wcrank: record.divisionLeader ? null : record.wildCardRank || null,
    rank: readRank(record.divisionRank),
  };
}

// The division magic number is the closest chaser's elimination number; MLB's
// `magicNumber` counts toward a playoff spot instead.
function setMagicNumber(rows) {
  const leader = rows.find((row) => row.lead);
  if (!leader || leader.clinched) return;
  const chasers = rows
    .filter((row) => row !== leader)
    .map((row) => Number(row.elim))
    .filter(Number.isFinite);
  if (chasers.length) leader.magic = String(Math.min(...chasers));
}

// `then` lets a copy saved before `next` starts still show what follows once it is under way.
function buildStandings(response, games) {
  const upcoming = listUpcomingGames(games);
  const divisions = {};
  for (const { id, division, record } of listStandingsRows(response)) {
    const row = buildStandingsRow(id, record);
    const [next, then] = upcoming[id] || [];
    if (next) row.next = next;
    if (then) row.then = then;
    (divisions[division] = divisions[division] || []).push(row);
  }
  for (const rows of Object.values(divisions)) {
    rows.sort((first, second) => first.rank - second.rank).forEach((row) => delete row.rank);
    setMagicNumber(rows);
  }
  return { divisions };
}

// League rank breaks ties on record because it already carries MLB's tiebreakers.
function projectField(response) {
  const rows = listStandingsRows(response);
  const compareLeagueRank = (first, second) =>
    readRank(first.record.leagueRank) - readRank(second.record.leagueRank);
  const compareDivisionRank = (first, second) =>
    readRank(first.record.divisionRank) - readRank(second.record.divisionRank) ||
    compareLeagueRank(first, second);
  const comparePercentage = (first, second) =>
    Number(second.record.winningPercentage) - Number(first.record.winningPercentage) ||
    compareLeagueRank(first, second);
  const compareWildCardRank = (first, second) =>
    Number(first.record.wildCardRank) - Number(second.record.wildCardRank);

  const teams = {};
  for (const league of LEAGUES) {
    const leagueRows = rows.filter((row) => row.division.startsWith(league));
    const divisions = [...new Set(leagueRows.map((row) => row.division))];
    const leaders = divisions
      .map((division) =>
        leagueRows.filter((row) => row.division === division).sort(compareDivisionRank),
      )
      .map((divisionRows) => divisionRows[0])
      .sort(comparePercentage);
    const leaderIds = new Set(leaders.map((row) => row.id));
    const wildCards = leagueRows
      .filter((row) => !leaderIds.has(row.id) && row.record.wildCardRank)
      .sort(compareWildCardRank);
    [...leaders.slice(0, 3), ...wildCards.slice(0, 3)].forEach((row, index) => {
      teams[row.id] = { league, seed: index + 1, w: row.record.wins, l: row.record.losses };
    });
  }
  return teams;
}

// MLB lists every possible postseason game in advance under placeholders ("AL 4/5 Winner").
// A wild card host is the 3 seed if it won its division, else the 4.
function findSeriesId(game, wildCardClubs, champions) {
  if (game.type === "W") return "WS";
  const { league } = game;
  if (!league) return null;
  const names = `${game.away.name} | ${game.home.name}`;
  const cameFrom = (key) =>
    [game.away.id, game.home.id].some((id) => id && wildCardClubs[`${league}_${key}`].has(id));
  switch (game.type) {
    case "F":
      if (/#3 Seed|Wild Card #3/.test(names)) return `${league}_WC1`;
      if (/Wild Card #[12]/.test(names)) return `${league}_WC2`;
      return champions.has(game.home.id) ? `${league}_WC1` : `${league}_WC2`;
    case "D":
      if (/4\/5|#1 Seed/.test(names) || cameFrom("WC2")) return `${league}_DS1`;
      if (/3\/6|#2 Seed/.test(names) || cameFrom("WC1")) return `${league}_DS2`;
      return null;
    case "L":
      return `${league}_CS`;
    default:
      return null;
  }
}

function groupPostseason(games, champions) {
  const wildCardClubs = {
    AL_WC1: new Set(),
    AL_WC2: new Set(),
    NL_WC1: new Set(),
    NL_WC2: new Set(),
  };
  const gamesBySeries = {};
  const addGame = (seriesId, game) => {
    if (seriesId) (gamesBySeries[seriesId] = gamesBySeries[seriesId] || []).push(game);
  };
  // Division series are told apart by which wild card series their clubs came from.
  for (const game of games.filter((candidate) => candidate.type === "F")) {
    const seriesId = findSeriesId(game, wildCardClubs, champions);
    addGame(seriesId, game);
    if (!seriesId) continue;
    for (const id of [game.away.id, game.home.id]) if (id) wildCardClubs[seriesId].add(id);
  }
  for (const game of games.filter((candidate) => candidate.type !== "F")) {
    addGame(findSeriesId(game, wildCardClubs, champions), game);
  }
  return { gamesBySeries, wildCardClubs };
}

function isFieldComplete(teams) {
  const seats = Object.values(teams);
  const isSeatTaken = (league, seed) =>
    seats.some((team) => team.league === league && team.seed === seed);
  return (
    seats.length === 12 &&
    LEAGUES.every((league) => [1, 2, 3, 4, 5, 6].every((seed) => isSeatTaken(league, seed)))
  );
}

// Every wild card game is at the higher seed; the 1 and 2 seeds play no wild card game.
function readOfficialField({ gamesBySeries, wildCardClubs }, records) {
  const teams = {};
  const seatClub = (id, league, seed) => {
    if (!id) return;
    const record = records[id];
    teams[id] = record ? { league, seed, w: record.w, l: record.l } : { league, seed };
  };
  for (const league of LEAGUES) {
    const listSeriesGames = (key) => gamesBySeries[`${league}_${key}`] || [];
    for (const [key, higherSeed, lowerSeed] of [
      ["WC1", 3, 6],
      ["WC2", 4, 5],
    ]) {
      const game = listSeriesGames(key)[0];
      if (!game) continue;
      seatClub(game.home.id, league, higherSeed);
      seatClub(game.away.id, league, lowerSeed);
    }
    const playedWildCard = (id) =>
      wildCardClubs[`${league}_WC1`].has(id) || wildCardClubs[`${league}_WC2`].has(id);
    for (const [key, seed] of [
      ["DS1", 1],
      ["DS2", 2],
    ]) {
      const host = listSeriesGames(key)
        .flatMap((game) => [game.away.id, game.home.id])
        .find((id) => id && !playedWildCard(id));
      seatClub(host, league, seed);
    }
  }
  return isFieldComplete(teams) ? teams : null;
}

const isBetween = (game, teamA, teamB) =>
  [teamA, teamB].includes(game.away.id) && [teamA, teamB].includes(game.home.id);

function findNextGame(games, today) {
  return games
    .filter((game) => (game.state === "pre" || game.state === "live") && game.date >= today)
    .sort((first, second) => first.number - second.number || compareStarts(first, second))[0];
}

function tallySeries(seriesId, games, round, teamA, teamB, today) {
  const record = { winsA: 0, winsB: 0 };
  const log = [];
  const need = countWinsNeeded(round);
  let winner = null;
  const finals = teamA && teamB ? games.filter((game) => game.state === "final") : [];
  const decided = finals
    .filter((game) => hasBothClubs(game) && isBetween(game, teamA, teamB))
    .sort(compareEnds);
  for (const game of decided) {
    const won = game.away.score > game.home.score ? game.away.id : game.home.id;
    if (won === teamA) record.winsA++;
    else record.winsB++;
    const score = won === teamA ? [record.winsA, record.winsB] : [record.winsB, record.winsA];
    if (score[0] >= need) {
      winner = won;
      const over = won === teamA ? teamB : teamA;
      log.push({ at: game.end, kind: "clinch", series: seriesId, team: won, over, score });
      break;
    }
    log.push({ at: game.end, kind: "game", series: seriesId, won, game: game.number, score });
  }
  if (!winner) {
    const next = findNextGame(games, today);
    if (next) record.next = { at: next.start, date: next.date, tbd: next.tbd, game: next.number };
  }
  return { record, log, winner };
}

function buildSeries(teams, gamesBySeries, today) {
  const series = {};
  const log = [];
  resolveBracket(teams, (seriesId, round, teamA, teamB) => {
    const games = gamesBySeries[seriesId] || [];
    const tally = tallySeries(seriesId, games, round, teamA, teamB, today);
    series[seriesId] = tally.record;
    log.push(...tally.log);
    return tally.winner;
  });
  log.sort((first, second) => Date.parse(first.at) - Date.parse(second.at));
  return { series, log };
}

function readRecords(standings) {
  const records = {};
  const champions = new Set();
  for (const { id, record } of listStandingsRows(standings)) {
    records[id] = { w: record.wins, l: record.losses };
    if (record.divisionChamp || (record.divisionRank === "1" && record.divisionLeader))
      champions.add(id);
  }
  return { records, champions };
}

export function buildSnapshot(responses, { season, now = Date.now() }) {
  const games = responses.schedule ? listScheduledGames(responses.schedule) : [];
  const postseasonGames = listScheduledGames(responses.postseason);
  const { records, champions } = readRecords(responses.standings);
  const grouped = groupPostseason(postseasonGames, champions);
  const official = readOfficialField(grouped, records);
  const teams = official || projectField(responses.standings);
  const { series, log } = buildSeries(teams, grouped.gamesBySeries, easternDay(now).date);

  return {
    version: 1,
    season,
    asOf: new Date(now).toISOString(),
    projected: !official,
    teams,
    series,
    log,
    standings: buildStandings(responses.standings, games),
    slate: responses.schedule ? buildSlate(games, now) : null,
    missing: findMissingFields(responses),
  };
}

// A start time passed with no first pitch is a delay, so it keeps the fast rate. The hourly
// cap catches schedule changes made with no game on, like a rainout being rescheduled.
export function pollDelay(snapshot, now = Date.now()) {
  const slate = snapshot && snapshot.slate;
  if (!slate) return null;
  const games = [slate.today, slate.nextDay].filter(Boolean).flatMap((day) => day.games);
  if (games.some((game) => game.state === "live")) return POLL_LIVE_MS;
  const starts = games
    .filter((game) => game.state === "pre" && !game.tbd)
    .map((game) => Date.parse(game.start));
  const untilLead = Math.min(...starts) - POLL_LEAD_MS - now;
  return Math.min(Math.max(untilLead, POLL_LIVE_MS), POLL_CHECK_MS);
}
