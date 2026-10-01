import { html } from "#shared/html.js";
import { renderClub } from "./clubs.js";

/** @typedef {{ team: string, conference: string, wins: number, losses: number, place: number, conferencePlace: number, gamesBack: number | null, conferenceGamesBack: number | null, clinch: string | null, streak: string | null, lastTen: string | null, pointsFor?: number | null, pointsAgainst?: number | null, margin?: number | null, home?: string | null, road?: string | null }} StandingsRow */

// The top eight across the league make the playoffs, whatever their conference.
const PLAYOFF_SPOTS = 8;

/** @param {number | null} gamesBack */
const formatGamesBack = (gamesBack) => (gamesBack ? gamesBack.toFixed(1) : "-");

/** @param {string} conference */
const renderConferenceTag = (conference) =>
  html`<span class="conference-tag ${conference.toLowerCase()}">${conference.charAt(0)}</span>`;

/**
 * @param {StandingsRow} row
 * @param {{ place: number, gamesBack: number | null, isLeague: boolean }} view
 */
function renderRow(row, { place, gamesBack, isLeague }) {
  const isCut = isLeague && place === PLAYOFF_SPOTS + 1;
  const isBelow = isLeague && place > PLAYOFF_SPOTS;
  const classes = [isCut && "cut", isBelow && "below"].filter(Boolean).join(" ");
  return html`<tr class="${classes}">
    <td class="place tabular">${place}</td>
    <td class="team">${renderClub(row.team)}${isLeague && renderConferenceTag(row.conference)}</td>
    <td class="tabular">${row.wins}-${row.losses}</td>
    <td class="tabular">${formatGamesBack(gamesBack)}</td>
    <td class="tabular wide-only">${row.lastTen ?? ""}</td>
    <td class="tabular wide-only">${row.streak ?? ""}</td>
  </tr>`;
}

/**
 * @param {string} title
 * @param {StandingsRow[]} rows
 * @param {boolean} isLeague
 */
function renderTable(title, rows, isLeague) {
  const body = rows.map((row) =>
    renderRow(row, {
      place: isLeague ? row.place : row.conferencePlace,
      gamesBack: isLeague ? row.gamesBack : row.conferenceGamesBack,
      isLeague,
    }),
  );
  return html`<section class="standings-block">
    <h2 class="section-label">${title}</h2>
    <table class="standings">
      <thead>
        <tr>
          <th></th>
          <th class="team">Team</th>
          <th>W-L</th>
          <th>GB</th>
          <th class="wide-only">L10</th>
          <th class="wide-only">Strk</th>
        </tr>
      </thead>
      <tbody>
        ${body}
      </tbody>
    </table>
  </section>`;
}

/**
 * The league's standings, with the playoff line after eighth, then each conference's.
 * @param {{ standings?: StandingsRow[] } | null} season
 */
export function renderStandings(season) {
  const rows = season?.standings ?? [];
  if (!rows.length) return html`<p class="empty-note">No standings yet.</p>`;
  const league = [...rows].sort((first, second) => first.place - second.place);
  const listConference = (conference) =>
    league
      .filter((row) => row.conference === conference)
      .sort((first, second) => first.conferencePlace - second.conferencePlace);
  return html`${renderTable("League", league, true)}
    <div class="conferences">
      ${renderTable("East", listConference("East"), false)}
      ${renderTable("West", listConference("West"), false)}
    </div>`;
}
