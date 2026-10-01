import { html, setHtml } from "#shared/html.js";
import { watchOpeningRound } from "#shared/opening-round.js";
import { markScrolledRound } from "#shared/round-dots.js";
import { BRACKET_FEEDERS } from "./series.js";

/** @typedef {{ x: number, y: number }} Point */

// The bracket on the page: its lines, which need the cards' places, and where it scrolls to.

const findWrap = () => /** @type {HTMLElement} */ (document.getElementById("bracketWrap"));
const findTree = () => /** @type {HTMLElement | null} */ (findWrap().querySelector(".bracket"));
const isShown = (/** @type {HTMLElement} */ element) => element.getClientRects().length > 0;

/** @type {ReturnType<typeof watchOpeningRound> | null} */
let placeOpeningRound = null;
/** @type {ResizeObserver | null} */
let resizes = null;

/**
 * Where the middle of a card's two rows meets its edge, in the tree's own scrolling coordinates.
 * @param {HTMLElement} tree
 * @param {Element} card
 * @param {"left" | "right"} edge
 * @returns {Point}
 */
function readPoint(tree, card, edge) {
  const treeBox = tree.getBoundingClientRect();
  const cardBox = card.getBoundingClientRect();
  const [top, bottom] = [...card.querySelectorAll(".team-line")].map((line) =>
    line.getBoundingClientRect(),
  );
  return {
    x: (edge === "right" ? cardBox.right : cardBox.left) - treeBox.left + tree.scrollLeft,
    y: (top.top + bottom.bottom) / 2 - treeBox.top,
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
  resizes?.observe(tree);
  redrawLines();
  markVisibleRound();
}
