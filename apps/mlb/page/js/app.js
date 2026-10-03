import { renderBracket, watchBracketSpace } from "./bracket-view.js";
import { listRankedOrder } from "./clubs.js";
import { readEasternDay } from "#shared/days.js";
import { startHomeScreen } from "#shared/home-screen.js";
import { redrawEased } from "#shared/eased-redraw.js";
import { html, setHtml } from "#shared/html.js";
import { trackKeyboardFocus } from "#shared/keyboard-focus.js";
import { fetchLive, isReadableLive } from "./live-fetch.js";
import { startLive, watchPageVisibility } from "./live.js";
import { startGamePager } from "#shared/game-pager.js";
import { keepLastSeen, readLastSeen } from "#shared/last-seen.js";
import { endLoadNote } from "#shared/load-note.js";
import { startNotifications } from "#shared/notifications.js";
import { startPageTabs } from "#shared/page-tabs.js";
import { startMatchups } from "./matchup.js";
import { REORDER_EVENT } from "./ranking.js";
import { renderAll } from "./render.js";
import { reloadPage, watchReturns } from "#shared/resume.js";
import { startServiceWorker } from "#shared/service-worker.js";
import {
  applyDeferredSeason,
  loadSeasonList,
  saveRanking,
  showUnsavedSeason,
  stopSavingAfterFailedLoad,
  watchYear,
} from "./season-store.js";
import { composeState, hasSpringStarted, session, readSeasonYear } from "./session.js";
import { startSettings } from "./settings.js";
import { renderTeamSheet } from "./team-view.js";
import { TEAMS } from "./teams.js";
import { renderStamp, showSaveResult } from "./stamp-view.js";
import { renderStandings } from "./standings.js";
import { renderUpdates } from "./updates.js";
import { startTeamSheet } from "#shared/team-sheet.js";
import { createWorkerStore } from "#shared/worker-store.js";

const CLOCK_REFRESH_MS = 60 * 1000;
const SPRING_CHECK_MS = 60 * 60 * 1000;

const findYearPicker = () => /** @type {HTMLSelectElement} */ (document.getElementById("yearSel"));

function redrawStandings() {
  renderStandings();
  renderStamp();
}

// What new data changes eases in rather than jumps.
const YEAR_REDRAWS = {
  onSeasonChange: () => redrawEased(renderAll),
  onStandingsChange: () => redrawEased(redrawStandings),
  onReadingsChange: () => redrawEased(renderUpdates),
};

// Watching a year reads each of its documents, so the watches' first answers are its load.
async function loadActiveSeason() {
  const year = session.activeYear;
  if (session.db) {
    try {
      await watchYear(year, YEAR_REDRAWS);
      return;
    } catch {
      stopSavingAfterFailedLoad();
    }
  }
  showUnsavedSeason(year);
}

async function switchYear(year) {
  session.activeYear = year;
  await loadActiveSeason();
  if (session.activeYear !== year) return;
  renderAll();
  startLive();
}

async function listYears() {
  const recent = [readSeasonYear(), readSeasonYear() - 1, readSeasonYear() - 2].map(String);
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
  const year = readEasternDay(Date.now()).year;
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
  const hasMoved = order.join() !== listRankedOrder().join();
  if (hasMoved) showSaveResult(saveRanking(order));
  applyDeferredSeason(hasMoved);
  renderAll();
}

function wireControls() {
  startPageTabs();
  startGamePager();
  startMatchups();
  startTeamSheet({ isTeam: (id) => id in TEAMS, renderSheet: (id) => renderTeamSheet(id) });
  startSettings();
  startHomeScreen();
  const picker = findYearPicker();
  picker.addEventListener("change", () => switchYear(Number(picker.value)));
  document
    .getElementById("rankList")
    .addEventListener(REORDER_EVENT, (event) =>
      finishReordering(/** @type {CustomEvent} */ (event).detail.order),
    );
}

// The stamp's times and the bracket's countdowns to first pitch read the clock.
function refreshClockEveryMinute() {
  setInterval(() => {
    try {
      renderStamp();
      renderBracket();
    } catch {
      /* try again next minute */
    }
  }, CLOCK_REFRESH_MS);
}

/** @param {any} shown */
const pickShown = ({ seasonDoc, storedStandings, readings, trackedTitles, live }) => ({
  seasonDoc,
  storedStandings,
  readings,
  trackedTitles,
  live,
});

const readShown = () => session.seasonDoc && { year: session.activeYear, ...pickShown(session) };

// What the page last showed is only a stand-in until the store and MLB answer, so what can't be
// drawn is skipped.
function drawLastSeen() {
  const lastSeen = readLastSeen();
  if (!lastSeen?.seasonDoc || lastSeen.year !== session.activeYear) return;
  const before = pickShown(session);
  try {
    const live = isReadableLive(lastSeen.live, session.activeYear) ? lastSeen.live : null;
    Object.assign(session, pickShown({ ...lastSeen, live }));
    composeState();
    renderAll();
    endLoadNote();
  } catch {
    Object.assign(session, before);
  }
}

// A page whose load failed has nothing to catch up from, so it loads again.
function catchUp() {
  if (!session.db) {
    reloadPage();
    return;
  }
  session.db.catchUp();
  if (session.state && !session.isReordering) redrawEased(renderAll);
}

// The season the store and MLB answer with eases in over the one the page last showed.
function drawLoadedSeason() {
  renderAll();
  endLoadNote();
}

async function boot() {
  watchReturns({ isBusy: () => session.isReordering, catchUp, pause: () => session.db?.pause() });
  trackKeyboardFocus();
  wireControls();
  session.db = createWorkerStore();
  drawLastSeen();
  keepLastSeen(readShown);
  const [years] = await Promise.all([listYears(), loadActiveSeason()]);
  fillYearPicker(years);
  redrawEased(drawLoadedSeason);
  watchBracketSpace();
  refreshClockEveryMinute();
  watchPageVisibility();
  startLive();
  startServiceWorker();
  startNotifications();
  watchSpringTraining();
  await followSpringTraining();
}

boot();
