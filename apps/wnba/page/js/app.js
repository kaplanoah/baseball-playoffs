import { setHtml } from "#shared/html.js";
import { trackKeyboardFocus } from "#shared/keyboard-focus.js";
import { fillGameLists, startGamePager } from "#shared/game-pager.js";
import { keepLastSeen, readLastSeen } from "#shared/last-seen.js";
import { startNotifications } from "#shared/notifications.js";
import { startPageTabs } from "#shared/page-tabs.js";
import { watchReturns } from "#shared/resume.js";
import { startSettingsSheet } from "#shared/settings-sheet.js";
import { fillStamp } from "#shared/stamp.js";
import { createWorkerStore } from "#shared/worker-store.js";
import { startAppearance } from "./appearance.js";
import { placeBracket, readBracketScroll, startBracket } from "./bracket-tree.js";
import { renderBracket } from "./bracket-view.js";
import { refreshGameSheet, startGameSheet } from "./game-sheet.js";
import { renderGames } from "./games-view.js";
import { loadSeason, watchSeason, watchStatus } from "./season-data.js";
import { session } from "./session.js";
import { describeStampProblem, renderStampLines } from "./stamp.js";
import { renderStandings } from "./standings-view.js";
import { drawTeams } from "./teams-view.js";

const CLOCK_REFRESH_MS = 60 * 1000;

const findElement = (id) => /** @type {HTMLElement} */ (document.getElementById(id));

function renderStamp() {
  const problem = describeStampProblem(session);
  const lines = renderStampLines(session.season, Date.now());
  fillStamp(findElement("stamp"), lines, problem ? [problem] : []);
}

function drawStandings() {
  setHtml(findElement("standingsWrap"), renderStandings(session.season, session.standingsView));
}

// The pill's buttons are drawn again with the table, so the chosen one takes the focus back.
function focusChosenStandingsView() {
  const selector = `[data-standings-view="${session.standingsView}"]`;
  const chosen = /** @type {HTMLElement | null} */ (
    findElement("standingsWrap").querySelector(selector)
  );
  chosen?.focus();
}

function chooseStandingsView(/** @type {MouseEvent} */ event) {
  const button = /** @type {HTMLElement | null} */ (
    /** @type {Element} */ (event.target).closest("[data-standings-view]")
  );
  if (!button) return;
  session.standingsView = /** @type {typeof session.standingsView} */ (
    button.dataset.standingsView
  );
  drawStandings();
  focusChosenStandingsView();
}

function renderAll() {
  const now = Date.now();
  const keptLeft = readBracketScroll();
  setHtml(findElement("bracketWrap"), renderBracket(session.season, now));
  placeBracket(session.season?.series ?? [], keptLeft);
  const gameLists = renderGames(session.season, now);
  fillGameLists((list) => gameLists[list]);
  drawStandings();
  drawTeams(findElement("teamsWrap"), session.season, { year: session.year, now });
  renderStamp();
  refreshGameSheet();
}

// Times read as today or tomorrow, so they're redrawn as the clock moves on.
function refreshClockEveryMinute() {
  setInterval(renderAll, CLOCK_REFRESH_MS);
}

// The season the page last showed is only a stand-in until the store answers, so one that can't
// be drawn is skipped.
function drawLastSeen() {
  const lastSeen = readLastSeen();
  if (!lastSeen?.season) return;
  const { year, season } = session;
  try {
    Object.assign(session, { year: lastSeen.year, season: lastSeen.season });
    renderAll();
  } catch {
    Object.assign(session, { year, season });
  }
}

const readShown = () => session.season && { year: session.year, season: session.season };

function catchUp() {
  session.db.catchUp();
  renderAll();
}

async function boot() {
  startAppearance();
  watchReturns({ catchUp });
  trackKeyboardFocus();
  startPageTabs();
  startGamePager();
  startGameSheet();
  startSettingsSheet();
  startBracket();
  findElement("standingsWrap").addEventListener("click", chooseStandingsView);
  session.db = createWorkerStore();
  drawLastSeen();
  keepLastSeen(readShown);
  await loadSeason();
  renderAll();
  watchSeason(renderAll);
  watchStatus(renderStamp);
  refreshClockEveryMinute();
  startNotifications();
}

boot();
