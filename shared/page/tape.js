import { html } from "./html.js";

/** @typedef {import("./html.js").Markup} Markup */

/**
 * One side of a measure: its number, an optional detail beside it, and how far its bar reaches,
 * from 0 to 100, or null for no bar.
 * @typedef {{ value: Markup | string, detail?: string, bar?: number | null }} TapeSide
 */

/**
 * One measure facing off across its name, as sheet.css lays it out. A side that's null is left
 * blank, and the leader's bar is drawn in the accent color.
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

/** @param {TapeRow} row */
export const renderTapeRow = ({ label, away, home, leader }) =>
  html`<div class="tape-row">
    ${renderTapeSide(away, "away", leader)}
    <span class="tape-label">${label}</span>
    ${renderTapeSide(home, "home", leader)}
  </div>`;
