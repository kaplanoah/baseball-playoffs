import { html, setHtml } from "./html.js";
import { selectTab, wireTabs } from "./tabs.js";

// The Games view's three lists side by side under a pill, as game-pager.css lays them out. A tap
// on the pill or a swipe moves between them, and the view opens on Today whenever it comes back
// into view. An app fills the lists; the pager only moves between them.

/** @typedef {import("./html.js").Markup} Markup */
/** @typedef {"previous" | "today" | "next"} GameList */

/** @type {GameList[]} */
const GAME_LISTS = ["previous", "today", "next"];
const LIST_NAMES = { previous: "Previous", today: "Today", next: "Next" };
const SETTLE_DELAY_MS = 150;

/** @type {GameList} */
let shownList = "today";
// The list a tapped tab is scrolling to, which the lists settle on even when they come to rest early.
/** @type {GameList | null} */
let scrollTarget = null;
let pagesWidth = 0;
/** @type {ReturnType<typeof setTimeout> | undefined} */
let settleTimer;
let isTouching = false;

const findPager = () => document.getElementById("gamePager");
const findGameTabs = () =>
  /** @type {HTMLButtonElement[]} */ ([...findPager().querySelectorAll("[role=tab]")]);
const findGameTabList = () =>
  /** @type {HTMLElement} */ (findPager().querySelector("[role=tablist]"));
const findGameTabsBar = () => document.getElementById("gameTabsBar");
const findGamePages = () => document.getElementById("gamePages");
/** @param {GameList} list */
const findGamePage = (list) => document.getElementById(`games-${list}`);

/** @param {GameList} list */
function renderGameTab(list) {
  const isShown = list === shownList;
  return html`<button
    type="button"
    role="tab"
    id="games-tab-${list}"
    data-tab="${list}"
    aria-controls="games-${list}"
    aria-selected="${String(isShown)}"
    tabindex="${isShown ? "0" : "-1"}"
    class="${isShown ? "active" : ""}"
  >
    ${LIST_NAMES[list]}
  </button>`;
}

/** @param {GameList} list */
const renderGamePage = (list) =>
  html`<div
    id="games-${list}"
    class="game-page"
    role="tabpanel"
    aria-labelledby="games-tab-${list}"
  ></div>`;

const renderPager = () =>
  html`<div id="gameTabsBar" class="game-tabs-bar">
      <div class="game-tabs" role="tablist" aria-label="Games">
        <span class="game-tabs-thumb" aria-hidden="true"></span>
        ${GAME_LISTS.map(renderGameTab)}
      </div>
    </div>
    <div id="gamePages" class="game-pages">${GAME_LISTS.map(renderGamePage)}</div>`;

// A list is never shorter than the space under the pill, so the lists can always rise to just
// under it: the list a swipe brings in then starts there, even from far down a longer one.
function measureRoomUnderBar() {
  const bottomPadding = parseFloat(getComputedStyle(document.body).paddingBottom);
  return Math.floor(innerHeight - bottomPadding - findGameTabsBar().offsetHeight);
}

function fitPagesToShownList() {
  const height = Math.max(findGamePage(shownList).offsetHeight, measureRoomUnderBar());
  findGamePages().style.height = `${height}px`;
}

// The page's scroll position that puts the top of the lists just under the pill.
const measureListsTopScroll = () =>
  findGamePages().getBoundingClientRect().top + scrollY - findGameTabsBar().offsetHeight;

// The lists share the page's scroll, so once it has carried the shown list up under the pill, the
// others move down by as much, and a swipe brings each in from its top.
function alignHiddenLists() {
  if (!findGamePages().clientWidth) return;
  const offset = Math.max(0, scrollY - measureListsTopScroll());
  findGameTabsBar().classList.toggle("stuck", offset > 0);
  for (const list of GAME_LISTS) {
    const isOffset = offset > 0 && list !== shownList;
    findGamePage(list).style.transform = isOffset ? `translateY(${offset}px)` : "";
  }
}

// A newly shown list keeps its place on screen: the page scrolls back by as much as it was moved.
/** @param {GameList} list */
function markShownList(list) {
  const listsTopScroll = measureListsTopScroll();
  const isNewList = list !== shownList;
  shownList = list;
  selectTab(findGameTabs(), list);
  for (const other of GAME_LISTS) findGamePage(other).inert = other !== list;
  fitPagesToShownList();
  if (isNewList && scrollY > listsTopScroll) scrollTo({ top: listsTopScroll, behavior: "instant" });
  alignHiddenLists();
}

