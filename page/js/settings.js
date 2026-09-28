// The settings panel behind the header's sliders button: the season, notifications, and which
// version of the page this is. Phones show it as a sheet from the bottom, wider screens as a modal.

import { html, joinWithSeparator, setHtml } from "./html.js";
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
  findElement("seasonNote").textContent = isShowingPastSeason()
    ? "A finished season."
    : "This season, updated live.";
}

const formatBuildTime = (iso) =>
  new Date(iso).toLocaleString([], { dateStyle: "medium", timeStyle: "short" });

/** @param {{ commit: string, pullRequest: number | null, builtAt: string }} release */
function renderRelease({ commit, pullRequest, builtAt }) {
  const note = findElement("versionNote");
  const name = pullRequest ? joinWithSeparator([`#${pullRequest}`, commit]) : commit;
  setHtml(
    note,
    html`<span>Version ${name}</span><span>Deployed ${formatBuildTime(builtAt)}</span>`,
  );
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

export function startSettings() {
  const dialog = findDialog();
  findElement("settingsBtn").addEventListener("click", () => dialog.showModal());
  findElement("settingsDoneBtn").addEventListener("click", () => dialog.close());
  dialog.addEventListener("click", closeOnBackdropClick);
  showRelease();
}
