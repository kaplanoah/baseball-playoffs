// The settings panel behind the page's settings button, and which release of the page this is.
// Phones show it as a sheet from the bottom that a swipe down closes, wider screens as a modal.
// The page supplies the button (#settingsBtn) and the dialog (#settingsDialog), with its
// .sheet-top, its Done button (#settingsDoneBtn), and a place for the release (#versionNote).

import { joinWithSeparator, setHtml } from "./html.js";
import { loadRelease } from "./release.js";
import { openSheet, wireSheet } from "./sheet.js";

const findElement = (id) => /** @type {HTMLElement} */ (document.getElementById(id));
const findDialog = () =>
  /** @type {HTMLDialogElement} */ (document.getElementById("settingsDialog"));

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
/** @param {import("./release.js").Release} release */
function renderRelease({ version, commit, builtAt }) {
  const note = findElement("versionNote");
  const name = version ? `v${version}` : commit;
  setHtml(note, joinWithSeparator([name, `Released ${formatReleaseTime(builtAt)}`]));
  note.title = `Commit ${commit}`;
  note.hidden = false;
}

async function showRelease() {
  const release = await loadRelease().catch(() => null);
  // A release this Worker no longer has names only its commit, and the page reloads for it.
  if (release?.builtAt) renderRelease(release);
}

/**
 * Wires the settings button, the dialog's ways to close, and the sheet's swipe, and shows the
 * release. A touch that starts on a target `isOwnGesture` claims, like a drag handle or a picker,
 * never moves the sheet.
 * @param {{ isOwnGesture?: (target: EventTarget) => boolean }} [options]
 */
export function startSettingsSheet({ isOwnGesture } = {}) {
  const dialog = findDialog();
  findElement("settingsBtn").addEventListener("click", () => openSheet(dialog));
  wireSheet(dialog, { doneButton: findElement("settingsDoneBtn"), isOwnGesture });
  showRelease();
}
