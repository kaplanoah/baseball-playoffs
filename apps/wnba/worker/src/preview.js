import { REQUESTS } from "../../page/js/snapshot.js";
import { TEAMS } from "../../page/js/teams.js";
import { respondJson } from "../../../../shared/worker/responses.js";
import { fetchWnbaJson, SEASON_PARAM } from "./wnba.js";

// Reads the league for a game that hasn't started, for the game sheet: the two teams' meetings
// this regular season. The sheet takes how their seasons compare and their leading scorers from
// the store, which the season updater keeps, so opening it never waits on the slow stats site.

// The schedule changes at most a few times a day, so its answer is kept an hour once it's checked.
// Cloudflare's edge would keep a refusal for the hour too, and the page's snapshot reads the same
// address.
const SCHEDULE_REUSE_MS = 60 * 60 * 1000;
// Regular-season games, Commissioner's Cup games among them. The game sheet's header already counts
// a playoff series, and the preseason, the All-Star Game, and the Cup's final aren't meetings that
// count.
const MEETING_ID = /^102/;

const hasGameDates = (answer) => Array.isArray(answer?.leagueSchedule?.gameDates);

const describeMeetingSide = (side) => ({ team: side.teamTricode, score: side.score });

const describeMeeting = (game) => ({
  id: String(game.gameId),
  start: game.gameDateTimeUTC ?? game.gameTimeUTC ?? null,
  away: describeMeetingSide(game.awayTeam),
  home: describeMeetingSide(game.homeTeam),
});

// The schedule only ever holds the current season, so another season's meetings aren't in it.
function listMeetings(schedule, season, teams) {
  if (schedule?.leagueSchedule?.seasonYear !== String(season)) return null;
  const isMeeting = (game) =>
    MEETING_ID.test(String(game.gameId)) &&
    game.gameStatus === 3 &&
    [game.awayTeam.teamTricode, game.homeTeam.teamTricode].sort().join() ===
      [...teams].sort().join();
  return schedule.leagueSchedule.gameDates
    .flatMap((day) => day.games)
    .filter(isMeeting)
    .map(describeMeeting)
    .sort((first, second) => Date.parse(second.start) - Date.parse(first.start));
}

/**
 * @param {any} schedule
 * @param {{ season: number, away: string, home: string }} game
 */
export const describePreview = (schedule, { season, away, home }) => ({
  season,
  away,
  home,
  meetings: listMeetings(schedule, season, [away, home]),
});

/** @param {URLSearchParams} searchParams */
function readTeams(searchParams) {
  const teams = ["away", "home"].map((place) => searchParams.get(place) ?? "");
  const isValid = teams.every((team) => Object.hasOwn(TEAMS, team)) && teams[0] !== teams[1];
  return isValid ? teams : null;
}

export function createPreviewServer({
  fetchImpl = (input, init) => fetch(input, init),
  now = () => Date.now(),
} = {}) {
  let kept = null;

  async function readSchedule() {
    if (kept && now() - kept.at < SCHEDULE_REUSE_MS) return kept.answer;
    const answer = await fetchWnbaJson(fetchImpl, REQUESTS.schedule, null, hasGameDates);
    kept = { at: now(), answer };
    return answer;
  }

  /** @param {URL} url */
  async function servePreview(url) {
    const season = SEASON_PARAM.readSeason(url.searchParams, now());
    if (season == null) return respondJson({ error: SEASON_PARAM.rule }, 400);
    const teams = readTeams(url.searchParams);
    if (!teams) return respondJson({ error: "away and home must be two WNBA teams" }, 400);
    const schedule = await readSchedule().catch(() => null);
    if (!schedule)
      return respondJson({ error: "Couldn't read the WNBA: its schedule didn't answer" }, 502);
    const [away, home] = teams;
    return respondJson(describePreview(schedule, { season, away, home }));
  }

  return { servePreview };
}
