import { html, setHtml } from "#shared/html.js";
import { watchOpeningRound } from "#shared/opening-round.js";
import { markScrolledRound } from "#shared/round-dots.js";
import { listBracketLinks } from "./series.js";

/** @typedef {import("./series.js").Series} Series */
/** @typedef {import("./series.js").BracketRow} BracketRow */
/** @typedef {{ x: number, y: number }} Point */

// The bracket on the page: its lines, which need the cards' places, and where it scrolls to.

const findWrap = () => /** @type {HTMLElement} */ (document.getElementById("bracketWrap"));
const findTree = () => /** @type {HTMLElement | null} */ (findWrap().querySelector(".bracket"));
const isShown = (/** @type {HTMLElement} */ element) => element.getClientRects().length > 0;

/** @type {Series[]} */
let shownSeries = [];
/** @type {ReturnType<typeof watchOpeningRound> | null} */
let placeOpeningRound = null;
/** @type {ResizeObserver | null} */
let resizes = null;

/**
 * Where a row's middle, or the middle of both rows, meets a card's edge, in the tree's own
 * scrolling coordinates.
 * @param {HTMLElement} tree
 * @param {Element} card
 * @param {"left" | "right"} edge
 * @param {BracketRow} row
 * @returns {Point}
 */
function readPoint(tree, card, edge, row) {
  const treeBox = tree.getBoundingClientRect();
  const cardBox = card.getBoundingClientRect();
  const [top, bottom] = [...card.querySelectorAll(".team-line")].map((line) =>
    line.getBoundingClientRect(),
  );
  const [first, last] =
    row === "top" ? [top, top] : row === "bottom" ? [bottom, bottom] : [top, bottom];
  return {
    x: (edge === "right" ? cardBox.right : cardBox.left) - treeBox.left + tree.scrollLeft,
    y: (first.top + last.bottom) / 2 - treeBox.top,
  };
}

/** @param {Point} start @param {Point} end */
function buildCurve(start, end) {
  const pull = (end.x - start.x) * 0.55;
  return `M${start.x} ${start.y} C${start.x + pull} ${start.y} ${end.x - pull} ${end.y} ${end.x} ${end.y}`;
}

/** A bracket's square step, turning `turn` of the way across. @param {Point} start @param {Point} end @param {number} turn */
function buildStep(start, end, turn) {
  const x = start.x + (end.x - start.x) * turn;
  return `M${start.x} ${start.y} H${x} V${end.y} H${end.x}`;
}

/**
 * A decided series' line curves to the row its winner holds; one still going steps to where its
 * winner will go. When the seeds flip, the two steps into a card cross, so they turn at different
 * points to stay apart.
 * @param {HTMLElement} tree
 */
function drawLines(tree) {
  const svg = /** @type {SVGSVGElement} */ (tree.querySelector(".bracket-lines"));
  svg.setAttribute("width", String(tree.scrollWidth));
  svg.setAttribute("height", String(tree.scrollHeight));
  const findCard = (/** @type {string} */ id) =>
    /** @type {Element} */ (tree.querySelector(`[data-series="${id}"]`));
  const lines = listBracketLinks(shownSeries).map((link) => ({
    link,
    start: readPoint(tree, findCard(link.from), "right", link.fromRow),
    end: readPoint(tree, findCard(link.to), "left", link.toRow),
  }));
  const paths = lines.map(({ link, start, end }, index) => {
    const pair = lines.filter((line) => line.link.to === link.to);
    const isCrossing = pair.length === 2 && pair[0].end.y > pair[1].end.y + 1;
    const turn = isCrossing ? (pair[0] === lines[index] ? 0.38 : 0.62) : 0.5;
    return {
      isDecided: link.isDecided,
      markup: link.isDecided
        ? html`<path class="decided" d="${buildCurve(start, end)}"/>`
        : html`<path class="open" d="${buildStep(start, end, turn)}"/>`,
    };
  });
  // Decided lines draw last, so they cross over the rest.
  const ordered = paths.toSorted(
    (first, second) => Number(first.isDecided) - Number(second.isDecided),
  );
  setHtml(svg, html`${ordered.map((path) => path.markup)}`);
}

// A hidden tab has no layout to measure, so its lines wait until it shows.
function redrawLines() {
  const tree = findTree();
  if (tree && isShown(tree)) drawLines(tree);
}

function markVisibleRound() {
  const tree = findTree();
  if (!tree) return;
  const names = /** @type {HTMLElement[]} */ ([...tree.querySelectorAll(".round-name")]);
  const dots = /** @type {HTMLElement} */ (findWrap().querySelector(".round-dots"));
  markScrolledRound(tree, names, dots);
}

// The cards move when the screen resizes, the tab shows, or a font arrives and changes their rows.
export function startBracket() {
  const wrap = findWrap();
  placeOpeningRound = watchOpeningRound(wrap);
  resizes = new ResizeObserver(() => {
    redrawLines();
    markVisibleRound();
  });
  resizes.observe(wrap);
  wrap.addEventListener("scroll", markVisibleRound, { capture: true, passive: true });
  document.fonts.addEventListener("loadingdone", redrawLines);
}

/** Where the reader has scrolled the bracket, to keep across a redraw. */
export const readBracketScroll = () => findTree()?.scrollLeft ?? 0;

/**
 * After each draw: opens the bracket on its opening round or keeps the reader's place, and draws
 * its lines.
 * @param {Series[]} allSeries
 * @param {number} keptLeft
 */
export function placeBracket(allSeries, keptLeft) {
  shownSeries = allSeries;
  const tree = findTree();
  if (!tree) return;
  const round = Number(tree.dataset.openingRound);
  const target = /** @type {HTMLElement} */ (
    tree.querySelector(`.round-name[data-round="${round}"]`)
  );
  placeOpeningRound?.({ scroller: tree, target, round, keptLeft });
  resizes?.disconnect();
  resizes?.observe(findWrap());
  resizes?.observe(tree);
  redrawLines();
  markVisibleRound();
}
