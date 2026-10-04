import { startHomeScreen } from "#shared/home-screen.js";
import { setHtml } from "#shared/html.js";
import { startDiagnostics } from "#shared/diagnostics.js";
import { redrawEased } from "#shared/eased-redraw.js";
import { trackKeyboardFocus } from "#shared/keyboard-focus.js";
import { fillGameLists, startGamePager } from "#shared/game-pager.js";
import { keepLastSeen, readLastSeen } from "#shared/last-seen.js";
import { endLoadNote } from "#shared/load-note.js";
import { startNotifications } from "#shared/notifications.js";
import { startPageTabs } from "#shared/page-tabs.js";
import { watchReturns } from "#shared/resume.js";
import { startServiceWorker } from "#shared/service-worker.js";
import { startSettingsSheet } from "#shared/settings-sheet.js";
import { refreshTeamSheet, startTeamSheet } from "#shared/team-sheet.js";
import { fillStamp } from "#shared/stamp.js";
import { createWorkerStore } from "#shared/worker-store.js";
import { startAppearance } from "./appearance.js";
import { placeBracket, readBracketScroll, startBracket } from "./bracket-tree.js";
import { renderBracket } from "./bracket-view.js";
import { refreshGameSheet, startGameSheet } from "./game-sheet.js";
import { renderGames } from "./games-view.js";
import { loadSeason, watchCurrentSeason, watchSeason, watchStatus } from "./season-data.js";
import { session } from "./session.js";
import { describeStampProblem, renderStampLines } from "./stamp.js";
import { drawStandings, startStandings } from "./standings-view.js";
import { renderTeamSheet } from "./team-view.js";
import { TEAMS } from "./teams.js";
import { drawUpdates } from "./updates.js";

const CLOCK_REFRESH_MS = 60 * 1000;

const findElement = (id) => /** @type {HTMLElement} */ (document.getElementById(id));

function renderStamp() {
  const problem = describeStampProblem(session);
  const lines = renderStampLines(session.season, Date.now());
  fillStamp(findElement("stamp"), lines, problem ? [problem] : []);
}

function renderAll() {
  const now = Date.now();
  const keptLeft = readBracketScroll();
  setHtml(findElement("bracketWrap"), renderBracket(session.season, now));
  placeBracket(keptLeft);
  const gameLists = renderGames(session.season, now);
  fillGameLists((list) => gameLists[list]);
  drawStandings(session.season);
  drawUpdates();
  renderStamp();
  refreshGameSheet();
  refreshTeamSheet();
}

// What new data changes eases in, as does the season the store answers with after the one the page
// last showed.
const showNewData = () => redrawEased(renderAll);

function drawLoadedSeason() {
  renderAll();
  endLoadNote();
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
    endLoadNote();
  } catch {
    Object.assign(session, { year, season });
  }
}

/** @param {string} team */
const renderShownTeam = (team) =>
  renderTeamSheet(session.season, team, { year: session.year, now: Date.now() });

const readShown = () => session.season && { year: session.year, season: session.season };

// A page whose first load failed may be watching a season the store doesn't have yet, and the
// store may have moved on to a new season, so it loads the season again.
async function reloadSeason() {
  const watchedYear = session.year;
  await loadSeason();
  if (session.year !== watchedYear) watchSeason(showNewData);
  showNewData();
}

function catchUp() {
  session.db.catchUp();
  if (session.problem) reloadSeason();
  else showNewData();
}

async function boot() {
  startAppearance();
  watchReturns({ catchUp, pause: () => session.db.pause() });
  trackKeyboardFocus();
  startPageTabs();
  startGamePager();
  startGameSheet();
  startTeamSheet({ isTeam: (team) => team in TEAMS, renderSheet: renderShownTeam });
  startSettingsSheet();
  startHomeScreen();
  startBracket();
  startStandings();
  startDiagnostics();
  session.db = createWorkerStore();
  drawLastSeen();
  keepLastSeen(readShown);
  await loadSeason();
  redrawEased(drawLoadedSeason);
  watchSeason(showNewData);
  watchCurrentSeason(reloadSeason);
  watchStatus(renderStamp);
  refreshClockEveryMinute();
  startServiceWorker();
  startNotifications();
}

boot();
