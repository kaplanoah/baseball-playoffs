import { isEliminated } from "./bracket.js";
import { renderTeamTag } from "./clubs.js";
import { html, setHtml } from "./html.js";
import { formatOrdinal } from "./ordinal.js";
import { describeRace, findStandingsRow, isSeedFinal } from "./race.js";
import { session } from "./session.js";
import { selectTab, wireTabs } from "./tabs.js";

const HALF_INNING_LABELS = { top: "Top", middle: "Mid", bottom: "Bot", end: "End" };
const OUT_LIGHTS = 2;
const CLINCH_TITLES = {
  z: "Clinched the best record in the league",
  y: "Clinched the division",
  w: "Clinched a wild card spot",
  x: "Clinched a playoff spot",
};
// Trimmed to the drawing, so sized in em its base sits on the text's baseline like a letter.
const SEED_LOCK = html`<svg class="seed-lock" viewBox="1.5 1.3 9 12.4" role="img" aria-label="seed final"><path d="M3.5 7V4.5a2.5 2.5 0 0 1 5 0V7" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/><rect x="2.2" y="7.2" width="7.6" height="5.8" rx="1.3" fill="none" stroke="currentColor" stroke-width="1.4"/></svg>`;
const EMPTY_LIST_TEXT = {
  previous: "No earlier games this season",
  today: "No games today",
  next: "No games scheduled yet",
};
const GAME_LISTS = ["previous", "today", "next"];
const SETTLE_DELAY_MS = 150;

let shownList = "today";
// The list a tapped tab is scrolling to, which the lists settle on even when they come to rest early.
let scrollTarget = null;
let pagesWidth = 0;
let settleTimer;
let isTouching = false;

const findGameTabs = () =>
  /** @type {HTMLButtonElement[]} */ ([...document.querySelectorAll("#view-games [role=tab]")]);
const findGameTabList = () =>
  /** @type {HTMLElement} */ (document.querySelector("#view-games [role=tablist]"));
const findGamePages = () => document.getElementById("gamePages");
const findGamePage = (list) => document.getElementById(`games-${list}`);

