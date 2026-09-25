// The requests filter with `fields=`, so a field MLB renames or drops comes back as nothing at all.
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const MLBSnapshot = require("../js/snapshot.js");

const KNOWN_TEAMS = new Set(Object.values(MLBSnapshot.MLB_TEAM));
const POSTSEASON_GAME_TYPES = ["F", "D", "L", "W"];
const TIMEOUT_MS = 15000;

const readPath = (object, path) =>
  path.split(".").reduce((value, key) => (value == null ? undefined : value[key]), object);
const isList = Array.isArray;
const isNumber = (value) => typeof value === "number" && Number.isFinite(value);
const isText = (value) => typeof value === "string" && value !== "";
const isBoolean = (value) => typeof value === "boolean";
const isNumericText = (value) => isText(value) && Number.isFinite(Number(value));
const isDay = (value) => typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
const isTime = (value) => isText(value) && !Number.isNaN(Date.parse(value));
const isPresent = (value) => value !== undefined && value !== null && value !== "";
const formatGameCount = (count) => `${count} game${count === 1 ? "" : "s"}`;

// Matches gameState in js/snapshot.js: a postponed game also reads "Final", with no score.
function readGameState(status = {}) {
  const isOff =
    /^[CDTU]$/.test(status.codedGameState) ||
    /postpon|cancel|suspend/i.test(status.detailedState || "");
  if (isOff) return "off";
  return { Live: "live", Final: "final" }[status.abstractGameState] || "pre";
}

// With `onSome`, a field only fails when it's missing from every item it applies to.
const requireField = (path, isValid, appliesTo = () => true, onSome = false) => ({
  path,
  isValid,
  appliesTo,
  onSome,
});

const hasPlayed = (record) => record.wins + record.losses > 0;
const isFinal = (game) => readGameState(game.status) === "final";
const hasStarted = (game) => ["live", "final"].includes(readGameState(game.status));

