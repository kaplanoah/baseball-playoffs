import { listTeamLeaders, readStatsTable, REQUESTS } from "../../page/js/snapshot.js";
import { findTeamCode, TEAMS } from "../../page/js/teams.js";
import { respondJson } from "../../../../shared/worker/responses.js";
import { fetchWnbaJson, SEASON_PARAM } from "./wnba.js";

// Reads the league for a game that hasn't started, for the game sheet: the two teams' meetings
// this regular season, how their seasons compare, and each team's leading scorers.

// The schedule, standings, and season averages change at most a few times a day, so each answer
// is kept an hour once it's checked. Cloudflare's edge would keep a refusal for the hour too, and
// the page's snapshot reads the same addresses.
const PREVIEW_REUSE_MS = 60 * 60 * 1000;
const LEADERS_PER_TEAM = 3;
// Regular-season games, Commissioner's Cup games among them. The game sheet's header already counts
// a playoff series, and the preseason, the All-Star Game, and the Cup's final aren't meetings that
// count.
const MEETING_ID = /^102/;

// Where each feed's answer keeps its data.
const FEED_DATA = {
  schedule: (answer) => answer?.leagueSchedule?.gameDates,
  standings: (answer) => answer?.resultSets?.[0]?.rowSet,
  players: (answer) => answer?.resultSets?.[0]?.rowSet,
};

/** @param {number} season */
export const listPreviewRequests = (season) => ({
  schedule: REQUESTS.schedule,
  standings: REQUESTS.standings(season),
  players: REQUESTS.players(season),
});

const describeSeason = (row) => ({
  wins: row.WINS,
  losses: row.LOSSES,
  pointsFor: row.PointsPG,
  pointsAgainst: row.OppPointsPG,
  margin: row.DiffPointsPG,
  home: row.HOME,
  road: row.ROAD,
  lastTen: row.L10,
});

function findSeason(standings, team) {
  const row = readStatsTable(standings).find((each) => findTeamCode(each.TeamID) === team);
  return row ? describeSeason(row) : null;
}

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
 * @param {{ schedule?: any, standings?: any, players?: any }} responses null for a feed that didn't answer
 * @param {{ season: number, away: string, home: string }} game
 */
export function describePreview({ schedule, standings, players }, { season, away, home }) {
  const describeSide = (team) => ({
    team,
    season: standings ? findSeason(standings, team) : null,
    leaders: players ? listTeamLeaders(players, team, LEADERS_PER_TEAM) : null,
  });
  return {
    season,
    meetings: schedule ? listMeetings(schedule, season, [away, home]) : null,
    away: describeSide(away),
    home: describeSide(home),
  };
}

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
  const keptAnswers = new Map();

  async function readFeed(name, url) {
    const kept = keptAnswers.get(url);
    if (kept && now() - kept.at < PREVIEW_REUSE_MS) return kept.answer;
    const answer = await fetchWnbaJson(fetchImpl, url, null, (read) =>
      Array.isArray(FEED_DATA[name](read)),
    );
    keptAnswers.set(url, { at: now(), answer });
    return answer;
  }

  // Each feed is on its own: the sheet shows whatever parts answered.
  async function loadResponses(season) {
    const requests = listPreviewRequests(season);
    const names = Object.keys(requests);
    const answers = await Promise.all(
      names.map((name) => readFeed(name, requests[name]).catch(() => null)),
    );
    return Object.fromEntries(names.map((name, index) => [name, answers[index]]));
  }

  /** @param {URL} url */
  async function servePreview(url) {
    const season = SEASON_PARAM.readSeason(url.searchParams, now());
    if (season == null) return respondJson({ error: SEASON_PARAM.rule }, 400);
    const teams = readTeams(url.searchParams);
    if (!teams) return respondJson({ error: "away and home must be two WNBA teams" }, 400);
    const responses = await loadResponses(season);
    if (Object.values(responses).every((response) => !response))
      return respondJson({ error: "Couldn't read the WNBA: none of its feeds answered" }, 502);
    const [away, home] = teams;
    return respondJson(describePreview(responses, { season, away, home }));
  }

  return { servePreview };
}
