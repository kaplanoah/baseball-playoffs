// Runs in both the browser page and the Worker, so it uses no DOM and no globals.

import { addDays, readEasternDay } from "#shared/days.js";

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
// Postseason placeholders have made-up ids, so this is null for them.
export const readClubId = (mlbTeamId) => MLB_TEAM[mlbTeamId] || null;
// The MLB id of one of the page's clubs, or null for a name that isn't one.
export const readMlbTeamId = (club) =>
  Number(Object.keys(MLB_TEAM).find((mlbTeamId) => MLB_TEAM[mlbTeamId] === club)) || null;

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
  "reason",
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
  "inningState",
  "outs",
  "doubleHeader",
  "gameNumber",
  "gameInfo",
  "firstPitch",
  "gameDurationMinutes",
  "probablePitcher",
].join(",");
const SEASON_FIELDS = ["seasons", "springStartDate", "regularSeasonEndDate"].join(",");
const PITCHER_FIELDS = [
  "people",
  "id",
  "useLastName",
  "pitchHand",
  "code",
  "stats",
  "splits",
  "stat",
  "era",
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
const isLive = (game) => readGameState(game.status || {}) === "live";
const HALF_INNINGS = { Top: "top", Middle: "middle", Bottom: "bottom", End: "end" };
const isHalfInning = (value) => Object.hasOwn(HALF_INNINGS, value);

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
  season: [requireField("springStartDate", isDay), requireField("regularSeasonEndDate", isDay)],
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
    requireField("doubleHeader", isText),
    requireField("gameNumber", isNumber),
    requireField("teams.away.score", isNumber, isFinal),
    requireField("teams.home.score", isNumber, isFinal),
    requireField("gameInfo.firstPitch", isTime, isFinal, true),
    requireField("gameInfo.gameDurationMinutes", isNumber, isFinal, true),
  ],
  scheduleGame: [
    requireField("linescore.currentInning", isNumber, hasStarted, true),
    requireField("linescore.inningState", isHalfInning, isLive, true),
    requireField("linescore.outs", isNumber, isLive, true),
  ],
  pitcher: [
    requireField("id", isNumber),
    requireField("useLastName", isText),
    requireField("pitchHand.code", isText),
  ],
  // A pitcher has no line until he pitches in the season.
  pitchingLine: [requireField("era", isText, () => true, true)],
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
  "seasons",
  "people",
  "stats",
  "splits",
  "stat",
  // MLB leaves the cause off some delays, so a missing one is never flagged.
  "reason",
  // A club names its starter a day or two ahead, so a game without one is never flagged.
  "probablePitcher",
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