export const RULES = {
  standings: [requireField("records", isList)],
  division: [requireField("division.id", isNumber), requireField("teamRecords", isList)],
  club: [
    requireField("team.id", (value) => value in MLBSnapshot.MLB_TEAM),
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
  schedule: [requireField("dates", isList)],
  date: [requireField("date", isDay), requireField("games", isList)],
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
  windowGame: [requireField("linescore.currentInning", isNumber, hasStarted, true)],
  postseasonGame: [
    requireField("gameType", (value) => POSTSEASON_GAME_TYPES.includes(value)),
    requireField("seriesGameNumber", isNumber),
    // The series' league comes from this name.
    requireField(
      "seriesDescription",
      (value) => /^(AL|NL)\b/.test(value),
      (game) => game.gameType !== "W",
    ),
  ],
};

export const CHECKED_FIELDS = new Set(
  Object.values(RULES).flatMap((rules) => rules.flatMap((rule) => rule.path.split("."))),
);

function findFieldProblems(items, rules, noun, describeItem = () => null) {
  const problems = [];
  for (const { path, isValid, appliesTo, onSome } of rules) {
    const applicable = items.filter(appliesTo);
    const invalid = applicable.filter((item) => !isValid(readPath(item, path)));
    if (!invalid.length || (onSome && invalid.length < applicable.length)) continue;
    const example = describeItem(invalid[0]);
    problems.push(
      `${path} missing or unexpected on ${invalid.length} of ${applicable.length} ${noun}` +
        (example == null ? "" : ` (e.g. ${example})`),
    );
  }
  return problems;
}

const passCheck = (name, detail) => ({ name, status: "ok", detail });
const failCheck = (name, detail) => ({ name, status: "fail", detail });
const skipCheck = (name, detail) => ({ name, status: "skip", detail });
const judgeCheck = (name, problems, detail) =>
  problems.length ? failCheck(name, problems.join("; ")) : passCheck(name, detail);

export function checkStandings(response, season) {
  const name = "standings fields";
  const shapeProblems = findFieldProblems([response || {}], RULES.standings, "responses");
  if (shapeProblems.length) return failCheck(name, shapeProblems.join("; "));
  if (!response.records.length) return skipCheck(name, `no ${season} standings yet (preseason)`);
  const clubs = response.records.flatMap((division) =>
    isList(division.teamRecords) ? division.teamRecords : [],
  );
  const problems = [
    ...findFieldProblems(response.records, RULES.division, "divisions"),
    ...findFieldProblems(
      clubs,
      RULES.club,
      "clubs",
      (record) => `team ${readPath(record, "team.id")}`,
    ),
  ];
  const divisionCount = new Set(
    response.records.map((division) => readPath(division, "division.id")),
  ).size;
  const clubCount = new Set(clubs.map((record) => readPath(record, "team.id"))).size;
  if (divisionCount !== 6 || clubCount !== 30 || clubs.length !== 30)
    problems.push(`expected 30 clubs in 6 divisions, got ${clubs.length} in ${divisionCount}`);
  const detail = `30 clubs in 6 divisions${clubs.some(hasPlayed) ? "" : ", no games played yet"}`;
  return judgeCheck(name, problems, detail);
}

function countGameStates(games) {
  const counts = {};
  for (const game of games) {
    const state = readGameState(game.status);
    counts[state] = (counts[state] || 0) + 1;
  }
  return ["final", "live", "pre", "off"]
    .filter((state) => counts[state])
    .map((state) => `${counts[state]} ${state}`)
    .join(", ");
}

export function checkGames(key, response) {
  const name = `${key} fields`;
  const shapeProblems = findFieldProblems([response || {}], RULES.schedule, "responses");
  if (shapeProblems.length) return failCheck(name, shapeProblems.join("; "));
  const games = response.dates.flatMap((date) => (isList(date.games) ? date.games : []));
  const extraRules = key === "postseason" ? RULES.postseasonGame : RULES.windowGame;
  const problems = [
    ...findFieldProblems(response.dates, RULES.date, "dates", (date) => date.date),
    ...findFieldProblems(
      games,
      [...RULES.game, ...extraRules],
      "games",
      (game) => `gamePk ${game.gamePk}`,
    ),
  ];
  if (!games.length) {
    const emptyDetail = key === "postseason" ? "none scheduled yet" : "no games in the window";
    return judgeCheck(name, problems, emptyDetail);
  }
  return judgeCheck(name, problems, `${formatGameCount(games.length)} (${countGameStates(games)})`);
}

function findSeedProblems(teams) {
  const problems = [];
  const clubCount = Object.keys(teams).length;
  if (clubCount !== 12) problems.push(`${clubCount} clubs, expected 12`);
  for (const league of ["AL", "NL"]) {
    const seeds = Object.values(teams)
      .filter((team) => team.league === league)
      .map((team) => team.seed)
      .sort((a, b) => a - b);
    if (seeds.join() !== "1,2,3,4,5,6")
      problems.push(`${league} seeds ${seeds.join(",") || "none"}`);
  }
  return problems;
}

function collectTeamIds(snapshot) {
  const ids = Object.keys(snapshot.teams || {});
  for (const rows of Object.values(snapshot.standings?.divisions || {})) {
    for (const row of rows) {
      const opponents = [row.next, row.then].filter(Boolean).map((game) => game.opp);
      ids.push(row.id, ...opponents);
    }
  }
  const slate = snapshot.slate || {};
  const games = [slate.today, slate.nextDay]
    .filter(Boolean)
    .flatMap((day) => day.games)
    .concat(slate.lastFinal || []);
  for (const game of games) ids.push(game.away, game.home);
  for (const entry of snapshot.log || [])
    ids.push(...[entry.team, entry.over, entry.won].filter(Boolean));
  return ids;
}

function findStandingsProblems(snapshot) {
  const divisions = Object.values(snapshot.standings.divisions);
  const clubs = new Set(divisions.flat().map((row) => row.id));
  const isComplete =
    divisions.length === 6 && divisions.every((rows) => rows.length === 5) && clubs.size === 30;
  return isComplete
    ? []
    : [`expected 30 clubs in 6 divisions of 5, got ${clubs.size} in ${divisions.length}`];
}

function findUnknownIds(snapshot) {
  const unknown = [...new Set(collectTeamIds(snapshot).filter((id) => !KNOWN_TEAMS.has(id)))];
  return unknown.length ? [`unknown team ids: ${unknown.join(", ")}`] : [];
}

function checkField(snapshot, responses, clubs) {
  const name = "snapshot field";
  const postseasonGames = (responses.postseason?.dates || []).flatMap((date) => date.games || []);
  if (!snapshot.projected)
    return judgeCheck(name, findSeedProblems(snapshot.teams), "official, 12 clubs seeded");
  if (postseasonGames.some(hasStarted))
    return failCheck(name, "the postseason has started but the field is still projected");
  if (!clubs.length) return skipCheck(name, "no standings yet");
  if (clubs.length === 30 && clubs.every(hasPlayed))
    return judgeCheck(name, findSeedProblems(snapshot.teams), "projected, 12 clubs seeded");
  return skipCheck(name, "not every club has played yet");
}

function checkSlate(snapshot) {
  const today = snapshot.slate?.today;
  return today && isDay(today.date) && isList(today.games)
    ? passCheck("snapshot slate", `${formatGameCount(today.games.length)} on ${today.date}`)
    : failCheck("snapshot slate", "missing for the current season");
}

const formatDuration = (ms) =>
  ms >= 60000 ? `${Math.round(ms / 60000)} min` : `${Math.round(ms / 1000)} s`;

function checkPollDelay(snapshot, now) {
  const delay = MLBSnapshot.pollDelay(snapshot, now);
  if (delay === null) return passCheck("pollDelay", "never (season over)");
  return isNumber(delay) && delay >= 0
    ? passCheck("pollDelay", formatDuration(delay))
    : failCheck("pollDelay", `returned ${delay}`);
}

export function checkSnapshot(responses, { season, now }) {
  let snapshot;
  try {
    snapshot = MLBSnapshot.buildSnapshot(responses, { season, now });
  } catch (error) {
    return [failCheck("snapshot builds", error?.stack || String(error))];
  }
  const clubs = (responses.standings?.records || []).flatMap(
    (division) => division.teamRecords || [],
  );
  const results = [passCheck("snapshot builds", `${JSON.stringify(snapshot).length} bytes`)];
  results.push(
    clubs.length
      ? judgeCheck("snapshot standings", findStandingsProblems(snapshot), "30 clubs in 6 divisions")
      : skipCheck("snapshot standings", "no standings yet"),
  );
  results.push(checkField(snapshot, responses, clubs));
  const teamCount = new Set(collectTeamIds(snapshot)).size;
  results.push(
    judgeCheck("snapshot team ids", findUnknownIds(snapshot), `${teamCount} clubs, all known`),
  );
  if (responses.schedule) results.push(checkSlate(snapshot));
  results.push(checkPollDelay(snapshot, now));
  return results;
}

async function fetchJson(fetchImpl, url, init = {}, { retries = 1, retryMs = 2000 } = {}) {
  for (let attempt = 0; ; attempt++) {
    try {
      const response = await fetchImpl(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });
      if (!response.ok) {
        const error = new Error(`HTTP ${response.status}`);
        error.retry = response.status >= 500 || response.status === 429;
        throw error;
      }
      return await response.json();
    } catch (error) {
      if (attempt >= retries || error.retry === false) throw error;
      await new Promise((resolve) => setTimeout(resolve, retryMs));
    }
  }
}

