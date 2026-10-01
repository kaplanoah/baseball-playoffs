// A page that loads again, after a deploy or after the phone dropped it, would show empty views
// until the store answers, so it first draws what it showed when it was last on screen.

const LAST_SEEN_KEY = "lastSeen";

// Storage can be empty or refuse access, as in a private window, so the page never depends on it.

/** @returns {any} */
export function readLastSeen() {
  try {
    return JSON.parse(localStorage.getItem(LAST_SEEN_KEY) ?? "null");
  } catch {
    return null;
  }
}

/** @param {() => any} readShown what the page shows, or null before it has anything to show */
function saveLastSeen(readShown) {
  const shown = readShown();
  if (!shown) return;
  try {
    localStorage.setItem(LAST_SEEN_KEY, JSON.stringify(shown));
  } catch {
    /* the next load waits for the store instead */
  }
}

// Leaving the screen is the last moment the page is sure to run, whether it then reloads, sleeps,
// or is dropped.
/** @param {() => any} readShown what the page shows, or null before it has anything to show */
export function keepLastSeen(readShown) {
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) saveLastSeen(readShown);
  });
  addEventListener("pagehide", () => saveLastSeen(readShown));
}
