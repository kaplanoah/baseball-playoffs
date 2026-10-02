import { formatShortDate } from "#shared/days.js";
import { html } from "#shared/html.js";
import { renderPlaceholder } from "#shared/placeholder.js";
import { renderTapeRow } from "#shared/tape.js";
import { renderClub } from "./clubs.js";
import { nameTeam } from "./series.js";
import {
  findLeader,
  measureAgainst,
  readWinShare,
  renderSheetMessage,
  renderSheetPart,
  renderTapeTeams,
} from "./sheet-parts.js";
import { findTeamLeaders, renderLeaderTable } from "./team-view.js";

// The game sheet's preview for a game that hasn't started: the two teams' meetings this regular
// season, from the Worker, then their seasons side by side and each team's leading scorers, from
// the season the page already has. Until the meetings load, they hold their shape with placeholders.

/** @typedef {{ team: string, score: number }} MeetingSide */
/** @typedef {{ id: string, start: string, away: MeetingSide, home: MeetingSide }} Meeting */
/** @typedef {{ wins: number, losses: number, pointsFor: number, pointsAgainst: number, margin: number, home: string, road: string, lastTen: string }} TeamSeason */
/** @typedef {import("./team-view.js").Season} Season */
/** @typedef {Record<"away" | "home", string>} Teams */

/** @type {("away" | "home")[]} */
const SIDES = ["away", "home"];
const ROAD_HOME = html`<span class="label-split">Road <i aria-hidden="true"></i> Home</span>`;
const SEASON_ROW_LABELS = ["Record", "PPG", "Opp PPG", "Differential", ROAD_HOME, "Last 10"];
// Teams in a playoff series have usually met a few times by then.
const PENDING_MEETINGS = 3;

/** @param {Meeting} meeting */
const findWinner = (meeting) => (meeting.home.score > meeting.away.score ? "home" : "away");

/** @param {Meeting} meeting */
function renderMeeting(meeting) {
  const winnerPlace = findWinner(meeting);
  const winner = meeting[winnerPlace];
  const loser = meeting[winnerPlace === "home" ? "away" : "home"];
  return html`<li>
    <span class="meeting-day tabular">${formatShortDate(new Date(meeting.start))}</span>
    <span class="meeting-result"
      >${renderClub(winner.team)}<span class="meeting-score tabular"
        >${winner.score}-${loser.score}</span
      ></span
    >
    <span>${winnerPlace === "home" ? "at home" : "on the road"}</span>
  </li>`;
}

/**
 * @param {Meeting[]} meetings
 * @param {Teams} teams
 */
function describeSeasonSeries(meetings, teams) {
  const countWins = (team) =>
    meetings.filter((meeting) => meeting[findWinner(meeting)].team === team).length;
  const [away, home] = SIDES.map((place) => countWins(teams[place]));
  if (away === home) return `Season series split ${away}-${home}`;
  const leader = away > home ? teams.away : teams.home;
  return `${nameTeam(leader)} won the season series ${Math.max(away, home)}-${Math.min(away, home)}`;
}

/**
 * @param {Meeting[] | null} meetings
 * @param {Teams} teams
 */
function renderMeetings(meetings, teams) {
  if (!meetings)
    return renderSheetPart("Meetings", renderSheetMessage("Couldn't load this season's meetings."));
  if (!meetings.length)
    return renderSheetPart("Meetings", renderSheetMessage("They haven't met this season."));
  return renderSheetPart(
    "Meetings",
    html`<ul class="meetings">
      ${meetings.map(renderMeeting)}
    </ul>`,
    describeSeasonSeries(meetings, teams),
  );
}

const renderPendingMeeting = () =>
  html`<li>
    <span class="meeting-day">${renderPlaceholder("Sep 00")}</span>
    <span class="meeting-result">${renderPlaceholder("Team 00-00")}</span>
    <span>${renderPlaceholder("on the road")}</span>
  </li>`;

const renderPendingMeetings = () =>
  renderSheetPart(
    "Meetings",
    html`<ul class="meetings">
      ${Array.from({ length: PENDING_MEETINGS }, renderPendingMeeting)}
    </ul>`,
  );

const formatAverage = (value) => value.toFixed(1);
const formatMargin = (value) => `${value > 0 ? "+" : ""}${value.toFixed(1)}`;

