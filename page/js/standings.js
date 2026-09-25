import { rankTag, teamTag } from "./clubs.js";
import { DAYS, countDaysBetween } from "./dates.js";
import { html, setHtml } from "./html.js";
import { session } from "./session.js";

const DIVISION_ORDER = ["AL East", "AL Central", "AL West", "NL East", "NL Central", "NL West"];
const DIVISION_ELIMINATION_TITLE =
  "Division elimination number: combined wins by the division leader and losses by this team that would end its division chances. A dash means clinched, E means out.";
const WILD_CARD_ELIMINATION_TITLE =
  "Wild card elimination number: combined wins by the team holding the last spot and losses by this team that would end its wild card chances. A dash means clinched, E means out.";

const EMPTY_NEXT_CELL = html`<td class="next-cell"></td>`;

function renderGamesBackCell(value) {
  if (value == null || value === "") return html`<td class="tabular"></td>`;
  return html`<td class="tabular">${value === "-" ? html`&mdash;` : value}</td>`;
}

function renderEliminationCell(value) {
  if (value === "E") return html`<td class="elim-num mid">E</td>`;
  if (value == null || value === "-") return html`<td class="elim-num clinched mid">&mdash;</td>`;
  return html`<td class="elim-num live tabular mid">${value}</td>`;
}

const hasStarted = (game, now) => game && game.at && !game.tbd && Date.parse(game.at) <= now;

// A game that has started isn't next, even before the standings refresh.
function findNextGame(row, now) {
  if (!hasStarted(row.next, now)) return row.next;
  return hasStarted(row.then, now) ? null : row.then;
}

export function renderNextCell(row, now = Date.now()) {
  const next = findNextGame(row, now);
  if (!next || !next.at) return EMPTY_NEXT_CELL;
  const start = new Date(next.at);
  if (Number.isNaN(start.getTime())) return EMPTY_NEXT_CELL;
  const day =
    countDaysBetween(start, new Date()) === 0 ? "Today" : DAYS[start.getDay()].slice(0, 3);
  const time = next.tbd
    ? ""
    : " " +
      start
        .toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
        .replace(/\s?[AP]M$/i, "");
  return html`<td class="next-cell">${day}${time} ${next.home ? "vs" : "@"} ${next.opp || ""}</td>`;
}

const renderNextColumn = (row, isOut) => (isOut ? EMPTY_NEXT_CELL : renderNextCell(row));

function renderStandingsRow(row, cells, { out = false, cut = false, columns = 0 } = {}) {
  const seed = session.state.teams[row.id] && session.state.teams[row.id].seed;
  const rowMarkup = html`<tr class="${out ? "eliminated" : "alive"} ${cut ? "cut" : ""}">
    <td class="rank-cell">${rankTag(row.id)}</td>
    <td class="seed-cell">${seed || ""}</td>
    <td class="team">${teamTag(row.id)}</td>
    ${cells}
  </tr>`;
  // One cell spanning the table, so the dashes run at a single even pitch.
  return cut
    ? html`${rowMarkup}<tr class="cutline"><td colspan="${columns}"></td></tr>`
    : rowMarkup;
}

function renderRecordCells(row) {
  return html`<td class="tabular mid">${row.w}</td><td class="tabular mid">${row.l}</td><td class="tabular mid">${row.pct}</td>`;
}

// Shared column classes, sized in styles.css, line the columns up across every table.
function renderColumns(hasNext) {
  return html`<colgroup><col class="c-rank"><col class="c-seed"><col class="c-team"><col class="c-w"><col class="c-l"><col class="c-pct"><col class="c-gb"><col class="c-e">${hasNext && html`<col>`}</colgroup>`;
}

function renderHeader(gamesBackLabel, eliminationLabel, eliminationTitle, hasNext) {
  return html`<thead><tr>
        <th></th><th>Seed</th><th class="left">Team</th><th class="mid">W</th><th class="mid">L</th><th class="mid pct">PCT</th><th>${gamesBackLabel}</th>
        <th class="mid" title="${eliminationTitle}">${eliminationLabel}</th>${hasNext && html`<th class="left next-cell">Next</th>`}
      </tr></thead>`;
}

