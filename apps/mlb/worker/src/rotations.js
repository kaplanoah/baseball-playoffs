import { addDays } from "#shared/days.js";
import { readMlbTeamId } from "../../page/js/snapshot.js";
import { DATE_RULE, fetchMlbJson, readDateParam } from "./mlb.js";
import { describeError, respondJson } from "../../../../shared/worker/responses.js";

// Reads MLB for a club that hasn't named a game's starter: who started its last games, how each
// of those starts went, and the rest each pitcher would have by the game's day.

// A club's starts change at most once a game.
const ROTATION_CACHE_SECONDS = 10 * 60;
// Two weeks back reaches a full turn of the rotation, even across a bye before the postseason.
const LOOKBACK_DAYS = 14;
const ROTATION_SIZE = 5;
const MS_PER_DAY = 86400000;

const SCHEDULE_FIELDS = [
  "dates",
  "games",
  "officialDate",
  "status",
  "abstractGameState",
  "teams",
  "away",
  "home",
  "team",
  "id",
  "probablePitcher",
].join(",");
const GAME_LOG_FIELDS = [
  "people",
  "id",
  "useLastName",
  "pitchHand",
  "code",
  "stats",
  "splits",
  "date",
  "stat",
  "gamesStarted",
  "inningsPitched",
  "numberOfPitches",
].join(",");

export const listScheduleRequest = (mlbTeamId, date) =>
  `/api/v1/schedule?sportId=1&teamId=${mlbTeamId}&startDate=${addDays(date, -LOOKBACK_DAYS)}` +
  `&endDate=${addDays(date, -1)}&gameType=R,F,D,L,W&hydrate=probablePitcher` +
  `&fields=${SCHEDULE_FIELDS}`;

// Sorted, so the same starters make the same request and MLB's cache can answer it.
export const listGameLogRequest = (ids, season) =>
  `/api/v1/people?personIds=${[...ids].sort((first, second) => first - second).join(",")}` +
  `&hydrate=stats(group=[pitching],type=[gameLog],season=${season},gameType=[R,F,D,L,W])` +
  `&fields=${GAME_LOG_FIELDS}`;

const findClubSide = (game, mlbTeamId) =>
  [game.teams?.away, game.teams?.home].find((side) => side?.team?.id === mlbTeamId);

// A finished game names the pitcher who started it.
function listStarterIds(scheduleResponse, mlbTeamId) {
  const games = (scheduleResponse?.dates || [])
    .flatMap((day) => day.games || [])
    .filter((game) => game.status?.abstractGameState === "Final")
    .sort((first, second) => second.officialDate.localeCompare(first.officialDate));
  const ids = games
    .map((game) => findClubSide(game, mlbTeamId)?.probablePitcher?.id)
    .filter(Boolean);
  return [...new Set(ids)].slice(0, ROTATION_SIZE);
}

const countDaysBetween = (earlier, later) =>
  Math.round((Date.parse(later) - Date.parse(earlier)) / MS_PER_DAY);

function findLastStart(person, date) {
  const games = person.stats?.[0]?.splits || [];
  return games
    .filter((game) => game.stat?.gamesStarted && game.date < date)
    .sort((first, second) => first.date.localeCompare(second.date))
    .at(-1);
}

function describeStarter(person, date) {
  const start = findLastStart(person, date);
  if (!start) return null;
  return {
    id: person.id,
    name: person.useLastName,
    hand: person.pitchHand?.code ?? null,
    start: {
      date: start.date,
      ip: start.stat.inningsPitched,
      pitches: start.stat.numberOfPitches ?? null,
    },
    rest: countDaysBetween(start.date, date) - 1,
  };
}

/**
 * The club's last starters, the most recent first, as of the morning of `date`.
 * @param {{ people?: object[] } | null} gameLogResponse
 * @param {string} club
 * @param {string} date
 */
export function describeRotation(gameLogResponse, club, date) {
  const starters = (gameLogResponse?.people || [])
    .map((person) => describeStarter(person, date))
    .filter(Boolean)
    .sort((first, second) => first.rest - second.rest);
  return { club, date, starters };
}

export function createRotationServer({ fetchImpl = (input, init) => fetch(input, init) } = {}) {
  async function loadRotation(club, date) {
    const mlbTeamId = readMlbTeamId(club);
    const schedule = await fetchMlbJson(
      fetchImpl,
      listScheduleRequest(mlbTeamId, date),
      ROTATION_CACHE_SECONDS,
    );
    const ids = listStarterIds(schedule, mlbTeamId);
    if (!ids.length) return describeRotation(null, club, date);
    const season = Number(date.slice(0, 4));
    const gameLogs = await fetchMlbJson(
      fetchImpl,
      listGameLogRequest(ids, season),
      ROTATION_CACHE_SECONDS,
    );
    return describeRotation(gameLogs, club, date);
  }

  /** @param {URL} url */
  async function serveRotation(url) {
    const club = url.searchParams.get("club") ?? "";
    if (!readMlbTeamId(club)) return respondJson({ error: "club must be an MLB club" }, 400);
    const date = readDateParam(url.searchParams);
    if (date == null) return respondJson({ error: DATE_RULE }, 400);
    try {
      return respondJson(await loadRotation(club, date));
    } catch (error) {
      return respondJson({ error: `Couldn't read MLB: ${describeError(error)}` }, 502);
    }
  }

  return { serveRotation };
}
