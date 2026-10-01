import { createPager } from "./pager.js";

// The Games view's Previous, Today, and Next lists, which open on Today whenever they come back
// into view.

/** @typedef {import("./html.js").Markup} Markup */
/** @typedef {"previous" | "today" | "next"} GameList */

/** @type {ReturnType<typeof createPager> | null} */
let gamePager = null;

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
    openOn: "today",
    opensFirstOnReturn: true,
  });
}

/** @param {(list: GameList) => Markup} renderList */
export function fillGameLists(renderList) {
  gamePager.fill(/** @type {(key: string) => Markup} */ (renderList));
}
