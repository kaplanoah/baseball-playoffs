const LAST_TAB_KEY = "lastTab";

// Storage can be empty or refuse access, as in a private window, so the page never depends on it.

/** @param {string} tab */
export function saveLastTab(tab) {
  try {
    localStorage.setItem(LAST_TAB_KEY, tab);
  } catch {
    /* the page opens on its first tab instead */
  }
}
