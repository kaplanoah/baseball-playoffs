import { html, setHtml } from "./html.js";
import { selectTab, wireTabs } from "./tabs.js";

// Lists side by side under a pill, as pager.css lays them out, like the Games view's Previous,
// Today, and Next. A tap on the pill or a swipe moves between them. An app fills the lists; the
// pager only moves between them.

/** @typedef {import("./html.js").Markup} Markup */
/** @typedef {{ key: string, name: string }} PagerList */
/**
 * @typedef {object} PagerOptions
 * @property {string} label the pill's name for screen readers
 * @property {string} idPrefix starts the id of each element the pager builds
 * @property {PagerList[]} lists
 * @property {string} openOn the list shown first
 * @property {boolean} [opensFirstOnReturn] whether the pager goes back to `openOn` each time it
 *   comes back into view, rather than keeping the list it showed
 */

const SETTLE_DELAY_MS = 150;

const prefersReducedMotion = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
/** @returns {ScrollBehavior} */
const chooseScrollBehavior = () => (prefersReducedMotion() ? "instant" : "smooth");

/**
 * Builds the pill and the lists inside `root`, and wires them.
 * @param {HTMLElement} root
 * @param {PagerOptions} options
 * @returns {{ fill: (renderList: (key: string) => Markup) => void }}
 */
