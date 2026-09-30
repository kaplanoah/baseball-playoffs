import { setHtml } from "#shared/html.js";
import { trackKeyboardFocus } from "#shared/keyboard-focus.js";
import { readLastTab, saveLastTab } from "#shared/last-tab.js";
import { startNotifications } from "#shared/notifications.js";
import { watchReturns } from "#shared/resume.js";
import { scrollToTop } from "#shared/scroll-to-top.js";
import { startSettingsSheet } from "#shared/settings-sheet.js";
import { moveTabSelection, startTabBar } from "#shared/tab-bar.js";
import { readSelectedTab, selectTab, wireTabs } from "#shared/tabs.js";
import { createWorkerStore } from "#shared/worker-store.js";
import { renderBracket } from "./bracket-view.js";
import { renderGames } from "./games-view.js";
import { loadSeason, watchSeason, watchStatus } from "./season-data.js";
import { session } from "./session.js";
import { describeStamp } from "./stamp.js";
import { renderStandings } from "./standings-view.js";
import { renderTeams } from "./teams-view.js";

const CLOCK_REFRESH_MS = 60 * 1000;

const findElement = (id) => /** @type {HTMLElement} */ (document.getElementById(id));

const findTabButtons = () =>
  /** @type {HTMLButtonElement[]} */ ([...document.querySelectorAll("nav.tabs [role=tab]")]);

function showTab(tab) {
  selectTab(findTabButtons(), tab);
  for (const view of document.querySelectorAll("section.view")) {
    view.classList.toggle("active", view.id === `view-${tab}`);
  }
}

function switchTab(tab) {
  showTab(tab);
  moveTabSelection(tab);
  saveLastTab(tab);
}

// As on iPhone, choosing the tab that's already showing scrolls it back to the top.
function chooseTab(tab) {
  if (tab === readSelectedTab(findTabButtons())) scrollToTop();
  else switchTab(tab);
}

// Runs before the tab bar starts, so its pill starts on the reopened tab instead of sliding there.
function reopenLastTab() {
  const lastTab = readLastTab();
  if (findTabButtons().some((button) => button.dataset.tab === lastTab)) showTab(lastTab);
}

function renderStamp() {
  const { text, isProblem } = describeStamp({ ...session, now: Date.now() });
  const stamp = findElement("stamp");
  stamp.textContent = text;
  stamp.classList.toggle("problem", isProblem);
  stamp.hidden = !text;
}

function renderAll() {
  const now = Date.now();
  findElement("yearTag").textContent = String(session.year);
  setHtml(findElement("bracketWrap"), renderBracket(session.season, now));
  setHtml(findElement("gamesWrap"), renderGames(session.season, now));
  setHtml(findElement("standingsWrap"), renderStandings(session.season));
  setHtml(findElement("teamsWrap"), renderTeams(session.season));
  renderStamp();
}

// Times read as today or tomorrow, so they're redrawn as the clock moves on.
function refreshClockEveryMinute() {
  setInterval(renderAll, CLOCK_REFRESH_MS);
}

function startTabs() {
  reopenLastTab();
  wireTabs(findTabButtons(), chooseTab);
  startTabBar(chooseTab);
}

async function boot() {
  watchReturns();
  trackKeyboardFocus();
  startTabs();
  startSettingsSheet();
  session.db = createWorkerStore();
  await loadSeason();
  renderAll();
  watchSeason(renderAll);
  watchStatus(renderStamp);
  refreshClockEveryMinute();
  startNotifications();
}

boot();
