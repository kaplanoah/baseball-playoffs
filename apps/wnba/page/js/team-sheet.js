// The sheet a team opens from the standings or the bracket: its conference, seed, and record, its
// season, and how far it got. Phones show it as a sheet from the bottom, wider screens as a modal,
// like a game's sheet.

import { setHtml } from "#shared/html.js";
import { redrawSheet } from "#shared/sheet-resize.js";
import { openSheet, wireSheet } from "#shared/sheet.js";
import { session } from "./session.js";
import { renderTeamSheet } from "./team-view.js";
import { TEAMS } from "./teams.js";

/** @type {string | null} */
let shownTeam = null;

const findDialog = () => /** @type {HTMLDialogElement} */ (document.getElementById("teamDialog"));
const findElement = (id) => /** @type {HTMLElement} */ (document.getElementById(id));

function renderSheet() {
  if (!shownTeam) return;
  const { heading, note, body } = renderTeamSheet(session.season, shownTeam, {
    year: session.year,
    now: Date.now(),
  });
  redrawSheet(findDialog(), () => {
    setHtml(findElement("teamTitle"), heading);
    setHtml(findElement("teamNote"), note);
    setHtml(findElement("teamBody"), body);
  });
}

/** @param {string} code */
function openTeamSheet(code) {
  if (!TEAMS[code]) return;
  shownTeam = code;
  renderSheet();
  openSheet(findDialog());
}

/** Redraws the open sheet from the season as the store has it now. */
export const refreshTeamSheet = () => renderSheet();

/** @param {Event} event */
function openFromTap(event) {
  const team = /** @type {HTMLElement | null} */ (
    /** @type {Element} */ (event.target).closest("[data-team]")
  );
  if (team?.dataset.team) openTeamSheet(team.dataset.team);
}

export function startTeamSheet() {
  const dialog = findDialog();
  wireSheet(dialog, { doneButton: findElement("teamDoneBtn") });
  dialog.addEventListener("close", () => {
    shownTeam = null;
  });
  findElement("view-standings").addEventListener("click", openFromTap);
  findElement("bracketWrap").addEventListener("click", openFromTap);
}
