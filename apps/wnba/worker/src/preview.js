import { readPlayoffGameId, REQUESTS } from "../../page/js/snapshot.js";
import { findTeamCode, TEAMS } from "../../page/js/teams.js";
import { respondJson } from "../../../../shared/worker/responses.js";
import { fetchWnbaJson, readSeasonParam, SEASON_RULE } from "./wnba.js";

// Reads the league for a game that hasn't started, for the game sheet: the two teams' meetings
// this season, how their seasons compare, and each team's leading scorers.

// The schedule, standings, and season averages change at most a few times a day.
const PREVIEW_CACHE_SECONDS = 60 * 60;
const LEADERS_PER_TEAM = 3;
// Regular-season games, Commissioner's Cup games among them, and playoff games. The rest are the
// preseason, the All-Star Game, and the Cup's final, which aren't meetings that count.
const MEETING_ID = /^10[24]/;

/** @param {number} season */
const namePlayersRequest = (season) =>
  `https://stats.wnba.com/stats/leaguedashplayerstats?${new URLSearchParams({
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
  })}`;

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
  players: namePlayersRequest(season),
});

// The stats site answers with a table: its column names, then a row of values for each line.
function readTable(response) {
  const table = response?.resultSets?.[0];
  if (!table) return [];
  return table.rowSet.map((row) =>
    Object.fromEntries(table.headers.map((header, index) => [header, row[index]])),
  );
}

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
  const row = readTable(standings).find((each) => findTeamCode(each.TeamID) === team);
  return row ? describeSeason(row) : null;
}

// The feed gives a player's name whole; everything after the first space is her last name.
function splitName(name) {
  const [firstName, ...rest] = String(name).split(" ");
  return { firstName, lastName: rest.join(" ") };
}

// A player who has missed most of the team's games doesn't lead it, however well she scores.
function listLeaders(players, team) {
  const rows = readTable(players).filter((row) => findTeamCode(row.TEAM_ID) === team);
  const most = Math.max(0, ...rows.map((row) => row.GP));
  return rows
    .filter((row) => row.GP >= most / 2)
    .sort((first, second) => second.PTS - first.PTS)
    .slice(0, LEADERS_PER_TEAM)
    .map((row) => ({
      id: row.PLAYER_ID,
      ...splitName(row.PLAYER_NAME),
      games: row.GP,
      points: row.PTS,
      rebounds: row.REB,
      assists: row.AST,
    }));
}

const describeMeetingSide = (side) => ({ team: side.teamTricode, score: side.score });

function describeMeeting(game) {
  const place = readPlayoffGameId(game.gameId);
  return {
    id: String(game.gameId),
    start: game.gameDateTimeUTC ?? game.gameTimeUTC ?? null,
    round: place?.round ?? null,
    number: place?.game ?? null,
    away: describeMeetingSide(game.awayTeam),
    home: describeMeetingSide(game.homeTeam),
  };
}

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
    leaders: players ? listLeaders(players, team) : null,
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
  // Each feed is on its own: the sheet shows whatever parts answered.
  async function loadResponses(season) {
    const requests = listPreviewRequests(season);
    const names = Object.keys(requests);
    const answers = await Promise.all(
      names.map((name) =>
        fetchWnbaJson(fetchImpl, requests[name], PREVIEW_CACHE_SECONDS, (answer) =>
          Array.isArray(FEED_DATA[name](answer)),
        ).catch(() => null),
      ),
    );
    return Object.fromEntries(names.map((name, index) => [name, answers[index]]));
  }

  /** @param {URL} url */
  async function servePreview(url) {
    const season = readSeasonParam(url.searchParams, now());
    if (season == null) return respondJson({ error: SEASON_RULE }, 400);
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