// No divisions at all is how MLB answers before a season's first standings.
function findMissingStandingsFields(standings) {
  if (!Array.isArray(standings?.records)) return ["records"];
  if (standings.records.length && !hasEveryDivision(standings)) return ["records"];
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

function findMissingSeasonFields(season) {
  if (!Array.isArray(season?.seasons) || !season.seasons.length) return ["seasons"];
  return findInvalidFields(season.seasons, FIELD_RULES.season);
}

const readPitchingLine = (person) => person.stats?.[0]?.splits?.[0]?.stat;

function findMissingPitcherFields(pitchers) {
  if (!Array.isArray(pitchers?.people)) return ["people"];
  const lines = pitchers.people.map(readPitchingLine).filter(Boolean);
  return [
    ...findInvalidFields(pitchers.people, FIELD_RULES.pitcher),
    ...findInvalidFields(lines, FIELD_RULES.pitchingLine),
  ];
}

export function findMissingFields(responses) {
  const missing = [
    ...findMissingSeasonFields(responses.season),
    ...findMissingStandingsFields(responses.standings),
    ...findMissingGameFields(responses.postseason, FIELD_RULES.postseasonGame),
    ...(responses.schedule
      ? findMissingGameFields(responses.schedule, FIELD_RULES.scheduleGame)
      : []),
    ...(responses.pitchers ? findMissingPitcherFields(responses.pitchers) : []),
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

export function listMlbRequests(season, now, regularSeasonEnd = null) {
  const today = readEasternDay(now);
  // Four days back spans a postseason off day; after the regular season, its last days hold
  // every club's final game.
  const firstDay = [addDays(today.date, -4), regularSeasonEnd && addDays(regularSeasonEnd, -3)]
    .filter(Boolean)
    .sort()[0];
  const requests = {
    season: `/api/v1/seasons/${season}?sportId=1&fields=${SEASON_FIELDS}`,
    standings:
      `/api/v1/standings?leagueId=103,104&season=${season}` +
      `&standingsTypes=regularSeason&fields=${STANDINGS_FIELDS}`,
    postseason:
      `/api/v1/schedule/postseason?season=${season}` +
      `&hydrate=gameInfo,probablePitcher&fields=${GAME_FIELDS}`,
    schedule: null,
  };
  if (season === today.year) {
    // Four days ahead reaches every club's next regular season game.
    requests.schedule =
      `/api/v1/schedule?sportId=1&startDate=${firstDay}` +
      `&endDate=${addDays(today.date, 4)}&hydrate=linescore,gameInfo,probablePitcher` +
      `&fields=${GAME_FIELDS}`;
  }
  return requests;
}

// Sorted, so the same starters make the same request and MLB's cache can answer it.
export const listPitcherRequest = (season, ids) =>
  `/api/v1/people?personIds=${[...ids].sort((first, second) => first - second).join(",")}` +
  `&hydrate=stats(group=[pitching],type=[season],season=${season})&fields=${PITCHER_FIELDS}`;

// Only the starters of the games the page lists are looked up, and those come from the slate.
function listStarterIds(slate) {
  if (!slate) return [];
  const days = [slate.today, slate.nextDay, slate.lastNight].filter(Boolean);
  const games = [...days.flatMap((day) => day.games), slate.lastFinal, slate.previous, slate.next]
    .flat()
    .filter(Boolean);
  return [
    ...new Set(games.flatMap((game) => (game.starters || []).filter(Boolean).map(({ id }) => id))),
  ];
}

// The starters only add to the games, so the games still show when MLB can't name them.
async function fetchPitchers(getJson, season, ids) {
  if (!ids.length) return null;
  try {
    return await getJson(listPitcherRequest(season, ids), "pitchers");
  } catch {
    return null;
  }
}

const readUnlessFailed = (promise) => promise.catch(() => null);

// The season's dates come first because they decide how far back the schedule reaches, and the
// games come before the standings and their starters, since a game that just ended is what makes
// those worth reading again. `getJson` is handed each request's name as well as its path. The
// bracket and the games can't do without the postseason and the schedule, but they can without
// the season's dates or the standings, which the snapshot then lists as missing.
export async function fetchResponses(getJson, season, now = Date.now()) {
  const seasonDates = await readUnlessFailed(
    getJson(listMlbRequests(season, now).season, "season"),
  );
  const requests = listMlbRequests(season, now, readRegularSeasonEnd(seasonDates));
  const [postseason, schedule] = await Promise.all([
    getJson(requests.postseason, "postseason"),
    requests.schedule ? getJson(requests.schedule, "schedule") : null,
  ]);
  const responses = { season: seasonDates, standings: null, postseason, schedule };
  const { slate } = buildSnapshot(responses, { season, now });
  const [standings, pitchers] = await Promise.all([
    readUnlessFailed(getJson(requests.standings, "standings")),
    fetchPitchers(getJson, season, listStarterIds(slate)),
  ]);
  return { ...responses, standings, pitchers };
}

/**
 * How many of the schedule's games have ended.
 * @param {any} schedule MLB's schedule
 */
export const countFinals = (schedule) =>
  (schedule?.dates ?? [])
    .flatMap((day) => day.games ?? [])
    .filter((game) => readGameState(game.status ?? {}) === "final").length;

export async function fetchSnapshot(getJson, season, now = Date.now()) {
  return buildSnapshot(await fetchResponses(getJson, season, now), { season, now });
}

// Postponed and cancelled games read "Final" in abstractGameState, and warmup reads "Live", so
// check the coded state first.
function readGameState(status) {
  const isCalledOff =
    ["C", "D", "T", "U"].includes(status.codedGameState) ||
    /postpon|cancel|suspend/i.test(status.detailedState || "");
  if (isCalledOff) return "off";
  if (["S", "P"].includes(status.codedGameState)) return "pre";
  if (status.abstractGameState === "Live") return "live";
  if (status.abstractGameState === "Final") return "final";
  return "pre";
}

// MLB names a delay "Delayed Start" before the first pitch and "Delayed" after, with its cause apart.
function describeDelay(status) {
  if (!/^Delayed\b/.test(status.detailedState || "")) return null;
  return status.reason ? `Delayed: ${status.reason}` : "Delayed";
}

// Without gameInfo, three hours past the scheduled start is close enough to order finals.
function estimateEnd(game) {
  const info = game.gameInfo || {};
  const firstPitch = Date.parse(info.firstPitch || game.gameDate);
  if (Number.isNaN(firstPitch)) return null;
  const minutes = info.gameDurationMinutes || (info.firstPitch ? 0 : 180);
  return new Date(firstPitch + minutes * 60000).toISOString().replace(".000Z", "Z");
}

// Between halves MLB says "Middle" or "End", with the third out still counted.
function readHalfInning(linescore) {
  const state = linescore && linescore.inningState;
  return isHalfInning(state) ? HALF_INNINGS[state] : null;
}

const isBatting = (game) => game.half === "top" || game.half === "bottom";

function normalizeGame(game) {
  const readSide = (key) => {
    const side = (game.teams && game.teams[key]) || {};
    const team = side.team || {};
    return {
      id: readClubId(team.id),
      name: team.name || "",
      score: side.score,
      starter: side.probablePitcher?.id ?? null,
    };
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
    half: readHalfInning(game.linescore),
    outs: game.linescore ? game.linescore.outs : undefined,
    detail: status.detailedState,
    delay: describeDelay(status),
    doubleheader: game.doubleHeader && game.doubleHeader !== "N" ? game.gameNumber : null,
    number: game.seriesGameNumber,
    league: league ? league[1] : null,
    end: state === "final" ? estimateEnd(game) : null,
  };
}

// A suspended game is listed again on the day it resumes; the later listing counts.
function listScheduledGames(...responses) {
  const gamesByPk = new Map();
  for (const response of responses) {
    for (const day of (response && response.dates) || []) {
      for (const game of day.games || []) {
        if (GAME_TYPES.has(game.gameType)) gamesByPk.set(game.gamePk, normalizeGame(game));
      }
    }
  }
  return [...gamesByPk.values()];
}

const hasBothClubs = (game) => !!(game.away.id && game.home.id);
const hasClub = (game) => !!(game.away.id || game.home.id);
const isPlayedBy = (game, club) => game.away.id === club || game.home.id === club;
const compareStarts = (first, second) => Date.parse(first.start) - Date.parse(second.start);
const compareEnds = (first, second) => Date.parse(first.end) - Date.parse(second.end);
// MLB can list a doubleheader's second game with the earlier start time.
const compareScheduleOrder = (first, second) =>
  first.date.localeCompare(second.date) ||
  (first.doubleheader || 0) - (second.doubleheader || 0) ||
  compareStarts(first, second);

// A pitcher MLB couldn't describe keeps his id, so the page can still ask about him.
function describeStarter(id, pitchers) {
  if (!id) return null;
  const person = pitchers.get(id);
  if (!person) return { id };
  const line = readPitchingLine(person);
  return { id, name: person.useLastName, hand: person.pitchHand?.code, era: line?.era || null };
}

// MLB names a game's probable starters ahead of it, and once it starts, the ones who did.
function listStarters(game, pitchers) {
  if (game.state === "off") return null;
  const starters = [game.away.starter, game.home.starter].map((id) =>
    describeStarter(id, pitchers),
  );
  return starters.some(Boolean) ? starters : null;
}

function summarizeGame(game, pitchers) {
  const summary = { away: game.away.id, home: game.home.id, state: game.state, start: game.start };
  if (game.tbd) summary.tbd = true;
  if (game.doubleheader) summary.doubleheader = game.doubleheader;
  if (game.type !== "R") summary.postseason = true;
  if (game.state === "live" || game.state === "final")
    summary.score = [game.away.score || 0, game.home.score || 0];
  if (game.state === "live") summary.inning = game.inning || 1;
  if (game.state === "live" && game.half) summary.half = game.half;
  if (game.state === "live" && isBatting(game) && isNumber(game.outs)) summary.outs = game.outs;
  if (game.state === "final") summary.end = game.end;
  if (game.state === "off") summary.detail = game.detail;
  if (game.delay) summary.delay = game.delay;
  const starters = listStarters(game, pitchers);
  if (starters) summary.starters = starters;
  return summary;
}

// Every game on the dates of each club's last game before `day` and first after it, so a date
// that shows at all shows all its games.
// Postseason games list a club before its opponent is known, so one known club is enough.
function listClubGames(games, day, summarize) {
  const counted = games.filter((game) => game.state !== "off" && hasClub(game));
  const played = counted
    .filter((game) => game.state === "final" && game.date < day)
    .sort(compareScheduleOrder);
  const ahead = counted
    .filter((game) => game.state === "pre" && game.date > day)
    .sort(compareScheduleOrder);
  const previousDates = new Set();
  const nextDates = new Set();
  for (const club of Object.values(MLB_TEAM)) {
    const last = played.filter((game) => isPlayedBy(game, club)).pop();
    const first = ahead.find((game) => isPlayedBy(game, club));
    if (last) previousDates.add(last.date);
    if (first) nextDates.add(first.date);
  }
  const listGamesOn = (clubGames, dates) =>
    clubGames
      .filter((game) => dates.has(game.date))
      .map((game) => ({ date: game.date, ...summarize(game) }));
  return { previous: listGamesOn(played, previousDates), next: listGamesOn(ahead, nextDates) };
}

const NIGHT_END_HOUR = 6;

// Before 6am Eastern, today is still last night while any of last night's games is unfinished.
// Once they're all final, last night stays alongside until 6am, since its games still explain
// what changes then.
function buildSlate(games, clubGames, now, pitchers) {
  const summarize = (game) => summarizeGame(game, pitchers);
  const clock = readEasternDay(now);
  const playable = games.filter((game) => game.state !== "off" && hasBothClubs(game));
  const listGamesOn = (date) => playable.filter((game) => game.date === date).sort(compareStarts);
  const lastNight = addDays(clock.date, -1);
  const isNight = clock.hour < NIGHT_END_HOUR;
  const isLastNightUnfinished = listGamesOn(lastNight).some((game) => game.state !== "final");
  const day = isNight && isLastNightUnfinished ? lastNight : clock.date;
  const hasLastNightEnded = isNight && day !== lastNight;

  const nextDay = [...new Set(playable.map((game) => game.date))]
    .filter((date) => date > day)
    .sort()[0];
  const lastFinal = playable
    .filter((game) => game.state === "final" && game.date < day)
    .sort(compareEnds)
    .pop();
  const postponed = games
    .filter((game) => game.state === "off" && game.date === day && hasBothClubs(game))
    .sort(compareStarts);
  return {
    today: {
      date: day,
      games: listGamesOn(day).map(summarize),
      postponed: postponed.map(summarize),
    },
    nextDay: nextDay ? { date: nextDay, games: listGamesOn(nextDay).map(summarize) } : null,
    lastNight: hasLastNightEnded
      ? { date: lastNight, games: listGamesOn(lastNight).map(summarize) }
      : null,
    lastFinal: lastFinal ? summarize(lastFinal) : null,
    ...listClubGames(clubGames, day, summarize),
  };
}

function listStandingsRows(response) {
  const rows = [];
  for (const divisionRecord of (response && response.records) || []) {
    const division = MLB_DIVISION[divisionRecord.division && divisionRecord.division.id];
    if (!division) continue;
    for (const record of divisionRecord.teamRecords || []) {
      const id = readClubId(record.team?.id);
      if (id) rows.push({ id, division, record });
    }
  }
  return rows;
}

// A postseason game can list a club before its opponent is known, so one known club is enough.
function describeUpcomingGame(game, opponent, home) {
  const upcoming = { at: game.start, date: game.date, home, tbd: game.tbd };
  if (opponent) upcoming.opp = opponent;
  if (game.type !== "R") upcoming.postseason = true;
  return upcoming;
}

function listUpcomingGames(games) {
  const upcoming = {};
  const gamesAhead = games
    .filter((game) => game.state === "pre" && hasClub(game))
    .sort(compareStarts);
  for (const game of gamesAhead) {
    for (const [club, opponent, home] of [
      [game.away.id, game.home.id, false],
      [game.home.id, game.away.id, true],
    ]) {
      if (club)
        (upcoming[club] = upcoming[club] || []).push(describeUpcomingGame(game, opponent, home));
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
    lead: !!record.divisionLeader,
    // MLB's own marker: x a playoff spot, w a wild card, y the division, z a bye.
    clinch: record.clinchIndicator || null,
    wcrank: record.divisionLeader ? null : record.wildCardRank || null,
    rank: readRank(record.divisionRank),
  };
}

export const SEASON_GAMES = 162;

const hasPlayedOut = (row) => row.w + row.l >= SEASON_GAMES;

// MLB's divisionChamp and its "y" marker have both named a wild card club, so a division is
// won only once every other club in it is out of the division race. A tie at the end is
// broken on paper, and MLB then names only the winner the leader but never eliminates the
// other club.
const isOutOfDivisionRace = (other, leader) =>
  other.elim === "E" || (!other.lead && hasPlayedOut(other) && hasPlayedOut(leader));

export const hasWonDivision = (row, divisionRows) =>
  row.lead && divisionRows.every((other) => other.id === row.id || isOutOfDivisionRace(other, row));

// MLB gives a club tied for the lead "-" instead of an elimination number, so a tie is
// counted the way MLB counts the rest: a tie at the end doesn't clinch.
function countEliminationNumber(leader, chaser) {
  const given = Number(chaser.elim);
  if (Number.isFinite(given)) return given;
  if (chaser.elim !== "-") return null;
  return SEASON_GAMES + 1 - leader.w - chaser.l;
}

// The division magic number is the closest chaser's elimination number; MLB's
// `magicNumber` counts toward a playoff spot instead.
function setMagicNumber(rows) {
  const leader = rows.find((row) => row.lead);
  if (!leader || leader.clinched) return;
  const chasers = rows
    .filter((row) => row !== leader)
    .map((row) => countEliminationNumber(leader, row))
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
    for (const row of rows) row.clinched = hasWonDivision(row, rows);
    setMagicNumber(rows);
  }
  return { divisions };
}

// MLB sometimes answers with no divisions, or only some, and a field projected from that
// would drop clubs that are still in it.
function hasEveryDivision(response) {
  const divisions = new Set(listStandingsRows(response).map((row) => row.division));
  return Object.values(MLB_DIVISION).every((division) => divisions.has(division));
}

// A field is known only with the standings: a projected one comes from them, and a set one takes
// its clubs' records, and which series each game belongs to, from them.
export const hasKnownField = (snapshot) => !!snapshot.standings;

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

// MLB lists every possible postseason game in advance under placeholders ("AL 4/5 Winner",
// then "NYY/BOS" once the wild card clubs are set). A wild card host is the 3 seed if it won its
// division, else the 4. The 1 seed, the club with the league's best record, plays every game of DS1.
function findSeriesId(game, { champions, bestRecords }) {
  if (game.type === "W") return "WS";
  const { league } = game;
  if (!league) return null;
  const names = `${game.away.name} | ${game.home.name}`;
  const bestRecord = bestRecords[league];
  switch (game.type) {
    case "F":
      if (/#3 Seed|Wild Card #3/.test(names)) return `${league}_WC1`;
      if (/Wild Card #[12]/.test(names)) return `${league}_WC2`;
      return champions.has(game.home.id) ? `${league}_WC1` : `${league}_WC2`;
    case "D":
      if (/4\/5|#1 Seed/.test(names) || (bestRecord && isPlayedBy(game, bestRecord)))
        return `${league}_DS1`;
      if (/3\/6|#2 Seed/.test(names) || (bestRecord && hasClub(game))) return `${league}_DS2`;
      return null;
    case "L":
      return `${league}_CS`;
    default:
      return null;
  }
}

function groupPostseason(games, clinches) {
  const gamesBySeries = {};
  for (const game of games) {
    const seriesId = findSeriesId(game, clinches);
    if (seriesId) (gamesBySeries[seriesId] = gamesBySeries[seriesId] || []).push(game);
  }
  return gamesBySeries;
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
function readOfficialField(gamesBySeries, records) {
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
    const wildCardGames = [...listSeriesGames("WC1"), ...listSeriesGames("WC2")];
    const playedWildCard = (id) => wildCardGames.some((game) => isPlayedBy(game, id));
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

const isUnderWay = (game) => game.state === "live" || game.state === "final";

const isBetween = (game, teamA, teamB) =>
  [teamA, teamB].includes(game.away.id) && [teamA, teamB].includes(game.home.id);

// A game still live past midnight Eastern is dated the day before.
function findNextGame(games, today) {
  return games
    .filter((game) => game.state === "live" || (game.state === "pre" && game.date >= today))
    .sort((first, second) => first.number - second.number || compareStarts(first, second))[0];
}

function tallySeries(seriesId, games, round, teamA, teamB, today) {
  const record = { winsA: 0, winsB: 0 };
  const log = [];
  const need = countWinsNeeded(round);
  let winner = null;
  const seriesGames =
    teamA && teamB
      ? games.filter((game) => hasBothClubs(game) && isBetween(game, teamA, teamB))
      : [];
  if (seriesGames.some(isUnderWay)) record.started = true;
  const decided = seriesGames.filter((game) => game.state === "final").sort(compareEnds);
  for (const game of decided) {
    const won = game.away.score > game.home.score ? game.away.id : game.home.id;
    const lost = won === teamA ? teamB : teamA;
    // The game's own score, winner first, beside the series score.
    const runs = [
      Math.max(game.away.score, game.home.score),
      Math.min(game.away.score, game.home.score),
    ];
    if (won === teamA) record.winsA++;
    else record.winsB++;
    const score = won === teamA ? [record.winsA, record.winsB] : [record.winsB, record.winsA];
    if (score[0] >= need) {
      winner = won;
      log.push({
        at: game.end,
        kind: "clinch",
        series: seriesId,
        team: won,
        over: lost,
        score,
        runs,
      });
      break;
    }
    log.push({
      at: game.end,
      kind: "game",
      series: seriesId,
      won,
      lost,
      game: game.number,
      score,
      runs,
    });
  }
  if (!winner) {
    const next = findNextGame(games, today);
    if (next) record.next = { at: next.start, date: next.date, tbd: next.tbd, game: next.number };
  }
  return { record, log, winner };
}

// A decided series can still list the games it didn't need.
function listNeededPostseasonGames(gamesBySeries, log) {
  const decided = new Set(
    log.filter((entry) => entry.kind === "clinch").map((entry) => entry.series),
  );
  return Object.entries(gamesBySeries).flatMap(([seriesId, games]) =>
    decided.has(seriesId) ? games.filter((game) => game.state === "final") : games,
  );
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

const readSpringStart = (seasonDates) => seasonDates?.seasons?.[0]?.springStartDate || null;
const readRegularSeasonEnd = (seasonDates) =>
  seasonDates?.seasons?.[0]?.regularSeasonEndDate || null;

const readLeague = (division) => LEAGUES.find((league) => division.startsWith(league));

// MLB marks the club that clinched its league's best record "z".
function readRecords(standings) {
  const records = {};
  const champions = new Set();
  const bestRecords = {};
  for (const { id, division, record } of listStandingsRows(standings)) {
    records[id] = { w: record.wins, l: record.losses };
    if (record.divisionRank === "1" && record.divisionLeader) champions.add(id);
    if (record.clinchIndicator === "z") bestRecords[readLeague(division)] = id;
  }
  return { records, clinches: { champions, bestRecords } };
}

const listPitchers = (responses) =>
  new Map((responses.pitchers?.people || []).map((person) => [person.id, person]));

export function buildSnapshot(responses, { season, now = Date.now() }) {
  const games = responses.schedule ? listScheduledGames(responses.schedule) : [];
  const postseasonGames = listScheduledGames(responses.postseason);
  const { records, clinches } = readRecords(responses.standings);
  const gamesBySeries = groupPostseason(postseasonGames, clinches);
  const official = readOfficialField(gamesBySeries, records);
  const hasStandings = hasEveryDivision(responses.standings);
  const teams = official || (hasStandings ? projectField(responses.standings) : {});
  const { series, log } = buildSeries(teams, gamesBySeries, readEasternDay(now).date);
  const clubGames = [
    ...games.filter((game) => game.type === "R"),
    ...listNeededPostseasonGames(gamesBySeries, log),
  ];

  return {
    version: 1,
    season,
    asOf: new Date(now).toISOString(),
    projected: !official,
    springStart: readSpringStart(responses.season),
    teams,
    series,
    log,
    standings: hasStandings ? buildStandings(responses.standings, clubGames) : null,
    slate: responses.schedule ? buildSlate(games, clubGames, now, listPitchers(responses)) : null,
    missing: findMissingFields(responses),
  };
}

// A start time passed with no first pitch is a delay, so it keeps the fast rate. The hourly
// cap catches schedule changes made with no game on, like a rainout being rescheduled.
export function choosePollDelay(snapshot, now = Date.now()) {
  const slate = snapshot && snapshot.slate;
  if (!slate) return null;
  const games = [slate.today, slate.nextDay].filter(Boolean).flatMap((day) => day.games);
  if (games.some((game) => game.state === "live")) return POLL_LIVE_MS;
  const starts = games
    .filter((game) => game.state === "pre" && !game.tbd)
    .map((game) => Date.parse(game.start))
    .filter(Number.isFinite);
  const untilLead = Math.min(...starts) - POLL_LEAD_MS - now;
  return Math.min(Math.max(untilLead, POLL_LIVE_MS), POLL_CHECK_MS);
}
