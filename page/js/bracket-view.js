import { ROUND_LABEL, fullBracket, isEliminated, listSlotCandidates } from "./bracket.js";
import { rankedOrder, rankTag, seedMark, teamLabel, teamTag } from "./clubs.js";
import { readGameDay } from "./dates.js";
import { html, joinWithSeparator, setHtml } from "./html.js";
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
  headerHeight: 34,
  minSlotHeight: 132,
  maxSlotHeight: 180,
};
const DIVISION_DROP = CARD.dividerY - CARD.topSlotY;
// Each wild card slot holds its card, the division card dropped beside it, and that card's note.
const SERIES_HEIGHT = DIVISION_DROP + CARD.height + STACKED.noteHeight;

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
  const note = `Next game ${date}${time}`;
  return days < 0 ? note : joinWithSeparator([note, `${days} days`]);
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

const describeAdvance = (champion) => (champion ? `${teamLabel(champion)} advance` : "");

const describeWorldSeriesWin = (ws) =>
  ws.winner ? `${teamLabel(ws.winner)} win the World Series` : "";

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

function renderLeagueHeader(league, top) {
  return html`<div class="league-head ${league}" style="top:${top}px; width:${findColumnRight(STACKED, 2)}px;">${LEAGUE_NAMES[league]}</div>`;
}

const isShown = (element) => element.getClientRects().length > 0;

let renderedSlotHeight = 0;

// The four wild card slots share the height from the bracket's top to the page's bottom padding,
// which clears the floating tab bar.
function measureSlotHeight(wrap) {
  if (!isShown(wrap)) return renderedSlotHeight || STACKED.minSlotHeight;
  const top = wrap.getBoundingClientRect().top + scrollY;
  const bottomPadding = parseFloat(getComputedStyle(document.body).paddingBottom);
  const slotHeight = Math.floor((innerHeight - top - bottomPadding - 2 * STACKED.headerHeight) / 4);
  return Math.min(STACKED.maxSlotHeight, Math.max(STACKED.minSlotHeight, slotHeight));
}

function placeLeague(top, slotHeight) {
  const firstY = top + STACKED.headerHeight + Math.floor((slotHeight - SERIES_HEIGHT) / 2);
  const wildCardY = [firstY, firstY + slotHeight];
  const divisionY = wildCardY.map((y) => y + DIVISION_DROP);
  const championshipY = Math.round((divisionY[0] + divisionY[1]) / 2);
  return { top, wildCardY, divisionY, championshipY };
}

function drawLeagueConnectors(place) {
  const left = (index) => findColumnLeft(STACKED, index);
  const right = (index) => findColumnRight(STACKED, index);
  const championshipIn = place.championshipY + CARD.dividerY;
  return [
    ...place.wildCardY.map((y, index) =>
      drawConnector(right(0), y + CARD.dividerY, left(1), place.divisionY[index] + CARD.topSlotY),
    ),
    ...place.divisionY.map((y) =>
      drawConnector(right(1), y + CARD.dividerY, left(2), championshipIn),
    ),
  ];
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
    renderSeriesCard(league.wc[1], place.wildCardY[0], left(0)),
    renderSeriesCard(league.wc[0], place.wildCardY[1], left(0)),
    renderSeriesCard(league.ds[0], place.divisionY[0], left(1)),
    renderSeriesCard(league.ds[1], place.divisionY[1], left(1)),
    renderSeriesCard(league.cs[0], place.championshipY, left(2), describeAdvance(league.champion)),
  ];
}

function renderStackedStage(bracket, slotHeight) {
  const leagueHeight = STACKED.headerHeight + 2 * slotHeight;
  const al = placeLeague(0, slotHeight);
  const nl = placeLeague(leagueHeight, slotHeight);
  const worldSeriesY = Math.round((al.championshipY + nl.championshipY) / 2);
  const width = findColumnLeft(STACKED, 3) + STACKED.worldSeriesWidth;
  const height = 2 * leagueHeight;
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
  const setupPrompt = document.getElementById("setupPrompt");
  const bracket = fullBracket(session.state);
  const hasField = !!bracket.al && !!bracket.nl;
  setupPrompt.hidden = hasField;
  if (!hasField) {
    setHtml(wrap, html``);
    renderedSlotHeight = 0;
    renderBanner(null);
    return;
  }

  const slotHeight = PHONE.matches ? measureSlotHeight(wrap) : 0;
  const stage = PHONE.matches ? renderStackedStage(bracket, slotHeight) : renderWideStage(bracket);
  const scrollLeft = wrap.querySelector(".tree-scroll")?.scrollLeft ?? 0;
  setHtml(wrap, html`<div class="tree-scroll">${stage}</div>`);
  wrap.querySelector(".tree-scroll").scrollLeft = scrollLeft;
  renderedSlotHeight = slotHeight;
  renderBanner(bracket);
}

/* Redraws when crossing into or out of phone width, and on a phone when the slots' share of the
   screen changes: the screen resizes, the bracket tab shows, or content above the bracket grows
   or shrinks. */
export function watchBracketSpace() {
  const wrap = document.getElementById("bracketWrap");
  const redrawIfResized = () => {
    if (!PHONE.matches || !renderedSlotHeight || !isShown(wrap)) return;
    if (measureSlotHeight(wrap) !== renderedSlotHeight) renderBracket();
  };
  PHONE.addEventListener("change", renderBracket);
  addEventListener("resize", redrawIfResized);
  new ResizeObserver(redrawIfResized).observe(document.body);
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