/** @param {number} position runs from 0 at the first list to 2 at the last, between them mid-swipe */
function paintSwipe(position) {
  findGameTabList().style.setProperty("--swipe", String(position));
  for (const [index, button] of findGameTabs().entries()) {
    const nearness = Math.max(0, 1 - Math.abs(index - position));
    button.style.setProperty("--nearness", String(nearness));
  }
}

/** @param {HTMLElement} pages */
const readSwipePosition = (pages) => pages.scrollLeft / pages.clientWidth;
/**
 * @param {HTMLElement} pages
 * @param {GameList} list
 */
const findListLeft = (pages, list) => GAME_LISTS.indexOf(list) * pages.clientWidth;
/**
 * @param {HTMLElement} pages
 * @param {GameList} list
 */
const isAtList = (pages, list) => Math.abs(pages.scrollLeft - findListLeft(pages, list)) < 1;
const prefersReducedMotion = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
/** @returns {ScrollBehavior} */
const chooseScrollBehavior = () => (prefersReducedMotion() ? "instant" : "smooth");

/**
 * @param {GameList} list
 * @param {ScrollBehavior} behavior
 */
function scrollToList(list, behavior) {
  const pages = findGamePages();
  pages.scrollTo({ left: findListLeft(pages, list), behavior });
}

function scheduleSettle() {
  clearTimeout(settleTimer);
  settleTimer = setTimeout(settleSwipe, SETTLE_DELAY_MS);
}

// Changing the lists' height or inertness mid-swipe can stop Safari's swipe short of a list, so the
// shown list changes only once the lists come to rest on it, and a rest between lists goes on to
// the nearest one.
function settleSwipe() {
  const pages = findGamePages();
  if (isTouching || !pages.clientWidth) return;
  const list = scrollTarget || GAME_LISTS[Math.round(readSwipePosition(pages))];
  if (!isAtList(pages, list)) {
    scrollToList(list, chooseScrollBehavior());
    return;
  }
  scrollTarget = null;
  if (list !== shownList) markShownList(list);
}

function followSwipe() {
  const pages = findGamePages();
  if (!pages.clientWidth) return;
  paintSwipe(readSwipePosition(pages));
  scheduleSettle();
}

/** @param {GameList} list */
function showGameList(list) {
  if (isAtList(findGamePages(), list)) {
    markShownList(list);
    return;
  }
  selectTab(findGameTabs(), list);
  scrollTarget = list;
  scrollToList(list, chooseScrollBehavior());
}

/** @param {GameList} list */
function jumpToList(list) {
  scrollTarget = null;
  scrollToList(list, "instant");
  paintSwipe(GAME_LISTS.indexOf(list));
  markShownList(list);
}

// Games open on today's list whenever they come back into view, and keep the shown list when only
// the screen's width changes. A hidden view's pages lose their scroll position either way.
function realignPages() {
  const { clientWidth } = findGamePages();
  if (clientWidth === pagesWidth) return;
  const wasHidden = !pagesWidth;
  pagesWidth = clientWidth;
  if (clientWidth) jumpToList(wasHidden ? "today" : shownList);
}

function showTodayOnReturn() {
  if (!document.hidden && findGamePages().clientWidth) jumpToList("today");
}

/** @param {TouchEvent} event */
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
  /** @param {WheelEvent} event */
  const releaseOnSidewaysWheel = (event) => event.deltaX && releaseScrollTarget();
  pages.addEventListener("scroll", followSwipe, { passive: true });
  pages.addEventListener("pointerdown", releaseScrollTarget);
  pages.addEventListener("wheel", releaseOnSidewaysWheel, { passive: true });
  for (const type of ["touchstart", "touchend", "touchcancel"])
    pages.addEventListener(type, trackTouch, { passive: true });
  new ResizeObserver(realignPages).observe(pages);
  const fitObserver = new ResizeObserver(fitPagesToShownList);
  for (const list of GAME_LISTS) fitObserver.observe(findGamePage(list));
  addEventListener("resize", fitPagesToShownList);
  addEventListener("scroll", alignHiddenLists, { passive: true });
  document.addEventListener("visibilitychange", showTodayOnReturn);
}

/** Builds the pill and the three lists inside the page's #gamePager, and wires them. */
export function startGamePager() {
  setHtml(findPager(), renderPager());
  wireTabs(findGameTabs(), showGameList);
  markShownList(shownList);
  paintSwipe(GAME_LISTS.indexOf(shownList));
  wireSwipe();
}

/** @param {(list: GameList) => Markup} renderList */
export function fillGameLists(renderList) {
  for (const list of GAME_LISTS) setHtml(findGamePage(list), renderList(list));
}