/**
 * A row that compares two records, like 15-7, by the share of games each won.
 * @param {import("#shared/html.js").Markup | string} label
 * @param {[string, string]} records
 */
function describeRecords(label, records) {
  const shares = records.map(readWinShare);
  const describeSide = (index) => ({
    value: records[index],
    bar: shares[index] == null ? null : Math.round(shares[index] * 100),
  });
  return {
    label,
    away: describeSide(0),
    home: describeSide(1),
    leader: findLeader(shares[0], shares[1]),
  };
}

/**
 * A row that compares two numbers, each bar as long as its share of the larger.
 * @param {import("#shared/html.js").Markup | string} label
 * @param {[number, number]} values
 * @param {{ format: (value: number) => string, isLowerBetter?: boolean }} options
 */
function describeNumbers(label, values, { format, isLowerBetter = false }) {
  const reaches = values.map((value) => Math.max(value, 0));
  const most = Math.max(...reaches);
  const describeSide = (index) => ({
    value: format(values[index]),
    bar: measureAgainst(reaches[index], most),
  });
  return {
    label,
    away: describeSide(0),
    home: describeSide(1),
    leader: findLeader(values[0], values[1], { isLowerBetter }),
  };
}

// The visitors play on the road and the hosts at home, so each is measured where it plays.
/**
 * @param {TeamSeason} away
 * @param {TeamSeason} home
 */
const describeSeasonRows = (away, home) => {
  const [record, points, allowed, differential, roadHome, lastTen] = SEASON_ROW_LABELS;
  return [
    describeRecords(record, [`${away.wins}-${away.losses}`, `${home.wins}-${home.losses}`]),
    describeNumbers(points, [away.pointsFor, home.pointsFor], { format: formatAverage }),
    describeNumbers(allowed, [away.pointsAgainst, home.pointsAgainst], {
      format: formatAverage,
      isLowerBetter: true,
    }),
    describeNumbers(differential, [away.margin, home.margin], { format: formatMargin }),
    describeRecords(roadHome, [away.road, home.home]),
    describeRecords(lastTen, [away.lastTen, home.lastTen]),
  ];
};

/**
 * A team's line in the standings, once it has the averages the preview compares.
 * @param {Season | null} season
 * @param {string} team
 * @returns {TeamSeason | null}
 */
function findTeamSeason(season, team) {
  const row = season?.standings?.find((each) => each.team === team);
  if (!row) return null;
  const { wins, losses, pointsFor, pointsAgainst, margin } = row;
  if (pointsFor == null || pointsAgainst == null || margin == null) return null;
  const [home, road, lastTen] = [row.home, row.road, row.lastTen].map((record) => record ?? "");
  return { wins, losses, pointsFor, pointsAgainst, margin, home, road, lastTen };
}

/**
 * @param {Teams} teams
 * @param {Season | null} season
 */
function renderSeasons(teams, season) {
  const [away, home] = SIDES.map((place) => findTeamSeason(season, teams[place]));
  if (!away || !home)
    return renderSheetPart("Season stats", renderSheetMessage("Couldn't load the standings."));
  return renderSheetPart(
    "Season stats",
    html`${renderTapeTeams(teams.away, teams.home)}
      <div class="tape">${describeSeasonRows(away, home).map(renderTapeRow)}</div>`,
  );
}

/**
 * @param {Teams} teams
 * @param {Season | null} season
 */
function renderLeadingScorers(teams, season) {
  const [away, home] = SIDES.map((place) => findTeamLeaders(season, teams[place]));
  if (!away.length || !home.length)
    return renderSheetPart(
      "Leading scorers",
      renderSheetMessage("Couldn't load the players' averages."),
    );
  return renderSheetPart(
    "Leading scorers",
    html`<div class="player-tables">
      ${renderLeaderTable(renderClub(teams.away), away)}${renderLeaderTable(renderClub(teams.home), home)}
    </div>`,
    "Per game",
  );
}

/**
 * The preview: the meetings, or their placeholders while they load, then the two seasons and the
 * leading scorers.
 * @param {{ teams: Teams, season: Season | null, meetings: Meeting[] | null, isLoading: boolean }} parts
 */
export const renderPreview = ({ teams, season, meetings, isLoading }) =>
  html`${isLoading ? renderPendingMeetings() : renderMeetings(meetings, teams)}
  ${renderSeasons(teams, season)} ${renderLeadingScorers(teams, season)}`;
