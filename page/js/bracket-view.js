import { ROUND_LABEL, buildBracket, isEliminated, listSlotCandidates } from "./bracket.js";
import {
  listRankedOrder,
  renderRankTag,
  renderSeedMark,
  nameTeam,
  renderTeamTag,
} from "./clubs.js";
import { readGameDay } from "./dates.js";
import { html, setHtml } from "./html.js";
import { session } from "./session.js";

const findRank = (id) => {
  const index = listRankedOrder().indexOf(id);
  return index === -1 ? Infinity : index;
};

function listSideCandidates(series, side) {
  const team = side === "A" ? series.teamA : series.teamB;
  return team ? [team] : listSlotCandidates(session.state, series.id, side);
}

// A side is preferred only when every club that could fill it is ranked above every club on the other.
function findPreferredSide(series) {
  const ranksA = listSideCandidates(series, "A").map(findRank);
  const ranksB = listSideCandidates(series, "B").map(findRank);
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
    <div class="team-id">${renderRankTag(id, isPreferred)}${renderSeedMark(seed)}${renderTeamTag(id)}</div>
    <span class="nscore tabular ${isWinner ? "lead" : ""}">${wins}</span>
  </div>`;
}

// Card metrics must match styles.css.
const CARD = { width: 209, height: 90, topSlotY: 41, dividerY: 57 };

/* Desktop: AL on the left and NL on the right, meeting at the World Series in the middle. Each
   wild card card sits dividerY - topSlotY above its division card, so its connector runs straight
   into the top slot. */
const WIDE = {
  columnGap: 20,
  stageHeight: 400, // room for a next-game note under the lowest cards
  wildCard1Y: 24,
  division1Y: 40,
  middleY: 160,
  division2Y: 280,
  wildCard2Y: 264,
};

// Phones: AL above NL, rounds left to right, swiped sideways.
const STACKED = {
  columnGap: 32,
  worldSeriesWidth: 240,
  noteHeight: 20,
  headerHeight: 30,
  tabBarClearance: 12,
  minGap: 12,
  maxGap: 60,
};
// A row of level cards and their notes.
const SERIES_HEIGHT = CARD.height + STACKED.noteHeight;

const PHONE = matchMedia("(max-width: 779px)");

const findColumnLeft = (layout, index) => index * (CARD.width + layout.columnGap);
const findColumnRight = (layout, index) => findColumnLeft(layout, index) + CARD.width;
const alignToPixel = (value) => Math.round(value) + 0.5; // a 1px stroke centered on .5 fills one pixel row

function drawConnector(x1, y1, x2, y2) {
  const midX = (x1 + x2) / 2;
  return `M ${alignToPixel(x1)} ${alignToPixel(y1)} H ${alignToPixel(midX)} V ${alignToPixel(y2)} H ${alignToPixel(x2)}`;
}

function describeNextGame(series) {
  const next = (session.state.series[series.id] || {}).next;
  if (series.winner || !next) return "";
  const day = readGameDay(next);
  if (!day) return "";
  const weekday = day.toLocaleDateString(undefined, { weekday: "short" });
  const date = day.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  return `Next game ${weekday} ${date}`;
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

function renderSeriesCard(series, top, left, champLine = "", width = CARD.width) {
  const [first, second] = orderRows(series);
  return html`<div class="box" style="left:${left}px; top:${top}px; width:${width}px;">
    <div class="series ${series.round === "WS" ? "world" : ""}">
      <div class="bestof"><span>${ROUND_LABEL[series.round]}</span><span>BO${series.bestOf}</span></div>
      ${renderMatchupRow(series, first)}${renderMatchupRow(series, second)}
    </div>
    ${renderCardNote(series, champLine)}
  </div>`;
}

const describeAdvance = (champion) => (champion ? `${nameTeam(champion)} advance` : "");

const describeWorldSeriesWin = (ws) =>
  ws.winner ? `${nameTeam(ws.winner)} win the World Series` : "";

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
      html`<div class="lg-label ${className}" style="left:${findColumnLeft(WIDE, index)}px; width:${CARD.width}px;">${text}</div>`,
  );
}

function drawWideConnectors() {
  const left = (index) => findColumnLeft(WIDE, index);
  const right = (index) => findColumnRight(WIDE, index);
  const wildCard1Out = WIDE.wildCard1Y + CARD.dividerY;
  const wildCard2Out = WIDE.wildCard2Y + CARD.dividerY;
  const division1Out = WIDE.division1Y + CARD.dividerY;
  const division2Out = WIDE.division2Y + CARD.dividerY;
  const middleOut = WIDE.middleY + CARD.dividerY;
  const division1Slot = WIDE.division1Y + CARD.topSlotY;
  const division2Slot = WIDE.division2Y + CARD.topSlotY;

  return [
    drawConnector(right(0), wildCard1Out, left(1), division1Slot),
    drawConnector(right(0), wildCard2Out, left(1), division2Slot),
    drawConnector(right(1), division1Out, left(2), middleOut),
    drawConnector(right(1), division2Out, left(2), middleOut),
    drawConnector(right(2), middleOut, left(3), middleOut),
    drawConnector(left(6), wildCard1Out, right(5), division1Slot),
    drawConnector(left(6), wildCard2Out, right(5), division2Slot),
    drawConnector(left(5), division1Out, right(4), middleOut),
    drawConnector(left(5), division2Out, right(4), middleOut),
    drawConnector(left(4), middleOut, right(3), middleOut),
  ].map((path) => html`<path d="${path}"/>`);
}

// wc[1] (4/5) feeds DS1 and wc[0] (3/6) feeds DS2, so each sits beside the card it feeds.
function renderWideCards(bracket) {
  const { al, nl, ws } = bracket;
  const left = (index) => findColumnLeft(WIDE, index);
  return [
    renderSeriesCard(al.wc[1], WIDE.wildCard1Y, left(0)),
    renderSeriesCard(al.wc[0], WIDE.wildCard2Y, left(0)),
    renderSeriesCard(al.ds[0], WIDE.division1Y, left(1)),
    renderSeriesCard(al.ds[1], WIDE.division2Y, left(1)),
    renderSeriesCard(al.cs[0], WIDE.middleY, left(2), describeAdvance(al.champion)),
    renderSeriesCard(ws, WIDE.middleY, left(3), describeWorldSeriesWin(ws)),
    renderSeriesCard(nl.cs[0], WIDE.middleY, left(4), describeAdvance(nl.champion)),
    renderSeriesCard(nl.ds[0], WIDE.division1Y, left(5)),
    renderSeriesCard(nl.ds[1], WIDE.division2Y, left(5)),
    renderSeriesCard(nl.wc[1], WIDE.wildCard1Y, left(6)),
    renderSeriesCard(nl.wc[0], WIDE.wildCard2Y, left(6)),
  ];
}

function renderWideStage(bracket) {
  const width = findColumnRight(WIDE, 6);
  return html`<div class="bracket-inner" style="width:${width}px;">
    <div class="lg-labels-row">${renderColumnLabels()}</div>
    <div class="bracket-stage" style="height:${WIDE.stageHeight}px;">
      <svg class="bracket-lines" width="${width}" height="${WIDE.stageHeight}" viewBox="0 0 ${width} ${WIDE.stageHeight}">${drawWideConnectors()}</svg>
      ${renderWideCards(bracket)}
    </div>
  </div>`;
}

const LEAGUE_NAMES = { al: "American League", nl: "National League" };

// The name sticks to the left edge while its line scrolls past, and leaves with the line.
function renderLeagueHeader(league, top) {
  return html`<div class="league-head ${league}" style="top:${top}px; width:${findColumnRight(STACKED, 2)}px;"><span class="league-name">${LEAGUE_NAMES[league]}</span></div>`;
}

const isShown = (element) => element.getClientRects().length > 0;

let renderedGap = 0;

// The rows of cards spread out so the lowest notes end just above the floating tab bar. Its
// transform is left out, since the bar stretches while it moves.
function measureGap(wrap) {
  if (!isShown(wrap)) return renderedGap || STACKED.minGap;
  const top = wrap.getBoundingClientRect().top + scrollY;
  const tabBar = document.getElementById("tabBar");
  const tabBarTop = innerHeight - parseFloat(getComputedStyle(tabBar).bottom) - tabBar.offsetHeight;
  const bottom = tabBarTop - STACKED.tabBarClearance;
  const gap = Math.floor((bottom - top - 2 * STACKED.headerHeight - 4 * SERIES_HEIGHT) / 3);
  return Math.min(STACKED.maxGap, Math.max(STACKED.minGap, gap));
}

// Each wild card card sits level with the division card it feeds.
function placeLeague(top, gap) {
  const firstY = top + STACKED.headerHeight;
  const rowY = [firstY, firstY + SERIES_HEIGHT + gap];
  const championshipY = Math.round((rowY[0] + rowY[1]) / 2);
  return { top, rowY, championshipY };
}

function drawLeagueConnectors(place) {
  const left = (index) => findColumnLeft(STACKED, index);
  const right = (index) => findColumnRight(STACKED, index);
  const championshipIn = place.championshipY + CARD.dividerY;
  return place.rowY.flatMap((y) => [
    drawConnector(right(0), y + CARD.dividerY, left(1), y + CARD.topSlotY),
    drawConnector(right(1), y + CARD.dividerY, left(2), championshipIn),
  ]);
}

function drawStackedConnectors(places, worldSeriesY) {
  const worldSeriesIn = worldSeriesY + CARD.dividerY;
  return [
    ...places.flatMap(drawLeagueConnectors),
    ...places.map((place) =>
      drawConnector(
        findColumnRight(STACKED, 2),
        place.championshipY + CARD.dividerY,
        findColumnLeft(STACKED, 3),
        worldSeriesIn,
      ),
    ),
  ].map((path) => html`<path d="${path}"/>`);
}

function renderLeague(key, league, place) {
  const left = (index) => findColumnLeft(STACKED, index);
  return [
    renderLeagueHeader(key, place.top),
    renderSeriesCard(league.wc[1], place.rowY[0], left(0)),
    renderSeriesCard(league.wc[0], place.rowY[1], left(0)),
    renderSeriesCard(league.ds[0], place.rowY[0], left(1)),
    renderSeriesCard(league.ds[1], place.rowY[1], left(1)),
    renderSeriesCard(league.cs[0], place.championshipY, left(2), describeAdvance(league.champion)),
  ];
}

function renderStackedStage(bracket, gap) {
  const leagueHeight = STACKED.headerHeight + 2 * SERIES_HEIGHT + gap;
  const al = placeLeague(0, gap);
  const nl = placeLeague(leagueHeight + gap, gap);
  const worldSeriesY = Math.round((al.championshipY + nl.championshipY) / 2);
  const width = findColumnLeft(STACKED, 3) + STACKED.worldSeriesWidth;
  const height = 2 * leagueHeight + gap;
  return html`<div class="bracket-stage" style="width:${width}px; height:${height}px;">
    <svg class="bracket-lines" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${drawStackedConnectors([al, nl], worldSeriesY)}</svg>
    ${renderLeague("al", bracket.al, al)}
    ${renderSeriesCard(
      bracket.ws,
      worldSeriesY,
      findColumnLeft(STACKED, 3),
      describeWorldSeriesWin(bracket.ws),
      STACKED.worldSeriesWidth,
    )}
    ${renderLeague("nl", bracket.nl, nl)}
  </div>`;
}

export function renderBracket() {
  const wrap = document.getElementById("bracketWrap");
  const noFieldNote = document.getElementById("noFieldNote");
  const bracket = buildBracket(session.state);
  const hasField = !!bracket.al && !!bracket.nl;
  noFieldNote.hidden = hasField;
  if (!hasField) {
    setHtml(wrap, html``);
    renderedGap = 0;
    renderBanner(null);
    return;
  }

  const gap = PHONE.matches ? measureGap(wrap) : 0;
  const stage = PHONE.matches ? renderStackedStage(bracket, gap) : renderWideStage(bracket);
  const scrollLeft = wrap.querySelector(".tree-scroll")?.scrollLeft ?? 0;
  setHtml(
    wrap,
    html`<div class="tree-scroll" tabindex="0" role="region" aria-label="Bracket">${stage}</div>`,
  );
  wrap.querySelector(".tree-scroll").scrollLeft = scrollLeft;
  renderedGap = gap;
  renderBanner(bracket);
}

/* Redraws when crossing into or out of phone width, and on a phone when the gaps' share of the
   screen changes: the screen resizes, the bracket tab shows, or content above the bracket grows
   or shrinks. */
export function watchBracketSpace() {
  const wrap = document.getElementById("bracketWrap");
  const redrawIfResized = () => {
    if (!PHONE.matches || !renderedGap || !isShown(wrap)) return;
    if (measureGap(wrap) !== renderedGap) renderBracket();
  };
  PHONE.addEventListener("change", renderBracket);
  addEventListener("resize", redrawIfResized);
  new ResizeObserver(redrawIfResized).observe(document.body);
}

function renderBannerTeam(label, id) {
  return html`<span class="banner-label">${label}</span>
    <span class="banner-team">${renderRankTag(id)}${renderTeamTag(id)}</span>`;
}

function renderBanner(bracket) {
  const banner = document.getElementById("banner");
  if (!bracket || !listRankedOrder().length) {
    banner.hidden = true;
    return;
  }
  banner.hidden = false;

  const champion = bracket.ws && bracket.ws.winner;
  if (champion) {
    setHtml(banner, renderBannerTeam("World Series champions", champion));
    return;
  }
  const aliveRanked = listRankedOrder().filter((id) => !isEliminated(session.state, id));
  setHtml(
    banner,
    aliveRanked.length
      ? renderBannerTeam("Highest still in", aliveRanked[0])
      : html`<span class="banner-label">All eliminated</span>`,
  );
}
