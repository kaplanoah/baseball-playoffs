import { readGameState } from "../../page/js/snapshot.js";
import { describeError, respondJson } from "../../../../shared/worker/responses.js";
import { fetchWnbaJson } from "./wnba.js";

// Reads the league's box score for one game, for the game sheet: each team's points by quarter,
// its stats, and every player who got in.

// A live game's box score changes with every play, so it's kept as briefly as the scoreboard.
const BOX_SCORE_CACHE_SECONDS = 5;
const GAME_ID = /^\d{10}$/;
// The league's CDN has no box score for a game that hasn't started, and says so with a 403.
const NOT_YET_STATUSES = [403, 404];

/** @param {string} id */
export const nameBoxScoreRequest = (id) =>
  `https://cdn.wnba.com/static/json/liveData/boxscore/boxscore_${id}.json`;

// The feed writes durations like PT26M; whole minutes are all the sheet shows.
const readMinutes = (duration) => Number(String(duration ?? "").match(/^PT(\d+)M/)?.[1] ?? 0);

const describePlayer = ({ personId, firstName, familyName, statistics }) => ({
  id: personId,
  firstName,
  lastName: familyName,
  minutes: readMinutes(statistics.minutesCalculated),
  points: statistics.points,
  rebounds: statistics.reboundsTotal,
  assists: statistics.assists,
  fouls: statistics.foulsPersonal,
});

const describeTeamStats = (stats) => ({
  fieldGoals: [stats.fieldGoalsMade, stats.fieldGoalsAttempted],
  threePointers: [stats.threePointersMade, stats.threePointersAttempted],
  freeThrows: [stats.freeThrowsMade, stats.freeThrowsAttempted],
  rebounds: stats.reboundsTotal,
  assists: stats.assists,
  turnovers: stats.turnoversTotal,
  paintPoints: stats.pointsInThePaint,
  benchPoints: stats.benchPoints,
  biggestLead: stats.biggestLead,
});

const describeTeam = (team) => ({
  team: team.teamTricode,
  score: team.score,
  periods: (team.periods ?? []).map((period) => period.score),
  timeouts: team.timeoutsRemaining ?? null,
  stats: describeTeamStats(team.statistics ?? {}),
  players: (team.players ?? [])
    .filter((player) => player.played === "1" && player.statistics)
    .map(describePlayer),
});

/** @param {any} answer */
const hasBoxScore = (answer) => !!answer?.game?.homeTeam && !!answer.game.awayTeam;

/** @param {any} response the league's box score */
export function describeBoxScore(response) {
  const { game } = response;
  const stats = game.homeTeam.statistics ?? {};
  return {
    id: String(game.gameId),
    state: readGameState(game.gameStatus),
    period: game.period ?? null,
    leadChanges: stats.leadChanges ?? null,
    timesTied: stats.timesTied ?? null,
    away: describeTeam(game.awayTeam),
    home: describeTeam(game.homeTeam),
  };
}

// A finished game's box score never changes, so it's read once and kept.
export function createBoxScoreServer({ fetchImpl = (input, init) => fetch(input, init) } = {}) {
  /** @type {Map<string, ReturnType<typeof describeBoxScore>>} */
  const finishedBoxScores = new Map();

  /** @param {string} id */
  async function loadBoxScore(id) {
    if (finishedBoxScores.has(id)) return finishedBoxScores.get(id);
    const response = await fetchWnbaJson(
      fetchImpl,
      nameBoxScoreRequest(id),
      BOX_SCORE_CACHE_SECONDS,
      hasBoxScore,
    );
    const boxScore = describeBoxScore(response);
    if (boxScore.state === "final") finishedBoxScores.set(id, boxScore);
    return boxScore;
  }

  /** @param {URL} url */
  async function serveBoxScore(url) {
    const id = url.searchParams.get("id") ?? "";
    if (!GAME_ID.test(id)) return respondJson({ error: "id must be a WNBA game id" }, 400);
    try {
      return respondJson(await loadBoxScore(id));
    } catch (error) {
      if (NOT_YET_STATUSES.includes(/** @type {{ status?: number }} */ (error).status))
        return respondJson({ error: "The WNBA has no box score for that game yet" }, 404);
      return respondJson({ error: `Couldn't read the WNBA: ${describeError(error)}` }, 502);
    }
  }

  return { loadBoxScore, serveBoxScore };
}