const hasNextGame = (rows) => rows.some((row) => row.next && row.next.at);

function renderDivisionTag(leader) {
  if (leader.clinched) return html`<span class="clinch-tag">clinched</span>`;
  if (/^\d+$/.test(leader.magic || ""))
    return html`<span class="magic-tag">magic ${leader.magic}</span>`;
  return html``;
}

function renderRaceCells(row, gamesBack, eliminationNumber, isOut, hasNext) {
  return html`${renderRecordCells(row)}${renderGamesBackCell(gamesBack)}${renderEliminationCell(eliminationNumber)}${hasNext && renderNextColumn(row, isOut)}`;
}

export function renderDivisionBlock(name, rows) {
  const league = name.slice(0, 2);
  const hasNext = hasNextGame(rows);
  const renderRow = (row) => {
    const isOut = row.elim === "E";
    const cells = renderRaceCells(row, row.gb, row.elim, isOut, hasNext);
    return renderStandingsRow(row, cells, { out: isOut });
  };
  return html`<div class="div-block">
    <div class="div-title">
      <span class="${league}">${name}</span><span class="title-right">${renderDivisionTag(rows[0] || {})}</span>
    </div>
    <div class="st-scroll"><table class="st">
      ${renderColumns(hasNext)}
      ${renderHeader("GB", "E#", DIVISION_ELIMINATION_TITLE, hasNext)}
      <tbody>${rows.map(renderRow)}</tbody>
    </table></div>
  </div>`;
}

// Eliminated clubs go last: MLB's wildCardRank can rank one above a live
// club on a tiebreaker that no longer matters to the race.
function compareWildCardRows(first, second) {
  const firstOut = first.wce === "E" ? 1 : 0;
  const secondOut = second.wce === "E" ? 1 : 0;
  return firstOut - secondOut || Number(first.wcrank || 99) - Number(second.wcrank || 99);
}

function listWildCardPool(league, divisions) {
  return DIVISION_ORDER.filter((division) => division.startsWith(league))
    .flatMap((division) => (divisions[division] || []).filter((row) => !row.lead))
    .sort(compareWildCardRows)
    .slice(0, 7);
}

function renderWildCardBlock(league, pool) {
  const hasNext = hasNextGame(pool);
  const columns = 8 + (hasNext ? 1 : 0);
  const renderRow = (row, index) => {
    const isOut = row.wce === "E";
    const cells = renderRaceCells(row, row.wcgb, row.wce, isOut, hasNext);
    return renderStandingsRow(row, cells, { cut: index === 2, columns, out: isOut });
  };
  return html`<div class="div-block">
    <div class="div-title"><span class="${league}">${league} Wild Card</span></div>
    <div class="st-scroll"><table class="st">
      ${renderColumns(hasNext)}
      ${renderHeader("WCGB", "WCE", WILD_CARD_ELIMINATION_TITLE, hasNext)}
      <tbody>${pool.map(renderRow)}</tbody>
    </table></div>
  </div>`;
}

export function renderStandings() {
  const wrap = document.getElementById("standingsWrap");
  const divisions = session.standings && session.standings.divisions;
  if (!divisions || !Object.keys(divisions).length) {
    setHtml(
      wrap,
      html`<p class="stand-empty">No standings for this season yet. They
      appear here as soon as the page can reach MLB.</p>`,
    );
    return;
  }
  const blocks = DIVISION_ORDER.filter(
    (division) => divisions[division] && divisions[division].length,
  ).map((division) => renderDivisionBlock(division, divisions[division]));
  const races = ["AL", "NL"]
    .map((league) => [league, listWildCardPool(league, divisions)])
    .filter(([, pool]) => pool.length)
    .map(([league, pool]) => renderWildCardBlock(league, pool));
  setHtml(
    wrap,
    html`
    <div class="stand-head">Divisions</div>
    <div class="div-grid">${blocks}</div>
    ${races.length > 0 && html`<div class="stand-head second">Wild Card</div><div class="wc-grid">${races}</div>`}`,
  );
}
