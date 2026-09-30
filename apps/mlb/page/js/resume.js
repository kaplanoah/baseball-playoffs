// A phone keeps a home-screen page suspended for days and resumes it as it was, with no way to
// reload it but quitting the app. So a page coming back reloads itself when a deploy has
// replaced it, or when it has been away long enough that what it shows can't be trusted.

import { fetchRelease, loadRelease } from "./release.js";
import { session } from "./session.js";

const LONG_AWAY_MS = 30 * 60 * 1000;
// Timers stop while a phone suspends the page, so a tick this late means the page was asleep,
// even when the phone never said it was hidden.
const TICK_MS = 15 * 1000;
const ASLEEP_MS = 60 * 1000;

let activeAt = Date.now();
let isCheckingRelease = false;
let isReloadPending = false;

/**
 * @param {import("./release.js").Release | null} loaded
 * @param {import("./release.js").Release | null} current
 */
const isReplaced = (loaded, current) => !!loaded && !!current && loaded.commit !== current.commit;

// A reload mid-drag would drop the ranking card, so it waits for the first tick after the drag.
function reloadPage() {
  if (session.isReordering) isReloadPending = true;
  else location.reload();
}

export async function reloadIfReplaced() {
  if (isCheckingRelease) return;
  isCheckingRelease = true;
  try {
    const [loaded, current] = await Promise.all([loadRelease(), fetchRelease()]);
    if (isReplaced(loaded, current)) reloadPage();
  } finally {
    isCheckingRelease = false;
  }
}

function catchUpOnReturn() {
  if (document.hidden) return;
  const awayMs = Date.now() - activeAt;
  activeAt = Date.now();
  if (awayMs >= LONG_AWAY_MS) reloadPage();
  else reloadIfReplaced();
}

function tick() {
  if (document.hidden) return;
  if (isReloadPending) reloadPage();
  else if (Date.now() - activeAt >= ASLEEP_MS) catchUpOnReturn();
  else activeAt = Date.now();
}

// iOS doesn't always report a home-screen page coming back, so every sign of it counts.
export function watchReturns() {
  loadRelease();
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) activeAt = Date.now();
    else catchUpOnReturn();
  });
  addEventListener("pageshow", (event) => {
    if (event.persisted) catchUpOnReturn();
  });
  addEventListener("focus", catchUpOnReturn);
  setInterval(tick, TICK_MS);
}
