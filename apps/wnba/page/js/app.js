import { setHtml } from "#shared/html.js";
import { trackKeyboardFocus } from "#shared/keyboard-focus.js";
import { fillGameLists, startGamePager } from "#shared/game-pager.js";
import { startNotifications } from "#shared/notifications.js";
import { startPageTabs } from "#shared/page-tabs.js";
import { watchReturns } from "#shared/resume.js";
import { startSettingsSheet } from "#shared/settings-sheet.js";
import { createWorkerStore } from "#shared/worker-store.js";
import { startAppearance } from "./appearance.js";
import { renderBracket } from "./bracket-view.js";
import { renderGames } from "./games-view.js";
import { loadSeason, watchSeason, watchStatus } from "./season-data.js";
import { session } from "./session.js";
import { describeStamp } from "./stamp.js";
import { renderStandings } from "./standings-view.js";
import { renderTeams } from "./teams-view.js";

const CLOCK_REFRESH_MS = 60 * 1000;

const findElement = (id) => /** @type {HTMLElement} */ (document.getElementById(id));

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
  const gameLists = renderGames(session.season, now);
  fillGameLists((list) => gameLists[list]);
  setHtml(findElement("standingsWrap"), renderStandings(session.season));
  setHtml(findElement("teamsWrap"), renderTeams(session.season));
  renderStamp();
}

// Times read as today or tomorrow, so they're redrawn as the clock moves on.
function refreshClockEveryMinute() {
  setInterval(renderAll, CLOCK_REFRESH_MS);
}

async function boot() {
  startAppearance();
  watchReturns();
  trackKeyboardFocus();
  startPageTabs();
  startGamePager();
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