function createRpcClient(url, fetchImpl, options) {
  let requestId = 0;
  return async (method, params) => {
    const body = await fetchJson(
      fetchImpl,
      url,
      {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: ++requestId, method, params }),
      },
      options,
    );
    if (body.error) throw new Error(`JSON-RPC error ${body.error.code}: ${body.error.message}`);
    return body.result;
  };
}

async function checkInitialize(callRpc) {
  try {
    const result = await callRpc("initialize", {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "check-mlb", version: "1.0.0" },
    });
    const info = result.serverInfo || {};
    return info.name
      ? passCheck("connector initialize", `${info.name} ${info.version || ""}`.trim())
      : failCheck("connector initialize", "no serverInfo in the reply");
  } catch (error) {
    return failCheck("connector initialize", error.message);
  }
}

async function checkGetSnapshot(callRpc, season) {
  const name = "connector get_snapshot";
  try {
    const result = await callRpc("tools/call", { name: "get_snapshot", arguments: { season } });
    const text = readPath(result, "content.0.text");
    if (result.isError) return failCheck(name, text || "isError");
    const snapshot = result.structuredContent || JSON.parse(text);
    const problems = [];
    if (snapshot.season !== season) problems.push(`season ${snapshot.season}, expected ${season}`);
    if (snapshot.version !== 1) problems.push(`version ${snapshot.version}`);
    if (Object.keys(snapshot.standings?.divisions || {}).length)
      problems.push(...findStandingsProblems(snapshot));
    problems.push(...findUnknownIds(snapshot));
    return judgeCheck(name, problems, `${season} snapshot as of ${snapshot.asOf}`);
  } catch (error) {
    return failCheck(name, error.message);
  }
}

