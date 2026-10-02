import { html } from "#shared/html.js";
import { renderPlaceholder } from "#shared/placeholder.js";
import { renderClub } from "./clubs.js";

// The pieces the game sheet's views share: how its two teams are compared, which side leads a
// measure and how far each side's bar reaches.

/**
 * The side whose number is better, or null for a tie or a missing number.
 * @param {number | null} away
 * @param {number | null} home
 * @param {{ isLowerBetter?: boolean }} [options]
 * @returns {"away" | "home" | null}
 */
export function findLeader(away, home, { isLowerBetter = false } = {}) {
  if (away == null || home == null || away === home) return null;
  return away > home !== isLowerBetter ? "away" : "home";
}

/**
 * A bar's reach, from 0 to 100, as a share of the larger of the two numbers.
 * @param {number} value
 * @param {number} most
 */
export const measureAgainst = (value, most) => (most > 0 ? Math.round((value / most) * 100) : 0);

/**
 * A record like 15-7 as the share of its games won, or null without any.
 * @param {string | null} record
 */
export function readWinShare(record) {
  const [wins, losses] = String(record ?? "")
    .split("-")
    .map(Number);
  const games = wins + losses;
  return games > 0 ? wins / games : null;
}

/**
 * Which team is which above a tape, the away team left and the home team right.
 * @param {string} away
 * @param {string} home
 */
export const renderTapeTeams = (away, home) =>
  html`<div class="tape-teams">${renderClub(away)}${renderClub(home)}</div>`;

/** @param {string} text a line in place of a part's details */
export const renderSheetMessage = (text) => html`<p class="sheet-message">${text}</p>`;

/**
 * Stand-ins for a players table's rows while they load.
 * @param {number} count how many rows
 * @param {number} columns how many numbers each row has after the player's name
 */
export const renderPendingPlayerRows = (count, columns) =>
  Array.from(
    { length: count },
    () =>
      html`<tr>
        <th scope="row">${renderPlaceholder("Firstname Lastname")}</th>
        ${Array.from({ length: columns }, () => html`<td>${renderPlaceholder("00")}</td>`)}
      </tr>`,
  );
