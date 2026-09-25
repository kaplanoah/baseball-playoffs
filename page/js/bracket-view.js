import { ROUND_LABEL, fullBracket, isEliminated, listSlotCandidates } from "./bracket.js";
import { rankedOrder, rankTag, seedMark, teamLabel, teamTag } from "./clubs.js";
import { html, setHtml } from "./html.js";
import { session } from "./session.js";

const rankOf = (id) => {
  const index = rankedOrder().indexOf(id);
  return index === -1 ? Infinity : index;
};

function listSideCandidates(series, side) {
  const team = side === "A" ? series.teamA : series.teamB;
  return team ? [team] : listSlotCandidates(session.state, series.id, side);
}

// A side is preferred only when every club that could fill it is ranked above every club on the other.
function findPreferredSide(series) {
  const ranksA = listSideCandidates(series, "A").map(rankOf);
  const ranksB = listSideCandidates(series, "B").map(rankOf);
  if (!ranksA.length || !ranksB.length) return null;
  if (Math.max(...ranksA) < Math.min(...ranksB)) return "A";
  if (Math.max(...ranksB) < Math.min(...ranksA)) return "B";
  return null;
}

function renderMatchupRow(series, side) {
  const id = side === "A" ? series.teamA : series.teamB;
  const wins = side === "A" ? series.winsA : series.winsB;
  if (!id) return html`<div class="matchup-row"><span class="tbd">TBD</span></div>`;
  const isWinner = series.winner === id;
  const isLoser = series.winner && series.winner !== id;
  const isPreferred = findPreferredSide(series) === side;
  const seed = session.state.teams[id] && session.state.teams[id].seed;
  return html`<div class="matchup-row ${isWinner ? "winner" : ""} ${isLoser ? "eliminated" : ""}">
    <div class="team-id">${rankTag(id, isPreferred)}${seedMark(seed)}${teamTag(id)}</div>
    <span class="nscore tabular ${isWinner ? "lead" : ""}">${wins}</span>
  </div>`;
}

/* Card metrics must match styles.css. Each wild card card sits dividerY - topSlotY
   above its division card, so its connector runs straight into the top slot. */
const LAYOUT = {
  columnWidth: 209,
  columnGap: 20,
  topSlotY: 41,
  dividerY: 57,
  stageHeight: 400, // room for a next-game note under the lowest cards
  wildCard1Y: 24,
  division1Y: 40,
  middleY: 160,
  division2Y: 280,
  wildCard2Y: 264,
};
const columnLeft = (index) => index * (LAYOUT.columnWidth + LAYOUT.columnGap);
const columnRight = (index) => columnLeft(index) + LAYOUT.columnWidth;
const alignToPixel = (value) => Math.round(value) + 0.5; // a 1px stroke centered on .5 fills one pixel row

function drawConnector(x1, y1, x2, y2) {
  const midX = (x1 + x2) / 2;
  return `M ${alignToPixel(x1)} ${alignToPixel(y1)} H ${alignToPixel(midX)} V ${alignToPixel(y2)} H ${alignToPixel(x2)}`;
}

// Until the time is set MLB's `at` is a placeholder, so the day comes from `date`:
// converting the placeholder to local time can land on the wrong day out west.
function readGameDay(next) {
  if (next.date) {
    const [year, month, day] = next.date.split("-").map(Number);
    return new Date(year, month - 1, day);
  }
  if (!next.at) return null;
  const at = new Date(next.at);
  if (Number.isNaN(at.getTime())) return null;
  return new Date(at.getFullYear(), at.getMonth(), at.getDate());
}

