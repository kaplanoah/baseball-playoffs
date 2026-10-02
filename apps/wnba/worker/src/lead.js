import { readEasternDay } from "#shared/days.js";
import { findTeamCodeByEspnId, TEAMS } from "../../page/js/teams.js";
import { describeError, respondJson } from "../../../../shared/worker/responses.js";
import { fetchUpstream } from "../../../../shared/worker/upstream.js";
import { ESPN_HEADERS } from "./wnba.js";

// Reads ESPN for the score through one game, for the game sheet's chart of the lead: the score
// after each basket, and when in the game it came, from the scoring plays in ESPN's game summary.

const ESPN_SITE = "https://site.api.espn.com/apis/site/v2/sports/basketball/wnba";
// A day's games change only as they start and end, and a live game's plays with every basket.
const SCOREBOARD_CACHE_SECONDS = 60;
const SUMMARY_CACHE_SECONDS = 15;
const QUARTER_SECONDS = 10 * 60;
const OVERTIME_SECONDS = 5 * 60;
const REGULATION_PERIODS = 4;

/** @param {string} start */
export const nameScoreboardRequest = (start) =>
  `${ESPN_SITE}/scoreboard?dates=${readEasternDay(Date.parse(start)).date.replaceAll("-", "")}`;

/** @param {string} eventId */
export const nameSummaryRequest = (eventId) => `${ESPN_SITE}/summary?event=${eventId}`;

/** @param {number} period */
const measurePeriod = (period) =>
  period > REGULATION_PERIODS ? OVERTIME_SECONDS : QUARTER_SECONDS;

/**
 * The seconds played when a period's clock reads `clock`, like 7:58 or, in its last minute, 45.2.
 * @param {number} period
 * @param {string} clock
 */
function countSecondsPlayed(period, clock) {
  const [minutes, seconds] = String(clock).includes(":")
    ? String(clock).split(":").map(Number)
    : [0, Number(clock)];
  const before = Array.from({ length: period - 1 }, (_, index) => measurePeriod(index + 1)).reduce(
    (sum, length) => sum + length,
    0,
  );
  const left = Math.min(measurePeriod(period), minutes * 60 + seconds);
  return Math.round(before + measurePeriod(period) - left);
}

/**
 * @param {any} competition
 * @param {"away" | "home"} place
 */
const findCompetitorCode = (competition, place) =>
  findTeamCodeByEspnId(
    competition?.competitors?.find((competitor) => competitor.homeAway === place)?.team?.id,
  );

/**
 * The day's ESPN game between the two teams, home and away as asked.
 * @param {any} scoreboard
 * @param {{ away: string, home: string }} teams
 */
export function findEventId(scoreboard, { away, home }) {
  const event = (scoreboard?.events ?? []).find((each) => {
    const [competition] = each.competitions ?? [];
    return (
      findCompetitorCode(competition, "away") === away &&
      findCompetitorCode(competition, "home") === home
    );
  });
  return event ? String(event.id) : null;
}

/**
 * Each scoring play's time in the game, in seconds from tip-off, with the score after it, from a
 * tied start. A game that went to overtime counts its periods past the fourth.
 * @param {any} summary ESPN's game summary
 */
export function describeLead(summary) {
  const scores = (summary?.plays ?? [])
    .filter((play) => play.scoringPlay && play.period?.number && play.clock?.displayValue)
    .map((play) => [
      countSecondsPlayed(play.period.number, play.clock.displayValue),
      play.awayScore,
      play.homeScore,
    ]);
  const lastPeriod = Math.max(
    REGULATION_PERIODS,
    ...(summary?.plays ?? []).map((play) => play.period?.number ?? 0),
  );
  return {
    periods: lastPeriod,
    isOver: summary?.header?.competitions?.[0]?.status?.type?.completed === true,
    scores: [[0, 0, 0], ...scores],
  };
}

/** @param {URLSearchParams} searchParams */
function readGame(searchParams) {
  const away = searchParams.get("away") ?? "";
  const home = searchParams.get("home") ?? "";
  const start = searchParams.get("start") ?? "";
  const isValid =
    Object.hasOwn(TEAMS, away) &&
    Object.hasOwn(TEAMS, home) &&
    away !== home &&
    Number.isFinite(Date.parse(start));
  return isValid ? { away, home, start } : null;
}

export function createLeadServer({ fetchImpl = (input, init) => fetch(input, init) } = {}) {
  /**
   * @param {string} url
   * @param {number} cacheSeconds
   */
  async function fetchEspnJson(url, cacheSeconds) {
    const response = await fetchUpstream(fetchImpl, url, { headers: ESPN_HEADERS, cacheSeconds });
    if (!response.ok) throw new Error(`ESPN answered ${response.status}`);
    return response.json();
  }

  /** @param {URL} url */
  async function serveLead(url) {
    const game = readGame(url.searchParams);
    if (!game) return respondJson({ error: "away, home, and start must name a WNBA game" }, 400);
    try {
      const scoreboard = await fetchEspnJson(
        nameScoreboardRequest(game.start),
        SCOREBOARD_CACHE_SECONDS,
      );
      const eventId = findEventId(scoreboard, game);
      if (!eventId) return respondJson({ error: "ESPN has no such game that day" }, 404);
      const summary = await fetchEspnJson(nameSummaryRequest(eventId), SUMMARY_CACHE_SECONDS);
      return respondJson({ ...game, ...describeLead(summary) });
    } catch (error) {
      return respondJson({ error: `Couldn't read ESPN: ${describeError(error)}` }, 502);
    }
  }

  return { serveLead };
}
