import { watchBracketSpace } from "./bracket-view.js";
import { rankedOrder } from "./clubs.js";
import { wireGameTabs } from "./games-view.js";
import { html, setHtml } from "./html.js";
import { readLastTab, saveLastTab } from "./last-tab.js";
import { fetchLive } from "./live-fetch.js";
import { startLive, watchPageVisibility } from "./live.js";
import { startNotifications } from "./notifications.js";
import { REORDER_EVENT } from "./ranking.js";
import { renderAll } from "./render.js";
import {
  applyDeferredSeason,
  loadReadings,
  loadSeason,
  loadSeasonList,
  loadStandings,
  saveRanking,
  stopSavingAfterFailedLoad,
  watchReadings,
  watchSeason,
  watchStandings,
} from "./season-store.js";
import { hasSpringStarted, session, seasonYear } from "./session.js";
import { easternDay } from "./snapshot.js";
import { startSettings } from "./settings.js";
import { openSetup, saveSetup } from "./setup.js";
import { renderStamp, showSaveResult } from "./stamp-view.js";
import { scrollToTop } from "./scroll-to-top.js";
import { renderStandings } from "./standings.js";
import { moveTabSelection, startTabBar } from "./tab-bar.js";
import { readSelectedTab, selectTab, wireTabs } from "./tabs.js";
import { renderUpdates } from "./updates.js";
import { createWorkerStore } from "./worker-store.js";

const STAMP_REFRESH_MS = 60 * 1000;
const SPRING_CHECK_MS = 60 * 60 * 1000;

// Browsers treat any keydown as keyboard navigation, so Shift alone would ring the last-clicked element.
const NAV_KEYS = new Set(["Tab", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Home", "End"]);

function trackKeyboardFocus() {
  addEventListener(
    "keydown",
    (event) => {
      if (NAV_KEYS.has(event.key)) document.body.classList.add("kbd");
    },
    true,
  );
  addEventListener("pointerdown", () => document.body.classList.remove("kbd"), true);
}

const findYearPicker = () => /** @type {HTMLSelectElement} */ (document.getElementById("yearSel"));

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

function watchActiveSeason() {
  watchSeason(session.activeYear, renderAll);
  watchStandings(session.activeYear, () => {
    renderStandings();
    renderStamp();
  });
  watchReadings(session.activeYear, renderUpdates);
}

async function loadActiveSeason() {
  try {
    await loadSeason(session.activeYear);
  } catch {
    stopSavingAfterFailedLoad();
    await loadSeason(session.activeYear);
  }
  await loadStandings(session.activeYear);
  await loadReadings(session.activeYear);
}

async function switchYear(year) {
  session.activeYear = year;
  await loadActiveSeason();
  if (session.activeYear !== year) return;
  renderAll();
  watchActiveSeason();
  startLive();
}

async function listYears() {
  const recent = [seasonYear(), seasonYear() - 1, seasonYear() - 2].map(String);
  if (!session.db) return recent;
  try {
    return await loadSeasonList();
  } catch {
    stopSavingAfterFailedLoad();
    return recent;
  }
}

function fillYearPicker(years) {
  const options = years.map(
    (year) =>
      html`<option value="${year}" ${Number(year) === session.activeYear ? "selected" : ""}>${year}</option>`,
  );
  setHtml(findYearPicker(), html`${options}`);
}

// Before April the new season starts on the day MLB says spring training does.
async function checkSpringTraining() {
  const year = easternDay(Date.now()).year;
  if (session.currentSeason === year) return;
  let springStart;
  try {
    ({ springStart } = await fetchLive(year));
  } catch {
    return;
  }
  if (!hasSpringStarted(springStart) || session.currentSeason === year) return;
  const wasShowingLatest = session.activeYear === session.currentSeason;
  session.currentSeason = year;
  if (wasShowingLatest) await switchYear(year);
  fillYearPicker(await listYears());
}

let springCheck = null;

function followSpringTraining() {
  springCheck ??= checkSpringTraining().finally(() => {
    springCheck = null;
  });
  return springCheck;
}

// A page left open across the first day of spring training still turns over.
function watchSpringTraining() {
  setInterval(() => {
    if (!document.hidden) followSpringTraining();
  }, SPRING_CHECK_MS);
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) followSpringTraining();
  });
}

// Sortable has already moved the dragged card, so redrawing the list keeps it where it was dropped.
function finishReordering(order) {
  session.isReordering = false;
  const hasMoved = order.join() !== rankedOrder().join();
  if (hasMoved) showSaveResult(saveRanking(order));
  applyDeferredSeason(hasMoved);
  renderAll();
}

function wireControls() {
  reopenLastTab();
  wireTabs(findTabButtons(), chooseTab);
  startTabBar(chooseTab);
  wireGameTabs();
  startSettings();
  const picker = findYearPicker();
  picker.addEventListener("change", () => switchYear(Number(picker.value)));
  document.getElementById("openSetupBtn").addEventListener("click", openSetup);
  document.getElementById("saveSetupBtn").addEventListener("click", saveSetup);
  document
    .getElementById("rankList")
    .addEventListener(REORDER_EVENT, (event) =>
      finishReordering(/** @type {CustomEvent} */ (event).detail.order),
    );
}

function refreshStampEveryMinute() {
  setInterval(() => {
    try {
      renderStamp();
    } catch {
      /* try again next minute */
    }
  }, STAMP_REFRESH_MS);
}

async function boot() {
  trackKeyboardFocus();
  wireControls();
  session.db = createWorkerStore();
  fillYearPicker(await listYears());
  await loadActiveSeason();
  renderAll();
  watchBracketSpace();
  watchActiveSeason();
  refreshStampEveryMinute();
  watchPageVisibility();
  startLive();
  startNotifications();
  watchSpringTraining();
  await followSpringTraining();
}

boot();