export function createPager(root, { label, idPrefix, lists, openOn, opensFirstOnReturn = false }) {
  const keys = lists.map((list) => list.key);
  let shownList = openOn;
  // The list a tapped tab is scrolling to, which the lists settle on even when they come to rest early.
  /** @type {string | null} */
  let scrollTarget = null;
  let pagesWidth = 0;
  /** @type {ReturnType<typeof setTimeout> | undefined} */
  let settleTimer;
  let isTouching = false;

  /** @param {string} key */
  const findPage = (key) =>
    /** @type {HTMLElement} */ (document.getElementById(`${idPrefix}-${key}`));
  const findTabs = () =>
    /** @type {HTMLButtonElement[]} */ ([...root.querySelectorAll("[role=tab]")]);
  const findTabList = () => /** @type {HTMLElement} */ (root.querySelector("[role=tablist]"));
  const findBar = () => /** @type {HTMLElement} */ (document.getElementById(`${idPrefix}-bar`));
  const findPages = () => /** @type {HTMLElement} */ (document.getElementById(`${idPrefix}-pages`));

  /** @param {PagerList} list */
  function renderTab({ key, name }) {
    const isShown = key === shownList;
    return html`<button
      type="button"
      role="tab"
      id="${idPrefix}-tab-${key}"
      data-tab="${key}"
      aria-controls="${idPrefix}-${key}"
      aria-selected="${String(isShown)}"
      tabindex="${isShown ? "0" : "-1"}"
      class="${isShown ? "active" : ""}"
    >
      ${name}
    </button>`;
  }

  /** @param {PagerList} list */
  const renderPage = ({ key }) =>
    html`<div
      id="${idPrefix}-${key}"
      class="pager-page"
      role="tabpanel"
      aria-labelledby="${idPrefix}-tab-${key}"
    ></div>`;

  const renderPager = () =>
    html`<div id="${idPrefix}-bar" class="pager-bar">
        <div class="pager-tabs" role="tablist" aria-label="${label}">
          <span class="pager-thumb" aria-hidden="true"></span>
          ${lists.map(renderTab)}
        </div>
      </div>
      <div id="${idPrefix}-pages" class="pager-pages">${lists.map(renderPage)}</div>`;

  // A list is never shorter than the space under the pill, so the lists can always rise to just
  // under it: the list a swipe brings in then starts there, even from far down a longer one.
  function measureRoomUnderBar() {
    const bottomPadding = parseFloat(getComputedStyle(document.body).paddingBottom);
    return Math.floor(innerHeight - bottomPadding - findBar().offsetHeight);
  }

  function fitPagesToShownList() {
    const height = Math.max(findPage(shownList).offsetHeight, measureRoomUnderBar());
    findPages().style.height = `${height}px`;
  }

  // The page's scroll position that puts the top of the lists just under the pill.
  const measureListsTopScroll = () =>
    findPages().getBoundingClientRect().top + scrollY - findBar().offsetHeight;

  // The lists share the page's scroll, so once it has carried the shown list up under the pill,
  // the others move down by as much, and a swipe brings each in from its top.
  function alignHiddenLists() {
    if (!findPages().clientWidth) return;
    const offset = Math.max(0, scrollY - measureListsTopScroll());
    findBar().classList.toggle("stuck", offset > 0);
    for (const key of keys) {
      const isOffset = offset > 0 && key !== shownList;
      findPage(key).style.transform = isOffset ? `translateY(${offset}px)` : "";
    }
  }

  // A newly shown list keeps its place on screen: the page scrolls back by as much as it was moved.
  /** @param {string} key */
  function markShownList(key) {
    const listsTopScroll = measureListsTopScroll();
    const isNewList = key !== shownList;
    shownList = key;
    selectTab(findTabs(), key);
    for (const other of keys) findPage(other).inert = other !== key;
    fitPagesToShownList();
    if (isNewList && scrollY > listsTopScroll)
      scrollTo({ top: listsTopScroll, behavior: "instant" });
    alignHiddenLists();
  }

  /** @param {number} position runs from 0 at the first list to the last's index, between them mid-swipe */
  function paintSwipe(position) {
    findTabList().style.setProperty("--swipe", String(position));
    for (const [index, button] of findTabs().entries()) {
      const nearness = Math.max(0, 1 - Math.abs(index - position));
      button.style.setProperty("--nearness", String(nearness));
    }
  }

  /** @param {HTMLElement} pages */
  const readSwipePosition = (pages) => pages.scrollLeft / pages.clientWidth;
  /**
   * @param {HTMLElement} pages
   * @param {string} key
   */
  const findListLeft = (pages, key) => keys.indexOf(key) * pages.clientWidth;
  /**
   * @param {HTMLElement} pages
   * @param {string} key
   */
  const isAtList = (pages, key) => Math.abs(pages.scrollLeft - findListLeft(pages, key)) < 1;

  /**
   * @param {string} key
   * @param {ScrollBehavior} behavior
   */
  function scrollToList(key, behavior) {
    const pages = findPages();
    pages.scrollTo({ left: findListLeft(pages, key), behavior });
  }

  function scheduleSettle() {
    clearTimeout(settleTimer);
    settleTimer = setTimeout(settleSwipe, SETTLE_DELAY_MS);
  }

  // Changing the lists' height or inertness mid-swipe can stop Safari's swipe short of a list, so
  // the shown list changes only once the lists come to rest on it, and a rest between lists goes
  // on to the nearest one.
  function settleSwipe() {
    const pages = findPages();
    if (isTouching || !pages.clientWidth) return;
    const key = scrollTarget || keys[Math.round(readSwipePosition(pages))];
    if (!isAtList(pages, key)) {
      scrollToList(key, chooseScrollBehavior());
      return;
    }
    scrollTarget = null;
    if (key !== shownList) markShownList(key);
  }

  function followSwipe() {
    const pages = findPages();
    if (!pages.clientWidth) return;
    paintSwipe(readSwipePosition(pages));
    scheduleSettle();
  }

  /** @param {string} key */
  function showList(key) {
    if (isAtList(findPages(), key)) {
      markShownList(key);
      return;
    }
    selectTab(findTabs(), key);
    scrollTarget = key;
    scrollToList(key, chooseScrollBehavior());
  }

  /** @param {string} key */
  function jumpToList(key) {
    scrollTarget = null;
    scrollToList(key, "instant");
    paintSwipe(keys.indexOf(key));
    markShownList(key);
  }

  // A hidden view's pages lose their scroll position, so the pager jumps back to its list each time
  // it comes into view, and keeps the shown list when only the screen's width changes.
  function realignPages() {
    const { clientWidth } = findPages();
    if (clientWidth === pagesWidth) return;
    const wasHidden = !pagesWidth;
    pagesWidth = clientWidth;
    if (clientWidth) jumpToList(wasHidden && opensFirstOnReturn ? openOn : shownList);
  }

  function showFirstOnReturn() {
    if (!document.hidden && findPages().clientWidth) jumpToList(openOn);
  }

  /** @param {TouchEvent} event */
  function trackTouch(event) {
    const pages = findPages();
    isTouching = [...event.touches].some((touch) =>
      pages.contains(/** @type {Node} */ (touch.target)),
    );
    if (isTouching) scrollTarget = null;
    if (!isTouching) scheduleSettle();
  }

  function wireSwipe() {
    const pages = findPages();
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
    for (const key of keys) fitObserver.observe(findPage(key));
    addEventListener("resize", fitPagesToShownList);
    addEventListener("scroll", alignHiddenLists, { passive: true });
    if (opensFirstOnReturn) document.addEventListener("visibilitychange", showFirstOnReturn);
  }

  root.classList.add("pager");
  setHtml(root, renderPager());
  findTabList().style.setProperty("--list-count", String(keys.length));
  wireTabs(findTabs(), showList);
  markShownList(shownList);
  paintSwipe(keys.indexOf(shownList));
  wireSwipe();

  return {
    fill(renderList) {
      for (const key of keys) setHtml(findPage(key), renderList(key));
    },
  };
}