export async function checkConnector(url, season, fetchImpl, options) {
  const callRpc = createRpcClient(url, fetchImpl, options);
  return [await checkInitialize(callRpc), await checkGetSnapshot(callRpc, season)];
}

const formatResult = (result) =>
  `${{ ok: "ok  ", fail: "FAIL", skip: "skip" }[result.status]}  ${result.name}: ${result.detail}`;

async function fetchResponses(requests, fetchImpl, retryMs, report) {
  const keys = Object.keys(requests).filter((key) => requests[key]);
  const headers = { accept: "application/json", "user-agent": "baseball-playoffs-check" };
  const outcomes = await Promise.allSettled(
    keys.map((key) =>
      fetchJson(fetchImpl, MLBSnapshot.MLB_API + requests[key], { headers }, { retryMs }),
    ),
  );
  const responses = { schedule: null };
  keys.forEach((key, index) => {
    const outcome = outcomes[index];
    if (outcome.status === "fulfilled") {
      responses[key] = outcome.value;
      report(passCheck(`request ${key}`, `${JSON.stringify(outcome.value).length} bytes`));
    } else {
      const path = requests[key].split("?")[0];
      report(failCheck(`request ${key}`, `${outcome.reason.message} for ${path}`));
    }
  });
  const isComplete = outcomes.every((outcome) => outcome.status === "fulfilled");
  return isComplete ? responses : null;
}

export async function checkMlb({
  fetchImpl = fetch,
  now = Date.now(),
  connectorUrl = "",
  print = console.log,
  retryMs,
} = {}) {
  const season = MLBSnapshot.easternDay(now).year;
  const results = [];
  const report = (...newResults) =>
    newResults.forEach((result) => {
      results.push(result);
      print(formatResult(result));
    });
  print(`MLB check, ${season} season, ${new Date(now).toISOString()}`);

  const requests = MLBSnapshot.mlbRequests(season, now);
  const responses = await fetchResponses(requests, fetchImpl, retryMs, report);
  if (responses) {
    report(checkStandings(responses.standings, season));
    report(checkGames("postseason", responses.postseason));
    if (responses.schedule) report(checkGames("schedule", responses.schedule));
    report(...checkSnapshot(responses, { season, now }));
  }

  if (connectorUrl) {
    report(...(await checkConnector(connectorUrl, season, fetchImpl, { retryMs })));
  } else {
    report(skipCheck("connector", "CONNECTOR_URL not set"));
  }

  const failed = results.filter((result) => result.status === "fail");
  print(
    failed.length
      ? `MLB check failed: ${failed.map((result) => result.name).join(", ")}`
      : "MLB check passed.",
  );
  return failed.length === 0;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const passed = await checkMlb({ connectorUrl: process.env.CONNECTOR_URL });
  process.exitCode = passed ? 0 : 1;
}
