import { formatShortDate } from "#shared/days.js";
import { html } from "#shared/html.js";
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
import { ROUNDS } from "./snapshot.js";

// The game sheet's preview for a game that hasn't started: the two teams' meetings this season,
// their seasons side by side, and each team's leading scorers.

/** @typedef {{ team: string, score: number }} MeetingSide */
/** @typedef {{ id: string, start: string, round: number | null, number: number | null, away: MeetingSide, home: MeetingSide }} Meeting */
/** @typedef {{ wins: number, losses: number, pointsFor: number, pointsAgainst: number, margin: number, home: string, road: string, lastTen: string }} TeamSeason */
/** @typedef {{ id: number, firstName: string, lastName: string, games: number, points: number, rebounds: number, assists: number }} Leader */
/** @typedef {{ team: string, season: TeamSeason | null, leaders: Leader[] | null }} PreviewSide */
/** @typedef {{ season: number, meetings: Meeting[] | null, away: PreviewSide, home: PreviewSide }} Preview */

/** @type {("away" | "home")[]} */
const SIDES = ["away", "home"];

/** @param {Meeting} meeting */
const findWinner = (meeting) => (meeting.home.score > meeting.away.score ? "home" : "away");

/** @param {Meeting} meeting */
function renderMeeting(meeting) {
  const winnerPlace = findWinner(meeting);
  const winner = meeting[winnerPlace];
  const loser = meeting[winnerPlace === "home" ? "away" : "home"];
  const where = meeting.round
    ? html`<span class="meeting-round">${ROUNDS[meeting.round].shortName} G${meeting.number}</span>`
    : html`<span>${winnerPlace === "home" ? "at home" : "on the road"}</span>`;
  return html`<li>
    <span class="meeting-day tabular">${formatShortDate(new Date(meeting.start))}</span>
    <span class="meeting-result"
      >${renderClub(winner.team)}<span class="meeting-score tabular"
        >${winner.score}-${loser.score}</span
      ></span
    >
    ${where}
  </li>`;
}

// The season series is the regular season's meetings; the playoffs keep their own count.
/**
 * @param {Meeting[]} meetings
 * @param {Preview} preview
 */
function describeSeasonSeries(meetings, preview) {
  const regular = meetings.filter((meeting) => !meeting.round);
  if (!regular.length) return false;
  const countWins = (team) =>
    regular.filter((meeting) => meeting[findWinner(meeting)].team === team).length;
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
 * @param {string} label
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
 * @param {string} label
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
const describeSeasonRows = (away, home) => [
  describeRecords("Record", [`${away.wins}-${away.losses}`, `${home.wins}-${home.losses}`]),
  describeNumbers("Points", [away.pointsFor, home.pointsFor], { format: formatAverage }),
  describeNumbers("Allowed", [away.pointsAgainst, home.pointsAgainst], {
    format: formatAverage,
    isLowerBetter: true,
  }),
  describeNumbers("Margin", [away.margin, home.margin], { format: formatMargin }),
  describeRecords("Road / Home", [away.road, home.home]),
  describeRecords("Last 10", [away.lastTen, home.lastTen]),
];

/** @param {Preview} preview */
function renderSeasons(preview) {
  const [away, home] = SIDES.map((place) => preview[place].season);
  if (!away || !home)
    return renderSheetPart("The two seasons", renderSheetMessage("Couldn't load the standings."));
  return renderSheetPart(
    "The two seasons",
    html`${renderTapeTeams(preview.away.team, preview.home.team)}
      <div class="tape">
        ${describeSeasonRows(away, home).map(renderTapeRow)}
        <p class="tape-note">Points per game. Road / Home is the visitors' road record and the hosts' home record.</p>
      </div>`,
  );
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
  return html`<table class="players tabular">
    <thead>
      <tr>
        <th scope="col">${renderClub(side.team)}</th>
        <th scope="col" title="Points per game">Pts</th>
        <th scope="col" title="Rebounds per game">Reb</th>
        <th scope="col" title="Assists per game">Ast</th>
      </tr>
    </thead>
    <tbody>
      ${rows}
    </tbody>
  </table>`;
}

/** @param {Preview} preview */
function renderLeadingScorers(preview) {
  if (!preview.away.leaders || !preview.home.leaders)
    return renderSheetPart(
      "Leading scorers",
      renderSheetMessage("Couldn't load the players' averages."),
    );
  return renderSheetPart(
    "Leading scorers",
    html`<div class="player-tables">${SIDES.map((place) => renderLeaders(preview[place]))}</div>`,
    "Per game",
  );
}

/** @param {Preview} preview */
export const renderPreview = (preview) =>
  html`${renderMeetings(preview)} ${renderSeasons(preview)} ${renderLeadingScorers(preview)}`;
