import { readClubId } from "../../page/js/snapshot.js";
import { fetchMlbJson, readSeasonParam, SEASON_RULE } from "./mlb.js";
import { describeError, respondJson } from "../../../../shared/worker/responses.js";

// Reads MLB for one pitcher's side of the matchup sheet: who he is, his season, what he throws,
// his last starts, and where he ranks among the season's starters.

// A pitcher's numbers change at most once a game, and the league's once a day of games.
const PITCHER_CACHE_SECONDS = 10 * 60;
const LEAGUE_CACHE_SECONDS = 6 * 60 * 60;
const LEAGUE_REUSE_MS = LEAGUE_CACHE_SECONDS * 1000;
const FASTBALLS = ["FF", "SI"];
const RECENT_STARTS = 3;
// MLB takes about 20 seconds to describe every starter's pitches at once, and one or two for a
// few dozen, so the speeds come in parallel batches.
const SPEED_BATCH_SIZE = 30;
const LARGEST_PERSON_ID = 9_999_999;

const PERSON_FIELDS = [
  "people",
  "id",
  "useName",
  "useLastName",
  "currentAge",
  "pitchHand",
  "code",
  "stats",
  "type",
  "displayName",
  "splits",
  "stat",
  "gamesStarted",
  "era",
  "strikeoutsPer9Inn",
  "walksPer9Inn",
  "percentage",
  "averageSpeed",
  "description",
].join(",");
const STARTS_FIELDS = [
  "stats",
  "splits",
  "date",
  "stat",
  "gamesStarted",
  "inningsPitched",
  "runs",
  "strikeOuts",
  "opponent",
  "id",
  "isHome",
].join(",");
const LEAGUE_FIELDS = [
  "stats",
  "splits",
  "player",
  "id",
  "stat",
  "gamesStarted",
  "era",
  "strikeoutsPer9Inn",
  "walksPer9Inn",
].join(",");
const SPEED_FIELDS = [
  "people",
  "id",
  "stats",
  "type",
  "displayName",
  "splits",
  "stat",
  "percentage",
  "averageSpeed",
  "code",
].join(",");

// The season line and pitch mix are the regular season's, like the league's they're ranked
// against; the recent starts include the postseason's.
export const listPitcherRequests = (id, season) => ({
  person:
    `/api/v1/people/${id}?hydrate=stats(group=[pitching],type=[season,pitchArsenal],season=${season})` +
    `&fields=${PERSON_FIELDS}`,
  starts:
    `/api/v1/people/${id}/stats?stats=gameLog&group=pitching&season=${season}` +
    `&gameType=R,F,D,L,W&fields=${STARTS_FIELDS}`,
});

export const listLeagueRequest = (season) =>
  `/api/v1/stats?stats=season&group=pitching&season=${season}&sportId=1&playerPool=all` +
  `&limit=3000&fields=${LEAGUE_FIELDS}`;

const listSpeedRequest = (season, ids) =>
  `/api/v1/people?personIds=${ids.join(",")}` +
  `&hydrate=stats(group=[pitching],type=[pitchArsenal],season=${season})&fields=${SPEED_FIELDS}`;

const readStats = (person, type) =>
  person?.stats?.find((entry) => entry.type?.displayName === type)?.splits || [];

const roundTo = (value, places) =>
  Number.isFinite(value) ? Math.round(value * 10 ** places) / 10 ** places : null;

// The fastball he throws most, a four-seamer or a sinker, stands for how hard he throws.
function readFastballSpeed(arsenal) {
  const fastballs = arsenal
    .filter((pitch) => FASTBALLS.includes(pitch.stat?.type?.code))
    .sort((first, second) => second.stat.percentage - first.stat.percentage);
  return fastballs[0]?.stat.averageSpeed ?? null;
}

// Starters are the pitchers with at least half as many starts as the most any pitcher has made,
// so there's a field to rank against early in a season too.
function listStarterLines(leagueResponse) {
  const lines = leagueResponse?.stats?.[0]?.splits || [];
  const most = Math.max(0, ...lines.map((line) => line.stat?.gamesStarted || 0));
  const minimum = Math.max(1, Math.ceil(most / 2));
  return { minimum, lines: lines.filter((line) => (line.stat?.gamesStarted || 0) >= minimum) };
}

export function buildLeague(leagueResponse, speedResponses) {
  const { minimum, lines } = listStarterLines(leagueResponse);
  const speeds = new Map(
    speedResponses
      .flatMap((response) => response?.people || [])
      .map((person) => [person.id, readFastballSpeed(readStats(person, "pitchArsenal"))]),
  );
  const starters = lines.map((line) => ({
    id: line.player.id,
    era: Number(line.stat.era),
    k9: Number(line.stat.strikeoutsPer9Inn),
    bb9: Number(line.stat.walksPer9Inn),
    speed: speeds.get(line.player.id) ?? null,
  }));
  return { minimum, starters };
}

const MEASURES = { era: "low", k9: "high", bb9: "low", speed: "high" };

