import { html } from "#shared/html.js";
import { createPager } from "#shared/pager.js";
import { renderClub } from "./clubs.js";

/** @typedef {{ team: string, conference: string, wins: number, losses: number, place: number, conferencePlace: number, gamesBack: number | null, conferenceGamesBack: number | null, clinch: string | null, streak: string | null, lastTen: string | null, pointsFor?: number | null, pointsAgainst?: number | null, margin?: number | null, home?: string | null, road?: string | null }} StandingsRow */
/** @typedef {"League" | "East" | "West"} StandingsView */

/** @type {StandingsView[]} */
const STANDINGS_VIEWS = ["League", "East", "West"];

/** @param {StandingsView} view */
const nameViewKey = (view) => view.toLowerCase();

/** @type {ReturnType<typeof createPager> | null} */
let standingsPager = null;

// The top eight across the league make the playoffs, whatever their conference.
const PLAYOFF_SPOTS = 8;

const PLAYOFF_LINE = html`<tr class="playoff-line" aria-hidden="true"><td colspan="6"></td></tr>`;

/** @param {StandingsRow} row */
const isAboveLine = (row) => row.place <= PLAYOFF_SPOTS;

/** @param {number | null} gamesBack */
const formatGamesBack = (gamesBack) => (gamesBack ? gamesBack.toFixed(1) : "-");

/**
 * The league view tags each team's conference, and a conference view each playoff team's league seed.
 * @param {StandingsRow} row
 * @param {StandingsView} view
 */
function renderTeamTag(row, view) {
  if (view === "League") {
    return html`<span class="conference-tag ${row.conference.toLowerCase()}">${row.conference.charAt(0)}</span>`;
  }
  return isAboveLine(row) ? html`<span class="seed-note">${row.place} seed</span>` : "";
}

/** @param {string | null} streak */
const renderStreak = (streak) =>
  streak?.startsWith("W") ? html`<span class="streak-won">${streak}</span>` : (streak ?? "");

/**
 * @param {StandingsRow} row
 * @param {StandingsView} view
 */
function renderRow(row, view) {
  const isLeague = view === "League";
  return html`<tr class="${isAboveLine(row) ? "" : "below"}">
    <td class="place tabular">${isLeague ? row.place : row.conferencePlace}</td>
    <td class="team"><span class="team-cell">${renderClub(row.team)}${renderTeamTag(row, view)}</span></td>
    <td class="tabular season">${row.wins}-${row.losses}</td>
    <td class="tabular season pair-end">${formatGamesBack(isLeague ? row.gamesBack : row.conferenceGamesBack)}</td>
    <td class="tabular recent recent-start">${row.lastTen ?? ""}</td>
    <td class="tabular recent pair-end">${renderStreak(row.streak)}</td>
  </tr>`;
}

/**
 * The view's teams in its own order, with the playoff line above the first team below it.
 * @param {StandingsRow[]} rows
 * @param {StandingsView} view
 */
function renderBody(rows, view) {
  return rows.map((row, index) => {
    const isFirstBelow = index > 0 && isAboveLine(rows[index - 1]) && !isAboveLine(row);
    return html`${isFirstBelow && PLAYOFF_LINE}${renderRow(row, view)}`;
  });
}

/**
 * @param {StandingsRow[]} league
 * @param {StandingsView} view
 */
function listViewRows(league, view) {
  if (view === "League") return league;
  return league
    .filter((row) => row.conference === view)
    .sort((first, second) => first.conferencePlace - second.conferencePlace);
}

/**
 * One table, of the league or a conference, with the playoff line after the league's eighth.
 * @param {{ standings?: StandingsRow[] } | null} season
 * @param {StandingsView} [view]
 */
export function renderStandings(season, view = "League") {
  const rows = season?.standings ?? [];
  if (!rows.length) return html`<p class="empty-note">No standings yet.</p>`;
  const league = [...rows].sort((first, second) => first.place - second.place);
  return html`<table class="standings" aria-label="${view} standings">
      <thead>
        <tr class="groups">
          <th colspan="2"></th>
          <th colspan="2">Season</th>
          <th colspan="2" class="recent-start">Recent</th>
        </tr>
        <tr>
          <th></th>
          <th class="team">Team</th>
          <th>W-L</th>
          <th class="pair-end">GB</th>
          <th class="recent recent-start">L10</th>
          <th class="recent pair-end">Strk</th>
        </tr>
      </thead>
      <tbody>
        ${renderBody(listViewRows(league, view), view)}
      </tbody>
    </table>`;
}

/** Builds the pill over the league's and each conference's table, which a swipe moves between. */
export function startStandings() {
  standingsPager = createPager(
    /** @type {HTMLElement} */ (document.getElementById("standingsPager")),
    {
      label: "Standings",
      idPrefix: "standings",
      lists: STANDINGS_VIEWS.map((view) => ({ key: nameViewKey(view), name: view })),
      openOn: nameViewKey("League"),
    },
  );
}

/** @param {{ standings?: StandingsRow[] } | null} season */
export function drawStandings(season) {
  standingsPager.fill((key) =>
    renderStandings(
      season,
      STANDINGS_VIEWS.find((view) => nameViewKey(view) === key),
    ),
  );
}