function describeNextGame(series) {
  const next = (session.state.series[series.id] || {}).next;
  if (series.winner || !next) return "";
  const day = readGameDay(next);
  if (!day) return "";
  const timeKnown = next.tbd === false && next.at;

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const days = Math.round((day.getTime() - today.getTime()) / 86400000);

  const time = timeKnown
    ? ", " + new Date(next.at).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })
    : "";
  if (days === 0) return `Next game today${time}`;
  if (days === 1) return `Next game tomorrow${time}`;

  // Drop the weekday once a time is shown, to keep the note on one line.
  const date = day.toLocaleDateString(
    undefined,
    timeKnown
      ? { month: "short", day: "numeric" }
      : { weekday: "short", month: "short", day: "numeric" },
  );
  return days < 0 ? `Next game ${date}${time}` : `Next game ${date}${time} \u2022 ${days} days`;
}

const readWinningPercentage = (team) =>
  team.w != null && team.l != null && team.w + team.l > 0 ? team.w / (team.w + team.l) : null;

// The higher seed hosts within a league; the World Series goes to the better record.
function findHomeSide(series) {
  if (!series.teamA || !series.teamB) return null;
  const teamA = session.state.teams[series.teamA];
  const teamB = session.state.teams[series.teamB];
  if (!teamA || !teamB) return null;

  if (series.round === "WS") {
    const percentageA = readWinningPercentage(teamA);
    const percentageB = readWinningPercentage(teamB);
    if (percentageA == null || percentageB == null) return null;
    return percentageA >= percentageB ? "A" : "B";
  }
  return teamA.seed <= teamB.seed ? "A" : "B";
}

// The host goes on the bottom, as in a line score. In the WC and DS, teamA is the higher seed.
function orderRows(series) {
  const home = findHomeSide(series);
  if (home) return home === "A" ? ["B", "A"] : ["A", "B"];
  return series.round === "WC" || series.round === "DS" ? ["B", "A"] : ["A", "B"];
}

function renderCardNote(series, champLine) {
  if (champLine) return html`<div class="card-note champ">${champLine}</div>`;
  const note = describeNextGame(series);
  return note ? html`<div class="card-note">${note}</div>` : html``;
}

function renderSeriesCard(series, top, column, champLine = "") {
  const [first, second] = orderRows(series);
  return html`<div class="box" style="left:${columnLeft(column)}px; top:${top}px; width:${LAYOUT.columnWidth}px;">
    <div class="series">
      <div class="bestof"><span>${ROUND_LABEL[series.round]}</span><span>BO${series.bestOf}</span></div>
      ${renderMatchupRow(series, first)}${renderMatchupRow(series, second)}
    </div>
    ${renderCardNote(series, champLine)}
  </div>`;
}

const COLUMN_LABELS = [
  ["AL Wild Card", "al"],
  ["AL Division", "al"],
  ["AL Championship", "al"],
  ["World Series", "champ"],
  ["NL Championship", "nl"],
  ["NL Division", "nl"],
  ["NL Wild Card", "nl"],
];

function renderColumnLabels() {
  return COLUMN_LABELS.map(
    ([text, className], index) =>
      html`<div class="lg-label ${className}" style="left:${columnLeft(index)}px; width:${LAYOUT.columnWidth}px;">${text}</div>`,
  );
}

function drawConnectors() {
  const wildCard1Out = LAYOUT.wildCard1Y + LAYOUT.dividerY;
  const wildCard2Out = LAYOUT.wildCard2Y + LAYOUT.dividerY;
  const division1Out = LAYOUT.division1Y + LAYOUT.dividerY;
  const division2Out = LAYOUT.division2Y + LAYOUT.dividerY;
  const middleOut = LAYOUT.middleY + LAYOUT.dividerY;
  const division1Slot = LAYOUT.division1Y + LAYOUT.topSlotY;
  const division2Slot = LAYOUT.division2Y + LAYOUT.topSlotY;

  return [
    drawConnector(columnRight(0), wildCard1Out, columnLeft(1), division1Slot),
    drawConnector(columnRight(0), wildCard2Out, columnLeft(1), division2Slot),
    drawConnector(columnRight(1), division1Out, columnLeft(2), middleOut),
    drawConnector(columnRight(1), division2Out, columnLeft(2), middleOut),
    drawConnector(columnRight(2), middleOut, columnLeft(3), middleOut),
    drawConnector(columnLeft(6), wildCard1Out, columnRight(5), division1Slot),
    drawConnector(columnLeft(6), wildCard2Out, columnRight(5), division2Slot),
    drawConnector(columnLeft(5), division1Out, columnRight(4), middleOut),
    drawConnector(columnLeft(5), division2Out, columnRight(4), middleOut),
    drawConnector(columnLeft(4), middleOut, columnRight(3), middleOut),
  ].map((path) => html`<path d="${path}"/>`);
}

