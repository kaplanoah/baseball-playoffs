import { html, joinWithSeparator } from "#shared/html.js";
import { renderClub } from "./clubs.js";
import { countDaysBetween, describeDay, formatStartTime, readGameDay } from "./days.js";
import { describeSeriesStanding } from "./series.js";
import { ROUNDS } from "./snapshot.js";

/** @typedef {import("./series.js").Series} Series */
/** @typedef {{ team: string | null, seed: number | null, score: number | null, isInBonus: boolean }} GameSide */
/** @typedef {{ id: string, round: number | null, series: string | null, number: number | null, start: string | null, state: string, status: string, isTimeSet: boolean, period: number | null, clock: string | null, isIfNeeded: boolean, away: GameSide, home: GameSide }} Game */

/** @param {Game} game */
const hasATeam = (game) => !!(game.away.team || game.home.team);

// Once a series is decided, the games it no longer needs never happen.
/**
 * @param {Game} game
 * @param {Map<string, Series>} seriesById
 */
const isCalledOff = (game, seriesById) =>
  game.state === "pre" && game.isIfNeeded && !!seriesById.get(game.series ?? "")?.winner;

/** @param {Game} game */
function findLoser(game) {
  if (game.state !== "final") return null;
  return game.away.score < game.home.score ? "away" : "home";
}

/** @param {number} period */
function describePeriod(period) {
  if (period <= 4) return `Q${period}`;
  return period === 5 ? "OT" : `${period - 4}OT`;
}

// Between periods the clock stops at zero, and the league's own status says which break it is.
/** @param {Game} game */
function describeLiveClock(game) {
  const isRunning = game.clock && game.clock !== "0.0" && game.period;
  return isRunning ? `${describePeriod(game.period)} ${game.clock}` : game.status;
}

/** @param {Game} game */
function renderMiddle(game) {
  if (game.state === "pre") {
    const time = game.isTimeSet && game.start ? formatStartTime(game.start) : "TBD";
    return html`<span class="time tabular">${time}</span>`;
  }
  const loser = findLoser(game);
  const score = html`<span class="score tabular"
    ><span class="${loser === "away" ? "lost" : ""}">${game.away.score}</span
    ><span class="${loser === "home" ? "lost" : ""}">${game.home.score}</span></span
  >`;
  if (game.state === "live")
    return html`${score}<span class="clock tabular">${describeLiveClock(game)}</span>`;
  return html`${score}<span class="status">${game.status || "Final"}</span>`;
}

/**
 * @param {Game} game
 * @param {"away" | "home"} place
 */
function renderSide(game, place) {
  const side = game[place];
  const isLost = findLoser(game) === place;
  const bonus = game.state === "live" && side.isInBonus && html`<span class="bonus">Bonus</span>`;
  return html`<div class="side ${place}${isLost ? " lost" : ""}">
    ${renderClub(side.team, { seed: side.seed })}${bonus}
  </div>`;
}

/**
 * @param {Game} game
 * @param {Map<string, Series>} seriesById
 */
function renderGameNote(game, seriesById) {
  const round = game.round ? ROUNDS[game.round].name : "";
  const facts = [
    round && `${round} Game ${game.number}`,
    describeSeriesStanding(seriesById.get(game.series ?? "")),
    game.isIfNeeded && game.state === "pre" && "If needed",
  ].filter(Boolean);
  return html`<p class="game-note">${joinWithSeparator(facts)}</p>`;
}

/**
 * @param {Game} game
 * @param {Map<string, Series>} seriesById
 */
const renderGame = (game, seriesById) =>
  html`<li class="game-row ${game.state}" data-game="${game.id}">
    ${renderSide(game, "away")}
    <div class="middle">${renderMiddle(game)}</div>
    ${renderSide(game, "home")} ${renderGameNote(game, seriesById)}
  </li>`;

/**
 * @param {Game[]} games
 * @param {Map<string, Series>} seriesById
 */
const renderGameList = (games, seriesById) =>
  html`<ul class="game-list">
    ${games.map((game) => renderGame(game, seriesById))}
  </ul>`;

/**
 * Games grouped by day, in the order given.
 * @param {{ day: Date, games: Game[] }[]} days
 * @param {Map<string, Series>} seriesById
 * @param {number} now
 */
const renderDays = (days, seriesById, now) =>
  days.map(
    ({ day, games }) =>
      html`<h3 class="day-label">${describeDay(day, now)}</h3>
        ${renderGameList(games, seriesById)}`,
  );

/**
 * @param {Game[]} games
 * @returns {{ day: Date, games: Game[] }[]}
 */
function groupByDay(games) {
  const days = new Map();
  for (const game of games) {
    const day = readGameDay(game);
    if (!day) continue;
    const key = day.getTime();
    if (!days.has(key)) days.set(key, { day, games: [] });
    days.get(key).games.push(game);
  }
  return [...days.values()];
}

/**
 * Splits the games into today's, the days ahead, and the days before. A game still under way
 * past midnight stays with today's.
 * @param {Game[]} games
 * @param {number} now
 */
export function sortGamesByDay(games, now) {
  const today = [];
  const ahead = [];
  const before = [];
  for (const game of games) {
    const day = readGameDay(game);
    const offset = day ? countDaysBetween(new Date(now), day) : 1;
    if (offset === 0 || game.state === "live") today.push(game);
    else if (offset > 0) ahead.push(game);
    else before.push(game);
  }
  return { today, ahead: groupByDay(ahead), before: groupByDay(before).reverse() };
}

/**
 * @param {{ games?: Game[], series?: Series[] } | null} season
 * @param {number} now
 */
export function renderGames(season, now) {
  const seriesById = new Map((season?.series ?? []).map((series) => [series.id, series]));
  const shown = (season?.games ?? []).filter(
    (game) => hasATeam(game) && !isCalledOff(game, seriesById),
  );
  if (!shown.length) return html`<p class="empty-note">No playoff games yet.</p>`;
  const { today, ahead, before } = sortGamesByDay(shown, now);
  const todayList = today.length
    ? renderGameList(today, seriesById)
    : html`<p class="empty-note">No games today.</p>`;
  return html`<section class="games-section">
      <h2 class="section-label">Today</h2>
      ${todayList}
    </section>
    ${
      ahead.length > 0 &&
      html`<section class="games-section">
      <h2 class="section-label">Upcoming</h2>
      ${renderDays(ahead, seriesById, now)}
    </section>`
    }
    ${
      before.length > 0 &&
      html`<section class="games-section">
      <h2 class="section-label">Results</h2>
      ${renderDays(before, seriesById, now)}
    </section>`
    }`;
}
