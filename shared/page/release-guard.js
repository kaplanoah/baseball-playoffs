// A deploy reaches Cloudflare's servers over several seconds, and the page's files load from its
// own release's folder, so a page loaded meanwhile can ask a server still on the other release for
// a file it doesn't have. The page then reloads until every file comes from one release. The
// build writes this script into the page's head, since a file of its own could go missing too.

const RELEASE_RELOADS_KEY = "releaseReloads";
const RELEASE_RELOAD_DELAY_MS = 2000;
const MOST_RELEASE_RELOADS = 15;

let hasMissingFile = false;

// Without storage the page can't count its reloads, so it doesn't risk reloading forever.
function readReleaseReloads() {
  try {
    return Number(sessionStorage.getItem(RELEASE_RELOADS_KEY) ?? 0);
  } catch {
    return MOST_RELEASE_RELOADS;
  }
}

/** @param {number | null} count */
function saveReleaseReloads(count) {
  try {
    if (count === null) sessionStorage.removeItem(RELEASE_RELOADS_KEY);
    else sessionStorage.setItem(RELEASE_RELOADS_KEY, String(count));
  } catch {
    /* the page stays as it is */
  }
}

/** @param {EventTarget | null} target */
const isPageFile = (target) =>
  target instanceof HTMLLinkElement || target instanceof HTMLScriptElement;

function reloadForMissingFile() {
  if (hasMissingFile) return;
  hasMissingFile = true;
  const count = readReleaseReloads();
  if (count >= MOST_RELEASE_RELOADS) return;
  saveReleaseReloads(count + 1);
  setTimeout(() => location.reload(), RELEASE_RELOAD_DELAY_MS);
}

// A file's failure to load doesn't bubble, so the window listens for it on the way down.
addEventListener(
  "error",
  (event) => {
    if (isPageFile(event.target)) reloadForMissingFile();
  },
  true,
);
addEventListener("load", () => {
  if (!hasMissingFile) saveReleaseReloads(null);
});
