// The Updates box: each playoff game finished since this device last dismissed it, with where its
// series stood after it. Nobody signs in, and people share the page's address, so each device
// keeps its own dismissal, and only phones and tablets show the box.

import { isTouchDevice } from "#shared/device.js";
import { html } from "#shared/html.js";
import { showUpdates } from "#shared/updates.js";
import { nameTeam } from "./series.js";
import { session } from "./session.js";
import { ROUNDS } from "./snapshot.js";

/** @typedef {import("./games-view.js").Game} Game */

const SEEN_KEY = "updatesSeenAt";

// Storage can be empty or refuse access, as in a private window, so the box then lists them all.
function readSeenAt() {
  try {
    return Number(localStorage.getItem(SEEN_KEY)) || 0;
  } catch {
    return 0;
  }
}

/** @param {number} at */
function saveSeenAt(at) {
  try {
    localStorage.setItem(SEEN_KEY, String(at));
  } catch {
    // The box shows the same updates again next time.
  }
}

/** @param {Game} game */
const isPlayoffFinal = (game) =>
  game.state === "final" &&
  !!game.series &&
  !!game.round &&
  game.away.score != null &&
  game.home.score != null &&
  game.away.score !== game.home.score;

// The feeds give no time a game ended but the Worker's first sight of it final, so a game found
// final without being seen live goes by its start.
/** @param {Game} game */
const readFinishedAt = (game) => Date.parse(game.end ?? game.start ?? "");

/**
 * The side that won a finished game, and the side that lost it.
 * @param {Game} game
 */
const findResult = (game) =>
  /** @type {number} */ (game.away.score) > /** @type {number} */ (game.home.score)
    ? { winner: game.away, loser: game.home }
    : { winner: game.home, loser: game.away };

/**
 * Each team's wins in a series through one of its games.
 * @param {Game[]} games
 * @param {Game} through
 */
function countSeriesWins(games, through) {
  /** @type {Record<string, number>} */
  const wins = {};
  for (const game of games) {
    if (game.series !== through.series || !isPlayoffFinal(game)) continue;
    if ((game.number ?? 0) > (through.number ?? 0)) continue;
    const winner = findResult(game).winner.team;
    if (winner) wins[winner] = (wins[winner] ?? 0) + 1;
  }
  return wins;
}

/**
 * @param {number} own
 * @param {number} theirs
 */
const describeStanding = (own, theirs) =>
  own > theirs ? "lead" : own === theirs ? "tie" : "trail";

/**
 * A game's winner over its loser, and where their series stood after it.
 * @param {Game} game
 * @param {Game[]} games the season's games
 */
function describeWin(game, games) {
  const { winner, loser } = findResult(game);
  const round = ROUNDS[/** @type {number} */ (game.round)];
  const wins = countSeriesWins(games, game);
  const own = wins[winner.team ?? ""] ?? 0;
  const theirs = wins[loser.team ?? ""] ?? 0;
  const result = html`<b>${nameTeam(winner.team)}</b> beat the <b>${nameTeam(loser.team)}</b> ${winner.score}-${loser.score}`;
  const score = html`<span class="series-score">${own}&ndash;${theirs}</span>`;
  if (own === Math.ceil(round.bestOf / 2)) return html`${result} to win the ${round.name} ${score}`;
  return html`${result} in Game&nbsp;${game.number}&nbsp;&mdash; ${describeStanding(own, theirs)} the ${round.name} ${score}`;
}

/**
 * Every playoff game the season has finished, newest first.
 * @param {{ games?: Game[] } | null} season
 */
export function listPlayoffWins(season) {
  const games = season?.games ?? [];
  return games
    .filter(isPlayoffFinal)
    .map((game) => ({ at: readFinishedAt(game), text: describeWin(game, games) }))
    .filter((update) => Number.isFinite(update.at))
    .sort((first, second) => second.at - first.at);
}

const findPanel = () => /** @type {HTMLElement} */ (document.getElementById("updates"));

function listFreshUpdates() {
  const seenAt = readSeenAt();
  return listPlayoffWins(session.season).filter((update) => update.at > seenAt);
}

// The newest update's time is the Worker's, so the dismissal doesn't depend on this device's clock.
function dismissUpdates() {
  const fresh = listFreshUpdates();
  if (fresh.length) saveSeenAt(Math.max(...fresh.map((update) => update.at)));
  drawUpdates();
}

export function drawUpdates() {
  const updates = isTouchDevice() ? listFreshUpdates() : [];
  showUpdates(findPanel(), updates, { dismiss: dismissUpdates });
}