// A rank counts only the starters strictly better, so tied starters share one.
function rankAmong(starters, key, value) {
  const values = starters.map((starter) => starter[key]).filter(Number.isFinite);
  if (!Number.isFinite(value) || !values.length) return null;
  const isBetter = (other) => (MEASURES[key] === "low" ? other < value : other > value);
  return { rank: values.filter(isBetter).length + 1, of: values.length };
}

function rankStarter(league, id) {
  const starter = league.starters.find((candidate) => candidate.id === id);
  if (!starter) return null;
  return Object.fromEntries(
    Object.keys(MEASURES).map((key) => [key, rankAmong(league.starters, key, starter[key])]),
  );
}

function describeLine(line, arsenal) {
  if (!line) return null;
  return {
    starts: line.gamesStarted ?? 0,
    era: line.era,
    k9: roundTo(Number(line.strikeoutsPer9Inn), 1),
    bb9: roundTo(Number(line.walksPer9Inn), 1),
    speed: roundTo(readFastballSpeed(arsenal), 1),
  };
}

const describePitch = ({ stat }) => ({
  code: stat.type.code,
  name: stat.type.description,
  share: roundTo(stat.percentage, 3),
  mph: roundTo(stat.averageSpeed, 1),
});

function listRecentStarts(startsResponse) {
  const games = startsResponse?.stats?.[0]?.splits || [];
  return games
    .filter((game) => game.stat?.gamesStarted)
    .sort((first, second) => first.date.localeCompare(second.date))
    .slice(-RECENT_STARTS)
    .reverse()
    .map((game) => ({
      date: game.date,
      opp: readClubId(game.opponent?.id),
      home: Boolean(game.isHome),
      ip: game.stat.inningsPitched,
      runs: game.stat.runs,
      k: game.stat.strikeOuts,
    }));
}

export function describePitcher({ person: personResponse, starts }, league) {
  const person = personResponse?.people?.[0];
  if (!person) return null;
  const arsenal = readStats(person, "pitchArsenal").filter((pitch) => pitch.stat?.type?.code);
  return {
    id: person.id,
    firstName: person.useName,
    lastName: person.useLastName,
    hand: person.pitchHand?.code ?? null,
    age: person.currentAge ?? null,
    line: describeLine(readStats(person, "season")[0]?.stat, arsenal),
    ranks: rankStarter(league, person.id),
    starters: { count: league.starters.length, minimum: league.minimum },
    pitches: arsenal.map(describePitch),
    starts: listRecentStarts(starts),
  };
}

function readPersonId(searchParams) {
  const id = Number(searchParams.get("id"));
  return Number.isInteger(id) && id > 0 && id <= LARGEST_PERSON_ID ? id : null;
}

export function createPitcherServer({
  fetchImpl = (input, init) => fetch(input, init),
  now = () => Date.now(),
} = {}) {
  const leagues = new Map();

  async function fetchLeague(season) {
    const league = await fetchMlbJson(fetchImpl, listLeagueRequest(season), LEAGUE_CACHE_SECONDS);
    const ids = listStarterLines(league)
      .lines.map((line) => line.player.id)
      .sort((first, second) => first - second);
    const batches = [];
    for (let start = 0; start < ids.length; start += SPEED_BATCH_SIZE)
      batches.push(ids.slice(start, start + SPEED_BATCH_SIZE));
    const speeds = await Promise.all(
      batches.map((batch) =>
        fetchMlbJson(fetchImpl, listSpeedRequest(season, batch), LEAGUE_CACHE_SECONDS),
      ),
    );
    return buildLeague(league, speeds);
  }

  // Every sheet opened in a day ranks against one read of the league.
  function loadLeague(season) {
    const cached = leagues.get(season);
    if (cached && now() - cached.at < LEAGUE_REUSE_MS) return cached.promise;
    const promise = fetchLeague(season);
    leagues.set(season, { at: now(), promise });
    promise.catch(() => {
      if (leagues.get(season)?.promise === promise) leagues.delete(season);
    });
    return promise;
  }

  async function loadPitcher(id, season) {
    const requests = listPitcherRequests(id, season);
    const [person, starts, league] = await Promise.all([
      fetchMlbJson(fetchImpl, requests.person, PITCHER_CACHE_SECONDS),
      fetchMlbJson(fetchImpl, requests.starts, PITCHER_CACHE_SECONDS),
      loadLeague(season),
    ]);
    return describePitcher({ person, starts }, league);
  }

  /** @param {URL} url */
  async function servePitcher(url) {
    const id = readPersonId(url.searchParams);
    if (id == null) return respondJson({ error: "id must be an MLB person id" }, 400);
    const season = readSeasonParam(url.searchParams, now());
    if (season == null) return respondJson({ error: SEASON_RULE }, 400);
    try {
      const pitcher = await loadPitcher(id, season);
      if (!pitcher) return respondJson({ error: "MLB has no pitcher with that id" }, 404);
      return respondJson(pitcher);
    } catch (error) {
      return respondJson({ error: `Couldn't read MLB: ${describeError(error)}` }, 502);
    }
  }

  return { servePitcher };
}
