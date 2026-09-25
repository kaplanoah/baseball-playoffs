import { rankedOrder } from "./clubs.js";
import { fetchLive } from "./live-fetch.js";
import { startLive, watchPageVisibility } from "./live.js";
import { REORDER_EVENT } from "./ranking.js";
import { renderAll } from "./render.js";
import {
  applyDeferredSeason,
  loadSeason,
  loadSeasonList,
  loadStandings,
  saveRanking,
  stopSavingAfterFailedLoad,
  watchSeason,
  watchStandings,
} from "./season-store.js";
import { hasSpringStarted, session, seasonYear } from "./session.js";
import { easternDay } from "./snapshot.js";
import { openSetup, saveSetup } from "./setup.js";
import { renderStamp, showSaveResult } from "./stamp-view.js";
import { renderStandings } from "./standings.js";

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

function switchTab(tab) {
  for (const button of findTabButtons()) {
    const isActive = button.dataset.tab === tab;
    button.classList.toggle("active", isActive);
    button.setAttribute("aria-selected", String(isActive));
    button.tabIndex = isActive ? 0 : -1;
  }
  for (const view of document.querySelectorAll("section.view")) {
    view.classList.toggle("active", view.id === `view-${tab}`);
  }
}

function moveBetweenTabs(event) {
  const buttons = findTabButtons();
  const index = buttons.indexOf(event.target);
  const targets = { ArrowLeft: index - 1, ArrowRight: index + 1, Home: 0, End: buttons.length - 1 };
  if (index === -1 || !(event.key in targets)) return;
  event.preventDefault();
  const next = buttons[(targets[event.key] + buttons.length) % buttons.length];
  switchTab(next.dataset.tab);
  next.focus();
}

function watchActiveSeason() {
  watchSeason(session.activeYear, renderAll);
  watchStandings(session.activeYear, () => {
    renderStandings();
    renderStamp();
  });
}

async function loadActiveSeason() {
  try {
    await loadSeason(session.activeYear);
  } catch {
    stopSavingAfterFailedLoad();
    await loadSeason(session.activeYear);
  }
  await loadStandings(session.activeYear);
}

async function switchYear(year) {
  session.activeYear = year;
  await loadActiveSeason();
  renderAll();
  watchActiveSeason();
  startLive();
}

async function connectStore() {
  try {
    session.db = (await window.claude?.use?.("db")) || null;
  } catch {
    session.db = null;
  }
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
  findYearPicker().innerHTML = years
    .map(
      (year) =>
        `<option value="${year}" ${Number(year) === session.activeYear ? "selected" : ""}>${year}</option>`,
    )
    .join("");
}

// Before April the new season starts on the day MLB says spring training does.
async function checkSpringTraining() {
  const year = easternDay(Date.now()).year;
  if (session.currentSeason === year) return;
  let springStart;
  try {
    ({ springStart } = (await fetchLive(year)).snapshot);
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
  if (order.join() !== rankedOrder().join()) showSaveResult(saveRanking(order));
  applyDeferredSeason();
  renderAll();
}

function wireControls() {
  for (const button of findTabButtons()) {
    button.addEventListener("click", () => switchTab(button.dataset.tab));
    button.addEventListener("keydown", moveBetweenTabs);
  }
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
  await connectStore();
  fillYearPicker(await listYears());
  await loadActiveSeason();
  renderAll();
  watchActiveSeason();
  refreshStampEveryMinute();
  watchPageVisibility();
  startLive();
  watchSpringTraining();
  await followSpringTraining();
}

if (window.claude?.hot) {
  window.claude.hot.ready ? window.claude.hot.ready(boot) : boot();
} else {
  boot();
}