const describeAdvance = (champion) => (champion ? `${teamLabel(champion)} advance` : "");

// wc[1] (4/5) feeds DS1 and wc[0] (3/6) feeds DS2, so each sits beside the card it feeds.
function renderSeriesCards(bracket) {
  const { al, nl, ws } = bracket;
  const worldSeriesLine = ws.winner ? `${teamLabel(ws.winner)} win the World Series` : "";
  return [
    renderSeriesCard(al.wc[1], LAYOUT.wildCard1Y, 0),
    renderSeriesCard(al.wc[0], LAYOUT.wildCard2Y, 0),
    renderSeriesCard(al.ds[0], LAYOUT.division1Y, 1),
    renderSeriesCard(al.ds[1], LAYOUT.division2Y, 1),
    renderSeriesCard(al.cs[0], LAYOUT.middleY, 2, describeAdvance(al.champion)),
    renderSeriesCard(ws, LAYOUT.middleY, 3, worldSeriesLine),
    renderSeriesCard(nl.cs[0], LAYOUT.middleY, 4, describeAdvance(nl.champion)),
    renderSeriesCard(nl.ds[0], LAYOUT.division1Y, 5),
    renderSeriesCard(nl.ds[1], LAYOUT.division2Y, 5),
    renderSeriesCard(nl.wc[1], LAYOUT.wildCard1Y, 6),
    renderSeriesCard(nl.wc[0], LAYOUT.wildCard2Y, 6),
  ];
}

export function renderBracket() {
  const wrap = document.getElementById("bracketWrap");
  const setupPrompt = document.getElementById("setupPrompt");
  const hasField = Object.keys(session.state.teams).length >= 12;
  setupPrompt.hidden = hasField;
  if (!hasField) {
    setHtml(wrap, html``);
    renderBanner(null);
    return;
  }

  const bracket = fullBracket(session.state);
  const width = columnRight(6);
  setHtml(
    wrap,
    html`
    <div class="tree-scroll"><div class="bracket-inner" style="width:${width}px;">
      <div class="lg-labels-row">${renderColumnLabels()}</div>
      <div class="bracket-stage" style="height:${LAYOUT.stageHeight}px;">
        <svg class="bracket-lines" width="${width}" height="${LAYOUT.stageHeight}" viewBox="0 0 ${width} ${LAYOUT.stageHeight}">${drawConnectors()}</svg>
        ${renderSeriesCards(bracket)}
      </div>
    </div></div>
  `,
  );
  renderBanner(bracket);
}

function renderBannerTeam(label, id) {
  return html`<span class="banner-label">${label}</span>
    <span class="banner-team">${rankTag(id)}${teamTag(id)}</span>`;
}

function renderBanner(bracket) {
  const banner = document.getElementById("banner");
  if (!bracket || !rankedOrder().length) {
    banner.hidden = true;
    return;
  }
  banner.hidden = false;

  const champion = bracket.ws && bracket.ws.winner;
  if (champion) {
    setHtml(banner, renderBannerTeam("World Series champions", champion));
    return;
  }
  const aliveRanked = rankedOrder().filter((id) => !isEliminated(session.state, id));
  setHtml(
    banner,
    aliveRanked.length
      ? renderBannerTeam("Highest still in", aliveRanked[0])
      : html`<span class="banner-label">All eliminated</span>`,
  );
}
