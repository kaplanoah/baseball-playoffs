// A page that loads again, after a deploy or after the phone dropped it, would show empty views
// until the store answers, so it first draws what it showed when it was last on screen: the
// markup of each part it draws whole, which show-last-drawn.js puts back before the first paint,
// and the season, which the page draws from once its modules load.

const LAST_SEEN_KEY = "lastSeen";
const LAST_DRAWN_KEY = "lastDrawn";

// Storage can be empty or refuse access, as in a private window, so the page never depends on it.

/** @returns {any} */
export function readLastSeen() {
  try {
    return JSON.parse(localStorage.getItem(LAST_SEEN_KEY) ?? "null");
  } catch {
    return null;
  }
}

/**
 * The child indexes that lead from `part` down to `element`.
 * @param {Element} part
 * @param {Element} element
 */
function readPath(part, element) {
  const path = [];
  for (let node = element; node !== part; node = /** @type {Element} */ (node.parentElement))
    path.unshift([.../** @type {Element} */ (node.parentElement).children].indexOf(node));
  return path;
}

// A list or bracket that scrolls sideways shows where it was, rather than its start.
/** @param {Element} part */
const readScrolls = (part) =>
  [...part.querySelectorAll("*")]
    .filter((element) => element.scrollLeft > 0)
    .map((element) => ({ path: readPath(part, element), left: element.scrollLeft }));

// A part's classes can come from its code rather than its markup, like a pager's.
/** @param {HTMLElement} part */
const readDrawnPart = (part) => ({
  markup: part.innerHTML,
  hidden: part.hidden,
  classes: part.className,
  scrolls: readScrolls(part),
});

function readDrawnParts() {
  const parts = /** @type {HTMLElement[]} */ ([...document.querySelectorAll("[data-last-drawn]")]);
  return Object.fromEntries(parts.map((part) => [part.id, readDrawnPart(part)]));
}

/**
 * @param {string} key
 * @param {unknown} value
 */
function saveItem(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* the next load waits for the store instead */
  }
}

/** @param {() => any} readShown what the page shows, or null before it has anything to show */
function saveLastSeen(readShown) {
  const shown = readShown();
  if (!shown) return;
  saveItem(LAST_SEEN_KEY, shown);
  saveItem(LAST_DRAWN_KEY, readDrawnParts());
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
