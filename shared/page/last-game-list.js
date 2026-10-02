// The Games list someone was on, kept while they're away for less than an hour: long enough to
// glance at another app and come back to it, short enough that the next sitting starts on Today.

/** @typedef {"previous" | "today" | "next"} GameList */
/** @typedef {{ list: string, leftAt: number }} LeftGameList */

const LAST_GAME_LIST_KEY = "lastGameList";
const GAME_LISTS = ["previous", "today", "next"];

export const TODAY_AFTER_AWAY_MS = 60 * 60 * 1000;

/** @param {number} awayMs */
export const isAwayLong = (awayMs) => awayMs >= TODAY_AFTER_AWAY_MS;

/**
 * The list the Games view opens on: the one it was left on, unless that was an hour or more ago.
 * @param {LeftGameList | null} left
 * @param {number} now
 * @returns {GameList}
 */
export function chooseGameList(left, now) {
  const isKept = !!left && GAME_LISTS.includes(left.list) && !isAwayLong(now - left.leftAt);
  return isKept ? /** @type {GameList} */ (left.list) : "today";
}

// Storage can be empty or refuse access, as in a private window, so the page never depends on it.

/** @returns {LeftGameList | null} */
export function readLastGameList() {
  try {
    return JSON.parse(localStorage.getItem(LAST_GAME_LIST_KEY) ?? "null");
  } catch {
    return null;
  }
}

/** @param {string} list */
export function saveLastGameList(list) {
  try {
    localStorage.setItem(LAST_GAME_LIST_KEY, JSON.stringify({ list, leftAt: Date.now() }));
  } catch {
    /* the next load opens on Today instead */
  }
}
