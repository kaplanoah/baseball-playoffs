// A phone keeps a home-screen page suspended for days and resumes it as it was, with no way to
// reload it but quitting the app. So a page coming back catches up on what changed while it was
// away, and reloads itself only when a deploy has replaced it, since a reload blanks the screen.

import { fetchRelease, loadRelease } from "./release.js";

// Timers stop while a phone suspends the page, so a tick this late means the page was asleep,
// even when the phone never said it was hidden.
const TICK_MS = 15 * 1000;
const ASLEEP_MS = 60 * 1000;

let activeAt = Date.now();
let wasHidden = false;
let isCheckingRelease = false;
let isReloadPending = false;
/** @type {() => boolean} */
let isBusy = () => false;
/** @type {() => void} */
let catchUp = () => {};

/**
 * @param {import("./release.js").Release | null} loaded
 * @param {import("./release.js").Release | null} current
 */
const isReplaced = (loaded, current) => !!loaded && !!current && loaded.commit !== current.commit;

// A reload while the app is busy, as mid-drag, would drop what's under way, so it waits for the
// first tick after.
export function reloadPage() {
  if (isBusy()) isReloadPending = true;
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

// Focus can come with no time away, and a phone can wake a page without hiding it first, so only
// a page that was hidden or asleep catches up.
function catchUpOnReturn() {
  if (document.hidden) return;
  const hasBeenAway = wasHidden || Date.now() - activeAt >= ASLEEP_MS;
  activeAt = Date.now();
  wasHidden = false;
  if (hasBeenAway) catchUp();
  reloadIfReplaced();
}

function tick() {
  if (document.hidden) return;
  if (isReloadPending) reloadPage();
  else if (Date.now() - activeAt >= ASLEEP_MS) catchUpOnReturn();
  else activeAt = Date.now();
}

// iOS doesn't always report a home-screen page coming back, so every sign of it counts.
/** @param {{ isBusy?: () => boolean, catchUp?: () => void }} [options] */
export function watchReturns(options = {}) {
  isBusy = options.isBusy ?? isBusy;
  catchUp = options.catchUp ?? catchUp;
  loadRelease();
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      activeAt = Date.now();
      wasHidden = true;
    } else catchUpOnReturn();
  });
  addEventListener("pageshow", (event) => {
    if (event.persisted) catchUpOnReturn();
  });
  addEventListener("focus", catchUpOnReturn);
  setInterval(tick, TICK_MS);
}
