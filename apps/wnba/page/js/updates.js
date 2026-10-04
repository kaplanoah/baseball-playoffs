// The Updates box: each playoff game finished since this device last dismissed it, with where its
// series stood after it, each opening the game's sheet, and the release notes out since then.
// Nobody signs in, and people share the page's address, so each device keeps its own dismissal,
// and only phones and tablets show the box.

import { readEasternDay } from "#shared/days.js";
import { isTouchDevice } from "#shared/device.js";
import { html } from "#shared/html.js";
import { listFreshNotes, showUpdates } from "#shared/updates.js";
import { renderTeamName } from "./clubs.js";
import { renderOpenButton } from "./games-view.js";
import { RELEASE_NOTES } from "./release-notes.js";
import { session } from "./session.js";
import { ROUNDS } from "./snapshot.js";

/** @typedef {import("./games-view.js").Game} Game */
/** @typedef {{ at: number, day: string, text: import("#shared/html.js").Markup, action: import("#shared/html.js").Markup | false }} PlayoffWin */

const SEEN_KEY = "updatesSeenAt";

// Null when this device has never dismissed the box, or its storage refuses access, as in a
// private window.
function readSeenAt() {
  try {
    const seenAt = Number(localStorage.getItem(SEEN_KEY));
    return seenAt > 0 ? seenAt : null;
  } catch {
    return null;
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

// A game that ends after midnight still counts on the league's day it started.
/**
 * @param {Game} game
 * @param {number} finishedAt
 */
function readLeagueDay(game, finishedAt) {
  const startedAt = Date.parse(game.start ?? "");
  return readEasternDay(Number.isFinite(startedAt) ? startedAt : finishedAt).date;
}

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
  const result = html`<b>${renderTeamName(winner.team)}</b> beat the <b>${renderTeamName(loser.team)}</b> ${winner.score}-${loser.score}`;
  const score = html`<span class="series-score">${own}&ndash;${theirs}</span>`;
  if (own === Math.ceil(round.bestOf / 2)) return html`${result} to win the ${round.name} ${score}`;
  return html`${result} in Game&nbsp;${game.number}&nbsp;&mdash; ${describeStanding(own, theirs)} the ${round.name} ${score}`;
}

/**
 * @param {Game} game
 * @param {Game[]} games the season's games
 * @returns {PlayoffWin}
 */
function describePlayoffWin(game, games) {
  const at = readFinishedAt(game);
  return {
    at,
    day: readLeagueDay(game, at),
    text: describeWin(game, games),
    action: renderOpenButton(game),
  };
}

/**
 * Every playoff game the season has finished, newest first.
 * @param {{ games?: Game[] } | null} season
 * @returns {PlayoffWin[]}
 */
export function listPlayoffWins(season) {
  const games = season?.games ?? [];
  return games
    .filter((game) => isPlayoffFinal(game) && Number.isFinite(readFinishedAt(game)))
    .map((game) => describePlayoffWin(game, games))
    .sort((first, second) => second.at - first.at);
}

/**
 * Just before the first of the latest day's finals.
 * @param {PlayoffWin[]} wins newest first
 */
function findLatestDayStart(wins) {
  const latestDay = wins.filter((win) => win.day === wins[0].day);
  return Math.min(...latestDay.map((win) => win.at)) - 1;
}

// A device that has never dismissed the box starts it at the latest day's finals, not the whole
// postseason, and keeps that start, so nothing that finishes later is skipped.
/** @param {PlayoffWin[]} wins newest first */
function readOrStartSeenAt(wins) {
  const seenAt = readSeenAt();
  if (seenAt != null || !wins.length) return seenAt ?? 0;
  const start = findLatestDayStart(wins);
  saveSeenAt(start);
  return start;
}

const findPanel = () => /** @type {HTMLElement} */ (document.getElementById("updates"));

/** The playoff games finished since this device last dismissed the box, newest first. */
export function listFreshUpdates() {
  const wins = listPlayoffWins(session.season);
  const seenAt = readOrStartSeenAt(wins);
  return wins.filter((win) => win.at > seenAt);
}

/** The release notes out since this device last dismissed the box. */
const listFreshReleaseNotes = () =>
  listFreshNotes(RELEASE_NOTES, readOrStartSeenAt(listPlayoffWins(session.season)));

// The newest update's time is the Worker's, and a note's is the one it was given, so the
// dismissal doesn't depend on this device's clock.
function dismissUpdates() {
  const times = [...listFreshUpdates(), ...listFreshReleaseNotes()].map((item) => item.at);
  if (times.length) saveSeenAt(Math.max(...times));
  drawUpdates();
}

export function drawUpdates() {
  const isShown = isTouchDevice();
  showUpdates(findPanel(), isShown ? listFreshUpdates() : [], {
    dismiss: dismissUpdates,
    notes: isShown ? listFreshReleaseNotes() : [],
  });
}
