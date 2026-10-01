import { formatShortDate } from "#shared/days.js";
import { html } from "#shared/html.js";
import { renderPlaceholder } from "#shared/placeholder.js";
import { renderPendingTapeRow, renderTapeRow } from "#shared/tape.js";
import { renderClub } from "./clubs.js";
import { nameTeam } from "./series.js";
import {
  findLeader,
  measureAgainst,
  readWinShare,
  renderPendingPlayerRows,
  renderSheetMessage,
  renderSheetPart,
  renderTapeTeams,
} from "./sheet-parts.js";

// The game sheet's preview for a game that hasn't started: the two teams' meetings this regular season,
// their seasons side by side, and each team's leading scorers. Until it loads, each part holds its
// shape with placeholders.

/** @typedef {{ team: string, score: number }} MeetingSide */
/** @typedef {{ id: string, start: string, away: MeetingSide, home: MeetingSide }} Meeting */
/** @typedef {{ wins: number, losses: number, pointsFor: number, pointsAgainst: number, margin: number, home: string, road: string, lastTen: string }} TeamSeason */
/** @typedef {{ id: number, firstName: string, lastName: string, games: number, points: number, rebounds: number, assists: number }} Leader */
/** @typedef {{ team: string, season: TeamSeason | null, leaders: Leader[] | null }} PreviewSide */
/** @typedef {{ season: number, meetings: Meeting[] | null, away: PreviewSide, home: PreviewSide }} Preview */

/** @type {("away" | "home")[]} */
const SIDES = ["away", "home"];
const ROAD_HOME = html`<span class="label-split">Road <i aria-hidden="true"></i> Home</span>`;
const SEASON_ROW_LABELS = ["Record", "PPG", "Opp PPG", "Differential", ROAD_HOME, "Last 10"];
const SEASONS_TITLE = "Season stats";
// Teams in a playoff series have usually met a few times by then.
const PENDING_MEETINGS = 3;
// The Worker sends each team's three leading scorers.
const PENDING_LEADERS = 3;

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
 * @param {Preview} preview
 */
function describeSeasonSeries(meetings, preview) {
  const countWins = (team) =>
    meetings.filter((meeting) => meeting[findWinner(meeting)].team === team).length;
  const [away, home] = SIDES.map((place) => countWins(preview[place].team));
  if (away === home) return `Season series split ${away}-${home}`;
  const leader = away > home ? preview.away.team : preview.home.team;
  return `${nameTeam(leader)} won the season series ${Math.max(away, home)}-${Math.min(away, home)}`;
}

/** @param {Preview} preview */
function renderMeetings(preview) {
  const { meetings } = preview;
  if (!meetings)
    return renderSheetPart("Meetings", renderSheetMessage("Couldn't load this season's meetings."));
  if (!meetings.length)
    return renderSheetPart("Meetings", renderSheetMessage("They haven't met this season."));
  return renderSheetPart(
    "Meetings",
    html`<ul class="meetings">
      ${meetings.map(renderMeeting)}
    </ul>`,
    describeSeasonSeries(meetings, preview),
  );
}

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
 * @param {Record<"away" | "home", string>} teams
 * @param {import("#shared/html.js").Markup[]} rows
 */
const renderSeasonsTape = (teams, rows) =>
  renderSheetPart(
    SEASONS_TITLE,
    html`${renderTapeTeams(teams.away, teams.home)}
      <div class="tape">${rows}</div>`,
  );

/** @param {Preview} preview */
function renderSeasons(preview) {
  const [away, home] = SIDES.map((place) => preview[place].season);
  if (!away || !home)
    return renderSheetPart(SEASONS_TITLE, renderSheetMessage("Couldn't load the standings."));
  const teams = { away: preview.away.team, home: preview.home.team };
  return renderSeasonsTape(teams, describeSeasonRows(away, home).map(renderTapeRow));
}

/** @param {PreviewSide} side */
function renderLeaders(side) {
  const rows = (side.leaders ?? []).map(
    (leader) => html`<tr>
      <th scope="row"><span class="first-name">${leader.firstName}</span> ${leader.lastName}</th>
      <td>${formatAverage(leader.points)}</td>
      <td>${formatAverage(leader.rebounds)}</td>
      <td>${formatAverage(leader.assists)}</td>
    </tr>`,
  );
  return renderLeadersTable(side.team, rows);
}

/**
 * @param {string} team
 * @param {import("#shared/html.js").Markup[]} rows
 */
const renderLeadersTable = (team, rows) =>
  html`<table class="players tabular">
    <thead>
      <tr>
        <th scope="col">${renderClub(team)}</th>
        <th scope="col" title="Points per game">Pts</th>
        <th scope="col" title="Rebounds per game">Reb</th>
        <th scope="col" title="Assists per game">Ast</th>
      </tr>
    </thead>
    <tbody>
      ${rows}
    </tbody>
  </table>`;

/** @param {import("#shared/html.js").Markup[]} tables */
const renderLeadingScorersPart = (tables) =>
  renderSheetPart("Leading scorers", html`<div class="player-tables">${tables}</div>`, "Per game");

/** @param {Preview} preview */
function renderLeadingScorers(preview) {
  if (!preview.away.leaders || !preview.home.leaders)
    return renderSheetPart(
      "Leading scorers",
      renderSheetMessage("Couldn't load the players' averages."),
    );
  return renderLeadingScorersPart(SIDES.map((place) => renderLeaders(preview[place])));
}

/** @param {Preview} preview */
export const renderPreview = (preview) =>
  html`${renderMeetings(preview)} ${renderSeasons(preview)} ${renderLeadingScorers(preview)}`;

const renderPendingMeeting = () =>
  html`<li>
    <span class="meeting-day">${renderPlaceholder("Sep 00")}</span>
    <span class="meeting-result">${renderPlaceholder("Team 00-00")}</span>
    <span>${renderPlaceholder("on the road")}</span>
  </li>`;

/**
 * The preview's parts, in their shape, while it loads.
 * @param {Record<"away" | "home", string>} teams
 */
export const renderPendingPreview = (teams) =>
  html`${renderSheetPart(
    "Meetings",
    html`<ul class="meetings">
      ${Array.from({ length: PENDING_MEETINGS }, renderPendingMeeting)}
    </ul>`,
  )}
  ${renderSeasonsTape(teams, SEASON_ROW_LABELS.map(renderPendingTapeRow))}
  ${renderLeadingScorersPart(
    SIDES.map((place) =>
      renderLeadersTable(teams[place], renderPendingPlayerRows(PENDING_LEADERS, 3)),
    ),
  )}`;
