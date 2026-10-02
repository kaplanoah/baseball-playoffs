import { html, setHtml } from "#shared/html.js";
import { watchOpeningRound } from "#shared/opening-round.js";
import { markScrolledRound } from "#shared/round-dots.js";
import { BRACKET_FEEDERS } from "./series.js";

/** @typedef {{ x: number, y: number }} Point */

// The bracket on the page: its lines, which need the cards' places, and where it scrolls to.

const findWrap = () => /** @type {HTMLElement} */ (document.getElementById("bracketWrap"));
const findTree = () => /** @type {HTMLElement | null} */ (findWrap().querySelector(".bracket"));
const isShown = (/** @type {HTMLElement} */ element) => element.getClientRects().length > 0;

// As on MLB's bracket, the cards spread at most this many times their tightest gap.
const MAX_GAP_GROWTH = 3;
const GAPS_BETWEEN_CARDS = 3;
const ROUND_DOTS_CLEARANCE = 12;

/** @type {ReturnType<typeof watchOpeningRound> | null} */
let placeOpeningRound = null;
/** @type {ResizeObserver | null} */
let resizes = null;

/**
 * Where the line between a card's two teams meets its edge, in the tree's own scrolling
 * coordinates.
 * @param {HTMLElement} tree
 * @param {Element} card
 * @param {"left" | "right"} edge
 * @returns {Point}
 */
function readPoint(tree, card, edge) {
  const treeBox = tree.getBoundingClientRect();
  const cardBox = card.getBoundingClientRect();
  const bottomLine = /** @type {HTMLElement} */ (card.querySelectorAll(".team-line")[1]);
  return {
    x: (edge === "right" ? cardBox.right : cardBox.left) - treeBox.left + tree.scrollLeft,
    y: bottomLine.getBoundingClientRect().top + bottomLine.clientTop / 2 - treeBox.top,
  };
}

/**
 * A bracket joining two series to the one they feed, turning halfway between the rounds.
 * @param {Point} upper
 * @param {Point} lower
 * @param {Point} next
 */
function buildBracket(upper, lower, next) {
  const turn = (upper.x + next.x) / 2;
  return `M${upper.x} ${upper.y} H${turn} V${lower.y} H${lower.x} M${turn} ${next.y} H${next.x}`;
}

/** @param {HTMLElement} tree */
function drawLines(tree) {
  const svg = /** @type {SVGSVGElement} */ (tree.querySelector(".bracket-lines"));
  svg.setAttribute("width", String(tree.scrollWidth));
  svg.setAttribute("height", String(tree.scrollHeight));
  const findCard = (/** @type {string} */ id) =>
    /** @type {Element} */ (tree.querySelector(`[data-series="${id}"]`));
  const paths = Object.entries(BRACKET_FEEDERS).map(([next, [upper, lower]]) => {
    const shape = buildBracket(
      readPoint(tree, findCard(upper), "right"),
      readPoint(tree, findCard(lower), "right"),
      readPoint(tree, findCard(next), "left"),
    );
    return html`<path data-next="${next}" d="${shape}"/>`;
  });
  setHtml(svg, html`${paths}`);
}

/**
 * While the round dots are pinned above a phone's tab bar, the gaps between the cards grow alike
 * so the bracket reaches down to them.
 * @param {HTMLElement} tree
 */
function sizeCardGaps(tree) {
  const dots = /** @type {HTMLElement} */ (findWrap().querySelector(".round-dots"));
  if (!isShown(dots) || getComputedStyle(dots).position !== "fixed") {
    tree.style.removeProperty("--card-gap");
    return;
  }
  const style = getComputedStyle(tree);
  const tightestGap = parseFloat(style.getPropertyValue("--tightest-card-gap"));
  const gap = parseFloat(style.getPropertyValue("--card-gap"));
  const tightestHeight = tree.offsetHeight - GAPS_BETWEEN_CARDS * (gap - tightestGap);
  const top = tree.getBoundingClientRect().top + scrollY;
  const room = dots.getBoundingClientRect().top - ROUND_DOTS_CLEARANCE - top;
  const fittingGap = tightestGap + (room - tightestHeight) / GAPS_BETWEEN_CARDS;
  const grownGap = Math.min(tightestGap * MAX_GAP_GROWTH, Math.max(tightestGap, fittingGap));
  tree.style.setProperty("--card-gap", `${Math.floor(grownGap)}px`);
}

// A hidden tab has no layout to measure, so its spacing and lines wait until it shows.
function layOutBracket() {
  const tree = findTree();
  if (!tree || !isShown(tree)) return;
  sizeCardGaps(tree);
  drawLines(tree);
}

function markVisibleRound() {
  const tree = findTree();
  if (!tree) return;
  const names = /** @type {HTMLElement[]} */ ([...tree.querySelectorAll(".round-name")]);
  const dots = /** @type {HTMLElement} */ (findWrap().querySelector(".round-dots"));
  markScrolledRound(tree, names, dots);
}

// The cards move when the screen resizes, the tab shows, the header above them changes, or a font
// arrives and changes their rows.
export function startBracket() {
  const wrap = findWrap();
  placeOpeningRound = watchOpeningRound(wrap);
  resizes = new ResizeObserver(() => {
    layOutBracket();
    markVisibleRound();
  });
  resizes.observe(wrap);
  resizes.observe(document.body);
  addEventListener("resize", layOutBracket);
  wrap.addEventListener("scroll", markVisibleRound, { capture: true, passive: true });
  document.fonts.addEventListener("loadingdone", layOutBracket);
}

/** Where the reader has scrolled the bracket, to keep across a redraw. */
export const readBracketScroll = () => findTree()?.scrollLeft ?? 0;

/**
 * After each draw: opens the bracket on its opening round or keeps the reader's place, spaces
 * its cards, and draws its lines.
 * @param {number} keptLeft
 */
export function placeBracket(keptLeft) {
  const tree = findTree();
  if (!tree) return;
  const round = Number(tree.dataset.openingRound);
  const target = /** @type {HTMLElement} */ (
    tree.querySelector(`.round-name[data-round="${round}"]`)
  );
  placeOpeningRound?.({ scroller: tree, target, round, keptLeft });
  resizes?.disconnect();
  resizes?.observe(findWrap());
  resizes?.observe(document.body);
  resizes?.observe(tree);
  layOutBracket();
  markVisibleRound();
}
