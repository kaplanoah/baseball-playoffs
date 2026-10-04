import { convertToText, html } from "./html.js";
import { renderPlaceholder } from "./placeholder.js";

/** @typedef {import("./html.js").Markup} Markup */

/**
 * One side of a measure: its number, an optional detail beside it, and how far its bar reaches,
 * from 0 to 100, or null for no bar.
 * @typedef {{ value: Markup | string, detail?: string, bar?: number | null }} TapeSide
 */

/**
 * One measure facing off across its name, as sheet.css lays it out. A side that's null is left
 * blank, and the leader's bar is drawn in the accent color, unless the two numbers read the same.
 * @typedef {{ label: Markup | string, away: TapeSide | null, home: TapeSide | null, leader: "away" | "home" | null }} TapeRow
 */

/**
 * @param {TapeSide | null} side
 * @param {"away" | "home"} place
 * @param {"away" | "home" | null} leader
 */
function renderTapeSide(side, place, leader) {
  if (!side) return html`<div class="tape-side ${place}"></div>`;
  const detail = side.detail && html`<span class="tape-detail">${side.detail}</span>`;
  const bar =
    side.bar != null &&
    html`<span class="tape-bar"><i class="${leader === place ? "lead" : ""}" style="width: ${side.bar}%"></i></span>`;
  return html`<div class="tape-side ${place}">
    <span class="tape-value tabular">${side.value}${detail}</span>${bar}
  </div>`;
}

// Numbers are rounded to be shown, so two that differ unrounded can read the same, and marking
// either as ahead would look wrong.
/**
 * @param {TapeSide | null} away
 * @param {TapeSide | null} home
 */
const isShownTie = (away, home) =>
  !!away && !!home && convertToText(away.value) === convertToText(home.value);

/** @param {TapeRow} row */
export function renderTapeRow({ label, away, home, leader }) {
  const shownLeader = isShownTie(away, home) ? null : leader;
  return html`<div class="tape-row">
    ${renderTapeSide(away, "away", shownLeader)}
    <span class="tape-label">${label}</span>
    ${renderTapeSide(home, "home", shownLeader)}
  </div>`;
}

/**
 * A side whose number is still loading: a stand-in for it over an empty bar.
 * @type {TapeSide}
 */
export const PENDING_TAPE_SIDE = { value: renderPlaceholder("00.0"), bar: 0 };

/**
 * A measure whose numbers are both still loading.
 * @param {Markup | string} label
 */
export const renderPendingTapeRow = (label) =>
  renderTapeRow({ label, away: PENDING_TAPE_SIDE, home: PENDING_TAPE_SIDE, leader: null });
