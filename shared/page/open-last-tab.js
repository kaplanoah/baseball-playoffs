// Modules run only once all of them have loaded, so a page left to them would first paint the tab
// its markup selects and then jump. This plain script loads in the head, and the page calls
// openLastTab() right after its tabs and views, before anything is painted.

// Storage can be empty or refuse access, as in a private window, so the page never depends on it.
function readLastTab() {
  try {
    return localStorage.getItem("lastTab");
  } catch {
    return null;
  }
}

/** @param {string} tab */
function markTabSelected(tab) {
  for (const button of document.querySelectorAll("nav.tabs [role=tab]")) {
    const isActive = /** @type {HTMLElement} */ (button).dataset.tab === tab;
    button.classList.toggle("active", isActive);
    button.setAttribute("aria-selected", String(isActive));
    /** @type {HTMLElement} */ (button).tabIndex = isActive ? 0 : -1;
  }
}

/** @param {string} tab */
function showView(tab) {
  for (const view of document.querySelectorAll("section.view")) {
    view.classList.toggle("active", view.id === `view-${tab}`);
  }
}

// A tab saved before the page dropped it is left alone, so the page opens on its first tab.
function openLastTab() {
  const tab = readLastTab();
  if (!tab || !document.getElementById(`view-${tab}`)) return;
  markTabSelected(tab);
  showView(tab);
}
