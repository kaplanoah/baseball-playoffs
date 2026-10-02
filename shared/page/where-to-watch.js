// The settings switch for whether games show the channels they're on. Each device keeps its own.
// Off, the page says so on its root, and game-row.css leaves the channels out and a live game's
// clock under its score.

const STORAGE_KEY = "whereToWatch";

// Storage can be off, as in a private window, and then the channels show.
function readIsShown() {
  try {
    return localStorage.getItem(STORAGE_KEY) !== "off";
  } catch {
    return true;
  }
}

/** @param {boolean} isShown */
function saveIsShown(isShown) {
  try {
    if (isShown) localStorage.removeItem(STORAGE_KEY);
    else localStorage.setItem(STORAGE_KEY, "off");
  } catch {
    // The choice still applies until the page reloads.
  }
}

/**
 * @param {HTMLElement} toggle
 * @param {boolean} isShown
 */
function showWhereToWatch(toggle, isShown) {
  document.documentElement.dataset.whereToWatch = isShown ? "on" : "off";
  toggle.setAttribute("aria-checked", String(isShown));
}

export function startWhereToWatch() {
  const toggle = /** @type {HTMLElement} */ (document.getElementById("watchSwitch"));
  showWhereToWatch(toggle, readIsShown());
  toggle.addEventListener("click", () => {
    const isShown = toggle.getAttribute("aria-checked") !== "true";
    showWhereToWatch(toggle, isShown);
    saveIsShown(isShown);
  });
}
