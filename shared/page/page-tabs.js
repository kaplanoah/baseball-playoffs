import { saveLastTab } from "./last-tab.js";
import { scrollToTop } from "./scroll-to-top.js";
import { moveTabSelection, startTabBar } from "./tab-bar.js";
import { readSelectedTab, selectTab, wireTabs } from "./tabs.js";

// The page's own tabs, in the tab bar, each showing the section whose id is `view-<tab>`.

const findTabButtons = () =>
  /** @type {HTMLButtonElement[]} */ ([...document.querySelectorAll("nav.tabs [role=tab]")]);

/** @param {string} tab */
function showTab(tab) {
  selectTab(findTabButtons(), tab);
  for (const view of document.querySelectorAll("section.view")) {
    view.classList.toggle("active", view.id === `view-${tab}`);
  }
}

/** @param {string} tab */
function switchTab(tab) {
  showTab(tab);
  moveTabSelection(tab);
  saveLastTab(tab);
}

// As on iPhone, choosing the tab that's already showing scrolls it back to the top.
/** @param {string} tab */
function chooseTab(tab) {
  if (tab === readSelectedTab(findTabButtons())) scrollToTop();
  else switchTab(tab);
}

// The page has already reopened its last tab (open-last-tab.js), so the pill starts there.
export function startPageTabs() {
  wireTabs(findTabButtons(), chooseTab);
  startTabBar(chooseTab);
}
