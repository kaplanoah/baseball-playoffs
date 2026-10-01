import { html, joinWithSeparator } from "#shared/html.js";
import { renderPlaceholder } from "#shared/placeholder.js";
import { renderPendingTapeRow, renderTapeRow } from "#shared/tape.js";
import { renderClub } from "./clubs.js";
import {
  findLeader,
  measureAgainst,
  renderPendingPlayerRows,
  renderSheetPart,
  renderTapeTeams,
} from "./sheet-parts.js";
import { nameTeam } from "./series.js";

// The game sheet's box score for a game that has started: points by quarter, the teams' stats
// side by side, and each team's top scorers. Until it loads, each part holds its shape with
// placeholders.

/** @typedef {{ id: number, firstName: string, lastName: string, minutes: number, points: number, rebounds: number, assists: number, fouls: number }} BoxPlayer */
/** @typedef {{ fieldGoals: number[], threePointers: number[], freeThrows: number[], rebounds: number, assists: number, turnovers: number, paintPoints: number, benchPoints: number, biggestLead: number }} TeamStats */
/** @typedef {{ team: string, score: number, periods: number[], timeouts: number | null, stats: TeamStats, players: BoxPlayer[] }} BoxTeam */
/** @typedef {{ id: string, state: string, period: number | null, leadChanges: number | null, timesTied: number | null, away: BoxTeam, home: BoxTeam }} BoxScore */

/** @type {("away" | "home")[]} */
const SIDES = ["away", "home"];
const REGULATION_PERIODS = 4;
const TOP_PERFORMERS = 3;
// A player fouls out on her sixth, so a fourth while the game is on puts her in trouble.
const FOUL_TROUBLE = 4;
const FOUL_OUT = 6;

const SHOOTING = [
  { key: "fieldGoals", label: "Field goals" },
  { key: "threePointers", label: "3-pointers" },
  { key: "freeThrows", label: "Free throws" },
];
const COUNTS = [
  { key: "rebounds", label: "Rebounds" },
  { key: "assists", label: "Assists" },
  { key: "turnovers", label: "Turnovers", isLowerBetter: true },
  { key: "paintPoints", label: "Points in the paint" },
  { key: "benchPoints", label: "Bench points" },
];

/** @param {number} index */
function namePeriod(index) {
  if (index < REGULATION_PERIODS) return String(index + 1);
  const overtime = index - REGULATION_PERIODS + 1;
  return overtime === 1 ? "OT" : `${overtime}OT`;
}

/** @param {BoxScore} box */
function findLoser(box) {
  if (box.state !== "final") return null;
  return box.away.score < box.home.score ? "away" : "home";
}

// While the game is on, the quarter under way is marked, and the ones still to come are blank.
/** @param {BoxScore} box */
function renderLineScore(box) {
  const isLive = box.state === "live";
  const count = Math.max(REGULATION_PERIODS, box.away.periods.length, box.home.periods.length);
  const indexes = [...Array(count).keys()];
  const isNow = (index) => isLive && index === box.period - 1;
  const isAhead = (index) => isLive && index >= box.period;
  const loser = findLoser(box);
  const renderRow = (place) => {
    const side = box[place];
    const cells = indexes.map((index) =>
      isAhead(index) || side.periods[index] == null
        ? html`<td class="ahead">-</td>`
        : html`<td class="${isNow(index) ? "now" : ""}">${side.periods[index]}</td>`,
    );
    return html`<tr>
      <th scope="row">${renderClub(side.team)}</th>
      ${cells}
      <td class="total${loser === place ? " lost" : ""}">${side.score}</td>
    </tr>`;
  };
  const heads = indexes.map(
    (index) => html`<th class="${isNow(index) ? "now" : ""}">${namePeriod(index)}</th>`,
  );
  return renderLineScoreTable(heads, SIDES.map(renderRow));
}

/**
 * @param {import("#shared/html.js").Markup[]} heads each period's heading
 * @param {import("#shared/html.js").Markup[]} rows
 */
const renderLineScoreTable = (heads, rows) =>
  html`<table class="line-score tabular">
    <thead>
      <tr>
        <td></td>
        ${heads}
        <th>T</th>
      </tr>
    </thead>
    <tbody>
      ${rows}
    </tbody>
  </table>`;

/** @param {Record<"away" | "home", string>} teams */
function renderPendingLineScore(teams) {
  const indexes = [...Array(REGULATION_PERIODS).keys()];
  const renderRow = (place) =>
    html`<tr>
      <th scope="row">${renderClub(teams[place])}</th>
      ${indexes.map(() => html`<td>${renderPlaceholder("00")}</td>`)}
      <td class="total">${renderPlaceholder("00")}</td>
    </tr>`;
  return renderLineScoreTable(
    indexes.map((index) => html`<th>${namePeriod(index)}</th>`),
    SIDES.map(renderRow),
  );
}

/**
 * A shooting row: each side's share of its shots made, beside how many it made of how many.
 * @param {BoxScore} box
 * @param {{ key: string, label: string }} measure
 */
function describeShooting(box, { key, label }) {
  const shots = SIDES.map((place) => box[place].stats[key]);
  const shares = shots.map(([made, attempted]) => (attempted ? made / attempted : null));
  const describeSide = (index) => {
    const [made, attempted] = shots[index];
    const share = shares[index];
    return {
      value: share == null ? "-" : `${(share * 100).toFixed(1)}%`,
      detail: `${made}-${attempted}`,
      bar: share == null ? null : Math.round(share * 100),
    };
  };
  return {
    label,
    away: describeSide(0),
    home: describeSide(1),
    leader: findLeader(shares[0], shares[1]),
  };
}

