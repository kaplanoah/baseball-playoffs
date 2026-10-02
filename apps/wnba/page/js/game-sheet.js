// The sheet a game's row opens: the two teams across the score, then the game's box score once
// it has started, or a preview before it does. Phones show it as a sheet from the bottom that a
// swipe down closes, wider screens as a modal, like Settings.

import { html, joinWithSeparator, setHtml } from "#shared/html.js";
import { watchGameOpens } from "#shared/game-row.js";
import { redrawSheet } from "#shared/sheet-resize.js";
import { openSheet, wireSheet } from "#shared/sheet.js";
import { renderBoxScore, renderPendingBoxScore } from "./box-score-view.js";
import { renderClub } from "./clubs.js";
import { describeDay, readGameDay } from "./days.js";
import { fetchBoxScore, fetchPreview } from "./game-details-fetch.js";
import { findLoser, nameGame, renderHeadline, renderStatus } from "./games-view.js";
import { renderPreview } from "./preview-view.js";
import { describeSeriesStanding } from "./series.js";
import { session } from "./session.js";
import { renderSheetMessage } from "./sheet-parts.js";
import { POLL_LIVE_MS } from "./snapshot.js";

/** @typedef {import("./games-view.js").Game} Game */
/** @typedef {{ id: string, kind: "box" | "preview", details: any, error: any }} ShownGame */

// The game the sheet shows. Each opening, and each switch to a box score, is a new one, so an
// answer that arrives after it changed is dropped.
/** @type {ShownGame | null} */
let shown = null;
let refreshTimer = 0;

const findDialog = () => /** @type {HTMLDialogElement} */ (document.getElementById("gameDialog"));
const findElement = (id) => /** @type {HTMLElement} */ (document.getElementById(id));

/** @param {string} id */
const findGame = (id) => session.season?.games?.find((game) => game.id === id) ?? null;

/** @param {Game} game */
const chooseKind = (game) => (game.state === "pre" ? "preview" : "box");

/** @param {Game} game */
function renderWhen(game) {
  const series = session.season?.series?.find((each) => each.id === game.series);
  const day = readGameDay(game);
  return joinWithSeparator(
    [describeSeriesStanding(series), day && describeDay(day, Date.now())].filter(Boolean),
  );
}

/** @param {string} team */
function describeRecord(team) {
  const row = session.season?.standings?.find((each) => each.team === team);
  return row ? `${row.wins}-${row.losses}` : "";
}

/**
 * @param {Game} game
 * @param {"away" | "home"} place
 */
function renderFaceOffSide(game, place) {
  const side = game[place];
  const isLost = findLoser(game) === place;
  const bonus = game.state === "live" && side.isInBonus && html`<span class="bonus">Bonus</span>`;
  return html`<div class="faceoff-side ${place}${isLost ? " lost" : ""}">
    ${renderClub(side.team, { seed: side.seed })}
    <span class="faceoff-record tabular">${describeRecord(side.team)}</span>
    ${bonus}
  </div>`;
}

/** @param {Game} game */
const renderFaceOff = (game) =>
  html`<div class="faceoff">
    ${renderFaceOffSide(game, "away")}
    <div class="faceoff-middle">
      ${renderHeadline(game)}<span class="faceoff-status">${renderStatus(game)}</span>
    </div>
    ${renderFaceOffSide(game, "home")}
  </div>`;

/** @param {ShownGame} opened */
const isLoading = (opened) => !opened.details && !opened.error;

/**
 * @param {ShownGame} opened
 * @param {Game} game
 */
function renderDetails(opened, game) {
  const teams = { away: game.away.team, home: game.home.team };
  if (opened.kind === "preview") {
    const meetings = opened.details?.meetings ?? null;
    return renderPreview({ teams, season: session.season, meetings, isLoading: isLoading(opened) });
  }
  if (opened.error) return renderSheetMessage(describeProblem(opened.error));
  return opened.details ? renderBoxScore(opened.details) : renderPendingBoxScore(teams);
}

function renderSheet() {
  const game = shown && findGame(shown.id);
  if (!game) return;
  const body = findElement("gameBody");
  redrawSheet(findDialog(), () => {
    findElement("gameTitle").textContent = nameGame(game);
    setHtml(findElement("gameWhen"), renderWhen(game));
    setHtml(body, html`${renderFaceOff(game)}${renderDetails(shown, game)}`);
    body.setAttribute("aria-busy", String(isLoading(shown)));
  });
}

/** @param {any} error why the box score didn't load */
function describeProblem(error) {
  if (error?.status === 404) return "The league hasn't posted a box score for this game yet.";
  return "Couldn't load the box score. Close and try again in a minute.";
}

/** @param {Game} game */
const loadDetails = (game) =>
  chooseKind(game) === "box"
    ? fetchBoxScore(game.id)
    : fetchPreview({ season: session.year, away: game.away.team, home: game.home.team });

/** @param {ShownGame} opened */
const isLiveBoxScore = (opened) => opened.kind === "box" && findGame(opened.id)?.state === "live";

// A live game's box score is read again as often as its score, until the sheet closes. A read
// that fails keeps the box score already showing.
async function refreshDetails() {
  const opened = shown;
  const game = findGame(opened.id);
  clearTimeout(refreshTimer);
  if (!game) return;
  try {
    const details = await loadDetails(game);
    if (shown !== opened) return;
    opened.details = details;
    opened.error = null;
  } catch (error) {
    if (shown !== opened) return;
    if (!opened.details) opened.error = error;
  }
  renderSheet();
  if (isLiveBoxScore(opened)) refreshTimer = window.setTimeout(refreshDetails, POLL_LIVE_MS);
}

/** @param {string} id */
function showGame(id) {
  const game = findGame(id);
  shown = { id, kind: chooseKind(game), details: null, error: null };
  renderSheet();
  refreshDetails();
}

/** @param {string} id */
function openGameSheet(id) {
  if (!findGame(id)) return;
  showGame(id);
  openSheet(findDialog());
}

/**
 * Redraws the open sheet from the season as the store has it now. A game that started since the
 * sheet opened switches from its preview to its box score.
 */
export function refreshGameSheet() {
  const game = shown && findGame(shown.id);
  if (!game) return;
  if (chooseKind(game) !== shown.kind) showGame(shown.id);
  else renderSheet();
}

/** @param {HTMLElement} button */
const findRowGame = (button) =>
  /** @type {HTMLElement} */ (button.closest("[data-game]")).dataset.game;

/** @param {HTMLElement} button */
const openFromRow = (button) => openGameSheet(findRowGame(button));

/** @param {HTMLElement} button */
function prepareFromRow(button) {
  const game = findGame(findRowGame(button));
  if (game) loadDetails(game).catch(() => {});
}

function forgetGame() {
  shown = null;
  clearTimeout(refreshTimer);
}

export function startGameSheet() {
  const dialog = findDialog();
  watchGameOpens(findElement("gamePager"), { open: openFromRow, prepare: prepareFromRow });
  wireSheet(dialog, { doneButton: findElement("gameDoneBtn") });
  dialog.addEventListener("close", forgetGame);
}
