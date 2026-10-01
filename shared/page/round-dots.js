import { html } from "./html.js";

// A sideways bracket's dots, one for each round, lit for the round scrolled to. On phones
// chrome.css pins them just above the tab bar.

/** @param {(string | number)[]} rounds each round's name, as its anchor's data-round holds it */
export const renderRoundDots = (rounds) =>
  html`<div class="round-dots" aria-hidden="true">
    ${rounds.map((round) => html`<span data-round="${round}"></span>`)}
  </div>`;

/** @param {HTMLElement} scroller */
const isScrolledToEnd = (scroller) =>
  scroller.scrollLeft >= scroller.scrollWidth - scroller.clientWidth - 1;

/**
 * The round whose anchor sits nearest the scroller's left edge, or the last round once the
 * scroller can go no further, since a last round narrower than the screen never reaches the edge.
 * @param {HTMLElement} scroller
 * @param {HTMLElement[]} anchors each round's first element, first round first
 */
function findScrolledRound(scroller, anchors) {
  if (isScrolledToEnd(scroller)) return anchors.at(-1)?.dataset.round;
  const padding = parseFloat(getComputedStyle(scroller).scrollPaddingLeft) || 0;
  const edge = scroller.getBoundingClientRect().left + padding;
  const distances = anchors.map((anchor) => Math.abs(anchor.getBoundingClientRect().left - edge));
  return anchors[distances.indexOf(Math.min(...distances))]?.dataset.round;
}

/**
 * Lights the dot of the round scrolled to.
 * @param {HTMLElement} scroller
 * @param {HTMLElement[]} anchors each round's first element, first round first
 * @param {HTMLElement} dots the element renderRoundDots drew
 */
export function markScrolledRound(scroller, anchors, dots) {
  const round = findScrolledRound(scroller, anchors);
  for (const dot of /** @type {NodeListOf<HTMLElement>} */ (dots.querySelectorAll("[data-round]")))
    dot.classList.toggle("on", dot.dataset.round === round);
}
