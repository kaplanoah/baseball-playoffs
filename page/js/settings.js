// The settings panel behind the header's sliders button: the season, notifications, the ranking,
// and which release of the page this is. Phones show it as a sheet from the bottom, wider screens
// as a modal.

import { joinWithSeparator, setHtml } from "./html.js";
import { session } from "./session.js";

const findElement = (id) => /** @type {HTMLElement} */ (document.getElementById(id));
const findDialog = () =>
  /** @type {HTMLDialogElement} */ (document.getElementById("settingsDialog"));

const isShowingPastSeason = () => session.activeYear !== session.currentSeason;

// Outside settings, only this tag says the page is showing an earlier season.
export function renderSeasonLabel() {
  const tag = findElement("yearTag");
  tag.hidden = !isShowingPastSeason();
  tag.textContent = String(session.activeYear);
}

// A release from an earlier year names its year; this year's go without.
function formatReleaseTime(iso) {
  const released = new Date(iso);
  const isThisYear = released.getFullYear() === new Date().getFullYear();
  return released.toLocaleString([], {
    year: isThisYear ? undefined : "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

// The commit is there on hover, and stands in for a version the build couldn't work out.
/** @param {{ version: string | null, commit: string, builtAt: string }} release */
function renderRelease({ version, commit, builtAt }) {
  const note = findElement("versionNote");
  const name = version ? `v${version}` : commit;
  setHtml(note, joinWithSeparator([name, `Released ${formatReleaseTime(builtAt)}`]));
  note.title = `Commit ${commit}`;
  note.hidden = false;
}

// The deploy writes version.json into the Worker's bundle; a local server has none.
async function showRelease() {
  try {
    const response = await fetch(new URL("version.json", location.href), { cache: "no-store" });
    if (response.ok) renderRelease(await response.json());
  } catch {
    /* the panel works without it */
  }
}

// A click on the backdrop lands on the dialog itself; its content fills it edge to edge.
function closeOnBackdropClick(event) {
  if (event.target === event.currentTarget) findDialog().close();
}

// A line under the pinned header shows once the settings have scrolled under it.
function markScrolled() {
  const dialog = findDialog();
  dialog.querySelector(".sheet-top").classList.toggle("scrolled", dialog.scrollTop > 0);
}

// Settings open at the top each time, with the ranking below them.
function openSettings() {
  const dialog = findDialog();
  dialog.showModal();
  dialog.scrollTop = 0;
  markScrolled();
}

export function startSettings() {
  const dialog = findDialog();
  findElement("settingsBtn").addEventListener("click", openSettings);
  findElement("settingsDoneBtn").addEventListener("click", () => dialog.close());
  dialog.addEventListener("click", closeOnBackdropClick);
  dialog.addEventListener("scroll", markScrolled);
  showRelease();
}
