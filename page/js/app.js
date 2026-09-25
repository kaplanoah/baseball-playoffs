import { startLive, watchPageVisibility } from "./live.js";
import { renderAll } from "./render.js";
import {
  emptySeason,
  loadSeason,
  loadSeasonList,
  loadStandings,
  watchSeason,
  watchStandings,
} from "./season-store.js";
import { session, seasonYear, composeState } from "./session.js";
import { openSetup, closeSetup, saveSetup } from "./setup.js";
import { renderStamp } from "./stamp-view.js";
import { renderStandings } from "./standings.js";

const STAMP_REFRESH_MS = 60 * 1000;

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

const findTabButtons = () =>
  /** @type {NodeListOf<HTMLButtonElement>} */ (document.querySelectorAll("nav.tabs button"));

function switchTab(tab) {
  for (const button of findTabButtons()) {
    button.classList.toggle("active", button.dataset.tab === tab);
  }
  for (const view of document.querySelectorAll("section.view")) {
    view.classList.toggle("active", view.id === `view-${tab}`);
  }
}

function watchActiveSeason() {
  watchSeason(session.activeYear, renderAll);
  watchStandings(session.activeYear, () => {
    renderStandings();
    renderStamp();
  });
}

async function switchYear(year) {
  session.activeYear = year;
  await loadSeason(year);
  await loadStandings(year);
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
    session.db = null;
    return recent;
  }
}

function fillYearPicker(years) {
  const picker = /** @type {HTMLSelectElement} */ (document.getElementById("yearSel"));
  picker.innerHTML = years
    .map(
      (year) =>
        `<option value="${year}" ${Number(year) === session.activeYear ? "selected" : ""}>${year}</option>`,
    )
    .join("");
  picker.addEventListener("change", () => switchYear(Number(picker.value)));
}

async function loadActiveSeason() {
  if (session.db) {
    try {
      await loadSeason(session.activeYear);
      await loadStandings(session.activeYear);
      return;
    } catch {
      session.db = null;
    }
  }
  session.seasonDoc = emptySeason(session.activeYear);
  composeState();
}

function wireControls() {
  for (const button of findTabButtons()) {
    button.addEventListener("click", () => switchTab(button.dataset.tab));
  }
  document.getElementById("openSetupBtn").addEventListener("click", openSetup);
  document.getElementById("cancelSetupBtn").addEventListener("click", closeSetup);
  document.getElementById("saveSetupBtn").addEventListener("click", saveSetup);
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
}

if (window.claude?.hot) {
  window.claude.hot.ready ? window.claude.hot.ready(boot) : boot();
} else {
  boot();
}
