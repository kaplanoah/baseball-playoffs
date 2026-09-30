// Baseball's parts of the settings panel: the tag by the title that names an earlier season, and
// the touches in the sheet that belong to the ranking and the season picker instead of the swipe.

import { startSettingsSheet } from "#shared/settings-sheet.js";
import { session } from "./session.js";

const isShowingPastSeason = () => session.activeYear !== session.currentSeason;

// Outside settings, only this tag says the page is showing an earlier season.
export function renderSeasonLabel() {
  const tag = /** @type {HTMLElement} */ (document.getElementById("yearTag"));
  tag.hidden = !isShowingPastSeason();
  tag.textContent = String(session.activeYear);
}

// The ranking's grips drag rows, and the season picker opens its own menu.
const isOwnGesture = (target) => target instanceof Element && !!target.closest(".grip, select");

export function startSettings() {
  startSettingsSheet({ isOwnGesture });
}
