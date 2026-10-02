import { countDaysBetween, formatClockTime, formatShortMonth } from "#shared/days.js";
import { renderGameRow } from "#shared/game-row.js";
import { html } from "#shared/html.js";
import { renderClub } from "./clubs.js";
import { abbreviateDay, nameListDay, readGameDay } from "./days.js";
import { renderScoreboard } from "./scoreboard.js";
import { nameTeam } from "./series.js";
import { ROUNDS } from "./snapshot.js";

/** @typedef {import("./series.js").Series} Series */
/** @typedef {{ team: string | null, seed: number | null, score: number | null, isInBonus: boolean }} GameSide */
/** @typedef {{ id: string, round: number | null, series: string | null, number: number | null, start: string | null, state: string, status: string, isTimeSet: boolean, period: number | null, clock: string | null, isIfNeeded: boolean, away: GameSide, home: GameSide, end?: string, networks?: string[] }} Game */

/** @param {Game} game */
const hasATeam = (game) => !!(game.away.team || game.home.team);

// Once a series is decided, the games it no longer needs never happen.
/**
 * @param {Game} game
 * @param {Map<string, Series>} seriesById
 */
export const isCalledOff = (game, seriesById) =>
  game.state === "pre" && game.isIfNeeded && !!seriesById.get(game.series ?? "")?.winner;

/** @param {Game} game */
export function findLoser(game) {
  if (game.state !== "final") return null;
  return game.away.score < game.home.score ? "away" : "home";
}

/** @param {number} period */
export function describePeriod(period) {
  if (period <= 4) return `Q${period}`;
  return period === 5 ? "OT" : `${period - 4}OT`;
}

// Between periods the clock stops at zero, and the league's own status says which break it is.
/** @param {Game} game */
const isClockRunning = (game) => !!(game.clock && game.clock !== "0.0" && game.period);

/** @param {Game} game */
export function renderHeadline(game) {
  if (game.state === "pre") {
    const time = game.isTimeSet && game.start ? formatClockTime(new Date(game.start)) : "TBD";
    return html`<span class="time tabular">${time}</span>`;
  }
  const loser = findLoser(game);
  return html`<span class="score"
    >${renderScoreboard(game.away.score, { isLoser: loser === "away" })}${renderScoreboard(
      game.home.score,
      { isLoser: loser === "home" },
    )}</span
  >`;
}

/** @param {Game} game */
export function renderStatus(game) {
  if (game.state === "live" && isClockRunning(game))
    return html`<span class="clock tabular">${describePeriod(game.period ?? 0)} ${game.clock}</span>`;
  if (game.state === "live") return html`<span class="break">${game.status}</span>`;
  if (game.state === "final") return html`${game.status || "Final"}`;
  return game.isIfNeeded && html`If needed`;
}

// Short names, since the label shares the row's middle with the time or score. The bracket keeps
// each series' score.
/** @param {Game} game */
const renderSeriesLabel = (game) =>
  !!game.round && html`<span class="series-label">${ROUNDS[game.round].shortName}</span>`;

// Every game holds a line for Bonus under each team, so the teams stay put as it comes and goes.
/**
 * @param {Game} game
 * @param {"away" | "home"} place
 */
function describeSide(game, place) {
  const side = game[place];
  const bonus = game.state === "live" && side.isInBonus && html`<span class="bonus">Bonus</span>`;
  return {
    lines: renderClub(side.team, { seed: side.seed }),
    classes: [findLoser(game) === place && "lost"],
    extra: html`${bonus}`,
  };
}

/** @param {Game} game */
export const nameGame = (game) =>
  game.round ? `${ROUNDS[game.round].name} Game ${game.number}` : "Game";

// The whole row opens the game's sheet, once both its teams are known.
/** @param {Game} game */
function renderOpenButton(game) {
  if (!game.away.team || !game.home.team) return false;
  const teams = `${nameTeam(game.away.team)} at ${nameTeam(game.home.team)}`;
  const label = `Game details: ${teams}, ${nameGame(game)}`;
  return html`<button type="button" class="game-open" aria-label="${label}"></button>`;
}

// Only today's games say where to watch them.
/**
 * @param {Game} game
 * @param {boolean} isToday
 */
const renderGame = (game, isToday) =>
  renderGameRow({
    id: game.id,
    classes: [game.state],
    away: describeSide(game, "away"),
    home: describeSide(game, "home"),
    label: renderSeriesLabel(game),
    headline: renderHeadline(game),
    status: renderStatus(game),
    networks: (isToday && game.networks) || [],
    action: renderOpenButton(game),
  });

/**
 * @param {Game[]} games
 * @param {boolean} isToday
 */
const renderGameList = (games, isToday) =>
  html`<ul class="game-list">
    ${games.map((game) => renderGame(game, isToday))}
  </ul>`;

/**
 * A day's games in a box of their own, beside its date as a wall calendar shows it.
 * @param {{ day: Date, games: Game[] }} gameDay
 * @param {number} now
 * @param {boolean} [isToday]
 */
const renderDay = ({ day, games }, now, isToday = false) =>
  html`<section class="game-day">
    <h3 class="day-label" aria-label="${nameListDay(day, now)}, ${formatShortMonth(day)} ${day.getDate()}">
      <span class="day-month">${formatShortMonth(day)}</span
      ><span class="day-number tabular">${day.getDate()}</span
      ><span class="day-name">${abbreviateDay(day, now)}</span>
    </h3>
    ${renderGameList(games, isToday)}
  </section>`;

/**
 * Games grouped by day, in the order given.
 * @param {{ day: Date, games: Game[] }[]} days
 * @param {number} now
 */
const renderDays = (days, now) => html`${days.map((gameDay) => renderDay(gameDay, now))}`;

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

/** @param {string} text */
const renderEmptyNote = (text) => html`<p class="empty-note">${text}</p>`;

/**
 * @param {Game[]} today
 * @param {number} now
 */
const renderToday = (today, now) =>
  today.length
    ? renderDay({ day: new Date(now), games: today }, now, true)
    : renderEmptyNote("No games today.");

/**
 * The Games view's three lists: results, newest first, today's games, and the games ahead.
 * @param {{ games?: Game[], series?: Series[] } | null} season
 * @param {number} now
 */
export function renderGames(season, now) {
  const seriesById = new Map((season?.series ?? []).map((series) => [series.id, series]));
  const shown = (season?.games ?? []).filter(
    (game) => hasATeam(game) && !isCalledOff(game, seriesById),
  );
  if (!shown.length) {
    const note = renderEmptyNote("No playoff games yet.");
    return { previous: note, today: note, next: note };
  }
  const { today, ahead, before } = sortGamesByDay(shown, now);
  return {
    previous: before.length ? renderDays(before, now) : renderEmptyNote("No results yet."),
    today: renderToday(today, now),
    next: ahead.length ? renderDays(ahead, now) : renderEmptyNote("No more games scheduled."),
  };
}
