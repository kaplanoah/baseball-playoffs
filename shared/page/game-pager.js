import {
  chooseGameList,
  isAwayLong,
  readLastGameList,
  saveLastGameList,
} from "./last-game-list.js";
import { createPager } from "./pager.js";
import { watchTimeAway } from "./resume.js";

// The Games view's Previous, Today, and Next lists, which keep the list someone was on until
// they've been away an hour.

/** @typedef {import("./html.js").Markup} Markup */
/** @typedef {import("./last-game-list.js").GameList} GameList */

/** @type {ReturnType<typeof createPager> | null} */
let gamePager = null;

const saveShownList = () => saveLastGameList(gamePager.readShownList());

// Leaving the screen is the last moment the page is sure to run, whether it then reloads, sleeps,
// or is dropped.
function keepShownList() {
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) saveShownList();
  });
  addEventListener("pagehide", saveShownList);
}

/** @param {number} awayMs */
function showTodayAfterLongAway(awayMs) {
  if (isAwayLong(awayMs)) gamePager.switchToList("today");
}

/** Builds the pill and the three lists inside the page's #gamePager, and wires them. */
export function startGamePager() {
  gamePager = createPager(/** @type {HTMLElement} */ (document.getElementById("gamePager")), {
    label: "Games",
    idPrefix: "games",
    lists: [
      { key: "previous", name: "Previous" },
      { key: "today", name: "Today" },
      { key: "next", name: "Next" },
    ],
    openOn: chooseGameList(readLastGameList(), Date.now()),
  });
  keepShownList();
  watchTimeAway(showTodayAfterLongAway);
}

/** @param {(list: GameList) => Markup} renderList */
export function fillGameLists(renderList) {
  gamePager.fill(/** @type {(key: string) => Markup} */ (renderList));
}