/**
 * @param {BoxScore} box
 * @param {{ key: string, label: string, isLowerBetter?: boolean }} measure
 */
function describeCount(box, { key, label, isLowerBetter }) {
  const [away, home] = SIDES.map((place) => box[place].stats[key]);
  const most = Math.max(away, home);
  return {
    label,
    away: { value: String(away), bar: measureAgainst(away, most) },
    home: { value: String(home), bar: measureAgainst(home, most) },
    leader: findLeader(away, home, { isLowerBetter }),
  };
}

/** @param {BoxScore} box */
function describeGameFlow(box) {
  const leads = SIDES.filter((place) => box[place].stats.biggestLead > 0).map(
    (place) => `${nameTeam(box[place].team)} ${box[place].stats.biggestLead}`,
  );
  const timeouts = SIDES.map((place) => `${nameTeam(box[place].team)} ${box[place].timeouts}`);
  return [
    leads.length > 0 && `Biggest lead: ${leads.join(", ")}`,
    box.leadChanges != null && `Lead changes: ${box.leadChanges}`,
    box.timesTied != null && `Ties: ${box.timesTied}`,
    box.state === "live" && `Timeouts left: ${timeouts.join(", ")}`,
  ].filter(Boolean);
}

/** @param {BoxScore} box */
function renderTeamStats(box) {
  const rows = [
    ...SHOOTING.map((measure) => describeShooting(box, measure)),
    ...COUNTS.map((measure) => describeCount(box, measure)),
  ];
  return html`${renderTapeTeams(box.away.team, box.home.team)}
    <div class="tape">
      ${rows.map(renderTapeRow)}
      <p class="tape-note">${joinWithSeparator(describeGameFlow(box))}</p>
    </div>`;
}

/** @param {Record<"away" | "home", string>} teams */
const renderPendingTeamStats = (teams) =>
  html`${renderTapeTeams(teams.away, teams.home)}
    <div class="tape">
      ${[...SHOOTING, ...COUNTS].map((measure) => renderPendingTapeRow(measure.label))}
      <p class="tape-note">${renderPlaceholder("Biggest lead: Aces 12, Lead changes: 4")}</p>
    </div>`;

/**
 * @param {BoxPlayer} player
 * @param {boolean} isLive
 */
function renderFouls({ fouls }, isLive) {
  if (fouls >= FOUL_OUT) return html`<span class="foul-chip">Fouled out</span>`;
  if (isLive && fouls >= FOUL_TROUBLE) return html`<span class="foul-chip">${fouls} fouls</span>`;
  return false;
}

/** @param {BoxPlayer[]} players */
const pickTopScorers = (players) =>
  [...players]
    .sort((first, second) => second.points - first.points || second.minutes - first.minutes)
    .slice(0, TOP_PERFORMERS);

/**
 * @param {BoxTeam} side
 * @param {boolean} isLive
 */
function renderTopScorers(side, isLive) {
  const rows = pickTopScorers(side.players).map(
    (player) => html`<tr>
      <th scope="row">
        <span class="first-name">${player.firstName}</span> ${player.lastName}${renderFouls(player, isLive)}
      </th>
      <td class="minutes">${player.minutes}</td>
      <td>${player.points}</td>
      <td>${player.rebounds}</td>
      <td>${player.assists}</td>
    </tr>`,
  );
  return renderScorersTable(side.team, rows);
}

/**
 * @param {string} team
 * @param {import("#shared/html.js").Markup[]} rows
 */
const renderScorersTable = (team, rows) =>
  html`<table class="players tabular">
    <thead>
      <tr>
        <th scope="col">${renderClub(team)}</th>
        <th scope="col" title="Minutes">Min</th>
        <th scope="col" title="Points">Pts</th>
        <th scope="col" title="Rebounds">Reb</th>
        <th scope="col" title="Assists">Ast</th>
      </tr>
    </thead>
    <tbody>
      ${rows}
    </tbody>
  </table>`;

/** @param {import("#shared/html.js").Markup[]} tables */
const renderPlayerTables = (tables) => html`<div class="player-tables">${tables}</div>`;

/** @param {BoxScore} box */
export function renderBoxScore(box) {
  const isLive = box.state === "live";
  return html`${renderSheetPart("By quarter", renderLineScore(box))}
    ${renderSheetPart("Team stats", renderTeamStats(box), isLive && "So far")}
    ${renderSheetPart(
      "Top scorers",
      renderPlayerTables(SIDES.map((place) => renderTopScorers(box[place], isLive))),
    )}`;
}

/**
 * The box score's parts, in their shape, while it loads.
 * @param {Record<"away" | "home", string>} teams
 */
export const renderPendingBoxScore = (teams) =>
  html`${renderSheetPart("By quarter", renderPendingLineScore(teams))}
    ${renderSheetPart("Team stats", renderPendingTeamStats(teams))}
    ${renderSheetPart(
      "Top scorers",
      renderPlayerTables(
        SIDES.map((place) =>
          renderScorersTable(teams[place], renderPendingPlayerRows(TOP_PERFORMERS, 4)),
        ),
      ),
    )}`;