// Game days are Eastern calendar dates, so they're read as dates, never as instants.
function formatGameDay(date) {
  const [year, month, day] = date.split("-").map(Number);
  return new Date(year, month - 1, day).toLocaleDateString([], {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

function describeStart(game) {
  if (game.tbd) return game.doubleheader === 2 ? "After Game 1" : "Time TBD";
  return new Date(game.start).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

export function describeInning(game) {
  return [HALF_INNING_LABELS[game.half], formatOrdinal(game.inning || 1)].filter(Boolean).join(" ");
}

// The third out ends the half, so only the first two get a light.
export function renderOutLights(game) {
  if (game.state !== "live" || game.delay || game.outs == null) return html``;
  const lights = Array.from(
    { length: OUT_LIGHTS },
    (_, index) => html`<span class="out-light ${index < game.outs ? "on" : ""}"></span>`,
  );
  const label = game.outs === 1 ? "1 out" : `${game.outs} outs`;
  return html`<span class="out-lights" role="img" aria-label="${label}">${lights}</span>`;
}

function describeStatus(game) {
  if (game.delay) return game.delay;
  if (game.state === "final") return "Final";
  if (game.state === "live") return describeInning(game);
  return "";
}

// Not a .team-name: its clipped overflow cuts off the slant of the italic's last letter in Safari.
function renderClub(id) {
  if (id) return renderTeamTag(id);
  return html`<span class="club"><span class="dot unknown-club"></span><span class="tbd">TBD</span></span>`;
}

function renderSeed(id) {
  const team = session.state && session.state.teams && session.state.teams[id];
  if (!team || !team.seed) return html``;
  return html`<span class="seed">${team.seed} seed${isSeedFinal(id) && SEED_LOCK}</span>`;
}

function renderRace(row) {
  const race = describeRace(row);
  if (!race || !race.label) return html``;
  const title = race.standing === "clinched" && CLINCH_TITLES[race.label];
  return html`<span class="race ${race.standing}"${title && html` title="${title}"`}>${race.label}</span>`;
}

function renderFacts(id) {
  if (!id) return html``;
  const row = findStandingsRow(id);
  return html`<span class="game-facts">${renderSeed(id)}${row && html`<span class="tabular">${row.w}-${row.l}</span>`}${renderRace(row)}</span>`;
}

function isOut(id) {
  const { state } = session;
  const isOutOfPostseason = Boolean(state && state.teams) && isEliminated(state, id);
  return isOutOfPostseason || describeRace(findStandingsRow(id))?.standing === "out";
}

function renderSide(id, side, hasWon) {
  return html`<span class="game-side ${side} ${hasWon ? "won" : ""} ${isOut(id) ? "out" : ""}">${renderClub(id)}${renderFacts(id)}</span>`;
}

function renderScore(game, awayLost, homeLost) {
  const [awayScore, homeScore] = game.score;
  return html`<span class="game-score tabular"><span class="${awayLost ? "lost" : ""}">${awayScore}</span><span class="score-dash">-</span><span class="${homeLost ? "lost" : ""}">${homeScore}</span></span>`;
}

function renderMiddle(game, awayLost, homeLost) {
  const doubleheader =
    game.doubleheader && html`<span class="doubleheader">Game ${game.doubleheader}</span>`;
  const headline = game.score
    ? renderScore(game, awayLost, homeLost)
    : html`<span class="game-time">${game.state === "off" ? game.detail || "Postponed" : describeStart(game)}</span>`;
  return html`<span class="game-middle">${headline}<span class="game-status">${describeStatus(game)}${renderOutLights(game)}${doubleheader}</span></span>`;
}

function renderGame(game) {
  const [awayScore, homeScore] = game.score || [];
  const isFinal = game.state === "final";
  const awayLost = isFinal && awayScore < homeScore;
  const homeLost = isFinal && homeScore < awayScore;
  const awayWon = isFinal && awayScore > homeScore;
  const homeWon = isFinal && homeScore > awayScore;
  return html`<li class="game-row ${game.state} ${game.delay ? "delayed" : ""}">
    ${renderSide(game.away, "away", awayWon)}
    ${renderMiddle(game, awayLost, homeLost)}
    ${renderSide(game.home, "home", homeWon)}
  </li>`;
}

// A doubleheader's games sit together in game order, since MLB can list game 2 with the earlier start.
function orderDay(games) {
  const isSameMatchup = (game, other) => game.away === other.away && game.home === other.home;
  const findSlot = (game) =>
    Math.min(
      ...games
        .filter((other) => isSameMatchup(game, other))
        .map((other) => Date.parse(other.start)),
    );
  return games
    .map((game) => ({ game, slot: findSlot(game) }))
    .sort(
      (first, second) =>
        first.slot - second.slot ||
        (first.game.doubleheader || 0) - (second.game.doubleheader || 0),
    )
    .map(({ game }) => game);
}

function groupByDay(games, isNewestFirst) {
  const dates = [...new Set(games.map((game) => game.date))].sort();
  if (isNewestFirst) dates.reverse();
  return dates.map((date) => ({
    date,
    games: orderDay(games.filter((game) => game.date === date)),
  }));
}

function listGames(slate, list) {
  if (list === "previous") return slate.previous || [];
  if (list === "next") return slate.next || [];
  const { date, games, postponed = [] } = slate.today;
  return [...games, ...postponed].map((game) => ({ date, ...game }));
}

function describeMissingSlate() {
  if (session.activeYear !== session.currentSeason) return "Games show for the current season only";
  return "Games appear here as soon as the page can reach MLB";
}

export function renderGameList(slate, list) {
  if (!slate) return html`<p class="stand-empty">${describeMissingSlate()}</p>`;
  const games = listGames(slate, list);
  if (!games.length) return html`<p class="stand-empty">${EMPTY_LIST_TEXT[list]}</p>`;
  return html`${groupByDay(games, list === "previous").map(
    (day) => html`<h3 class="game-day">${formatGameDay(day.date)}</h3>
      <ul class="game-list">${day.games.map(renderGame)}</ul>`,
  )}`;
}

export function renderGames() {
  const slate = session.state && session.state.slate;
  for (const list of GAME_LISTS) setHtml(findGamePage(list), renderGameList(slate, list));
}

// The pages reach down to the page's bottom padding, so the space below a short list swipes too,
// and grow past it with a longer list.
function measureRoomBelow(pages) {
  const top = pages.getBoundingClientRect().top + scrollY;
  const bottomPadding = parseFloat(getComputedStyle(document.body).paddingBottom);
  return Math.floor(innerHeight - bottomPadding - top);
}

function fitPagesToShownList() {
  const pages = findGamePages();
  const height = Math.max(findGamePage(shownList).offsetHeight, measureRoomBelow(pages));
  pages.style.height = `${height}px`;
}

function markShownList(list) {
  shownList = list;
  selectTab(findGameTabs(), list);
  for (const other of GAME_LISTS) findGamePage(other).inert = other !== list;
  fitPagesToShownList();
}

/** @param {number} position runs from 0 at the first list to 2 at the last, between them mid-swipe */
function paintSwipe(position) {
  findGameTabList().style.setProperty("--swipe", String(position));
  for (const [index, button] of findGameTabs().entries()) {
    const nearness = Math.max(0, 1 - Math.abs(index - position));
    button.style.setProperty("--nearness", String(nearness));
  }
}

const readSwipePosition = (pages) => pages.scrollLeft / pages.clientWidth;
const findListLeft = (pages, list) => GAME_LISTS.indexOf(list) * pages.clientWidth;
const isAtList = (pages, list) => Math.abs(pages.scrollLeft - findListLeft(pages, list)) < 1;
const prefersReducedMotion = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
const chooseScrollBehavior = () => (prefersReducedMotion() ? "instant" : "smooth");

function scrollToList(list, behavior) {
  const pages = findGamePages();
  pages.scrollTo({ left: findListLeft(pages, list), behavior });
}

function scheduleSettle() {
  clearTimeout(settleTimer);
  settleTimer = setTimeout(settleSwipe, SETTLE_DELAY_MS);
}

// Changing the lists' height or inertness mid-swipe can stop Safari's swipe short of a list, so the
// shown list changes only once the lists come to rest, and a rest between lists goes on to the
// nearest one.
function settleSwipe() {
  const pages = findGamePages();
  if (isTouching || !pages.clientWidth) return;
  const list = scrollTarget || GAME_LISTS[Math.round(readSwipePosition(pages))];
  if (list !== shownList) markShownList(list);
  if (isAtList(pages, list)) scrollTarget = null;
  else scrollToList(list, chooseScrollBehavior());
}

function followSwipe() {
  const pages = findGamePages();
  if (!pages.clientWidth) return;
  paintSwipe(readSwipePosition(pages));
  scheduleSettle();
}

function showGameList(list) {
  markShownList(list);
  if (isAtList(findGamePages(), list)) return;
  scrollTarget = list;
  scrollToList(list, chooseScrollBehavior());
}

// A hidden view's pages lose their scroll position, so they find the shown list again whenever
// they come back into view or change width.
function realignPages() {
  const { clientWidth } = findGamePages();
  if (clientWidth === pagesWidth) return;
  pagesWidth = clientWidth;
  scrollTarget = null;
  scrollToList(shownList, "instant");
  paintSwipe(GAME_LISTS.indexOf(shownList));
  fitPagesToShownList();
}

function trackTouch(event) {
  const pages = findGamePages();
  isTouching = [...event.touches].some((touch) =>
    pages.contains(/** @type {Node} */ (touch.target)),
  );
  if (isTouching) scrollTarget = null;
  if (!isTouching) scheduleSettle();
}

function wireSwipe() {
  const pages = findGamePages();
  const releaseScrollTarget = () => (scrollTarget = null);
  const releaseOnSidewaysWheel = (event) => event.deltaX && releaseScrollTarget();
  pages.addEventListener("scroll", followSwipe, { passive: true });
  pages.addEventListener("pointerdown", releaseScrollTarget);
  pages.addEventListener("wheel", releaseOnSidewaysWheel, { passive: true });
  for (const type of ["touchstart", "touchend", "touchcancel"])
    pages.addEventListener(type, trackTouch, { passive: true });
  new ResizeObserver(realignPages).observe(pages);
  const fitObserver = new ResizeObserver(fitPagesToShownList);
  for (const list of GAME_LISTS) fitObserver.observe(findGamePage(list));
  fitObserver.observe(document.body);
  addEventListener("resize", fitPagesToShownList);
}

export function wireGameTabs() {
  wireTabs(findGameTabs(), showGameList);
  markShownList(shownList);
  paintSwipe(GAME_LISTS.indexOf(shownList));
  wireSwipe();
}
