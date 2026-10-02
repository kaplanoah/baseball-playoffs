// The sheet a team's name or dot opens wherever it shows. Phones show it as a sheet from the
// bottom, wider screens as a modal, like a game's sheet, over a sheet it opens from, and in place
// of another team's. Each league hands it which teams it knows and what a team's sheet shows, and
// builds the buttons that open it with renderTeamSheetButton.

import { html, setHtml } from "./html.js";
import { redrawSheet } from "./sheet-resize.js";
import { openSheet, wireSheet } from "./sheet.js";

/** @typedef {import("./html.js").Markup} Markup */
/** @typedef {{ heading: Markup, note: Markup | string, body: Markup }} TeamSheet */
/** @typedef {{ isTeam: (team: string) => boolean, renderSheet: (team: string) => TeamSheet }} League */

/** @type {League | null} */
let league = null;
/** @type {string | null} */
let shownTeam = null;

const findDialog = () => /** @type {HTMLDialogElement} */ (document.getElementById("teamDialog"));
const findElement = (id) => /** @type {HTMLElement} */ (document.getElementById(id));

function renderSheet() {
  if (!league || !shownTeam) return;
  const { heading, note, body } = league.renderSheet(shownTeam);
  redrawSheet(findDialog(), () => {
    setHtml(findElement("teamTitle"), heading);
    setHtml(findElement("teamNote"), note);
    setHtml(findElement("teamBody"), body);
  });
}

/** @param {string} team */
function openTeamSheet(team) {
  if (!league?.isTeam(team)) return;
  shownTeam = team;
  renderSheet();
  openSheet(findDialog());
}

/** Redraws the open sheet from what the page shows now. */
export const refreshTeamSheet = () => renderSheet();

/** @param {Event} event */
function openFromTap(event) {
  const button = /** @type {HTMLElement | null} */ (
    /** @type {Element} */ (event.target).closest("[data-team]")
  );
  if (button?.dataset.team) openTeamSheet(button.dataset.team);
}

/** @param {League} teams */
export function startTeamSheet(teams) {
  league = teams;
  const dialog = findDialog();
  wireSheet(dialog, { doneButton: findElement("teamDoneBtn") });
  dialog.addEventListener("close", () => {
    shownTeam = null;
  });
  document.addEventListener("click", openFromTap);
}

/**
 * A button around what shows a team, that opens its sheet.
 * @param {{ team: string, name: string, content: Markup | string, className?: string }} button
 *   `name` is the team's full name, for the button's label
 */
export const renderTeamSheetButton = ({ team, name, content, className = "" }) =>
  html`<button type="button" class="${className ? `${className} ` : ""}team-open" data-team="${team}" aria-label="Team details: ${name}">${content}</button>`;

/**
 * A grid of a team's numbers, each under its label, leaving out those it has none for, or nothing
 * when it has none at all.
 * @param {[string, string | number | null | undefined][]} stats
 */
export function renderTeamStats(stats) {
  const shown = stats.filter(([, value]) => value != null);
  if (!shown.length) return false;
  return html`<div class="team-stats">
    ${shown.map(
      ([label, value]) =>
        html`<div class="team-stat">
          <span class="team-label">${label}</span><b class="tabular">${value}</b>
        </div>`,
    )}
  </div>`;
}

/**
 * A line of a team's facts after their label.
 * @param {string} label
 * @param {Markup | string} content
 */
export const renderTeamDetail = (label, content) =>
  html`<p class="team-detail"><span class="team-label">${label}</span>${content}</p>`;
