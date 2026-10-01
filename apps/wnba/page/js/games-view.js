import { renderGameRow } from "#shared/game-row.js";
import { html } from "#shared/html.js";
import { renderClub } from "./clubs.js";
import { countDaysBetween, describeDay, formatStartTime, readGameDay } from "./days.js";
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

/** @param {Game} game */
const findWinningTeam = (game) =>
  game.away.score > game.home.score ? game.away.team : game.home.team;

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
function renderHeadline(game) {
  if (game.state === "pre") {
    const time = game.isTimeSet && game.start ? formatStartTime(game.start) : "TBD";
    return html`<span class="time tabular">${time}</span>`;
  }
  const loser = findLoser(game);
  return html`<span class="score tabular"
    ><span class="${loser === "away" ? "lost" : ""}">${game.away.score}</span
    ><span class="${loser === "home" ? "lost" : ""}">${game.home.score}</span></span
  >`;
}

/** @param {Game} game */
function renderStatus(game) {
  if (game.state === "live")
    return html`<span class="clock tabular">${describeLiveClock(game)}</span>`;
  if (game.state === "final") return html`${game.status || "Final"}`;
  return game.isIfNeeded && html`If needed`;
}

// A game shows its series as it stood at tip-off, and once it's over, as it stood after.
/**
 * @param {Game} game
 * @param {Game[]} games
 */
function countSeriesWins(game, games) {
  const isCounted = (other) =>
    other.series === game.series &&
    other.state === "final" &&
    (other === game || other.number < game.number);
  const winners = games.filter(isCounted).map(findWinningTeam);
  const countWins = (team) => winners.filter((winner) => winner === team).length;
  return [countWins(game.away.team), countWins(game.home.team)];
}

// Short names, since the label shares the row's middle with the time or score. Until both teams
// are known, the game's number tells the series' games apart instead.
/**
 * @param {Game} game
 * @param {Game[]} games
 */
function renderSeriesLabel(game, games) {
  if (!game.round) return false;
  const round = ROUNDS[game.round];
  if (!game.away.team || !game.home.team)
    return html`<span class="series-label">${round.shortName} G${game.number}</span>`;
  const wins = countSeriesWins(game, games);
  const isDecided = Math.max(...wins) > round.bestOf / 2;
  return html`<span class="series-label${isDecided ? " decided" : ""}"
    >${round.shortName} <span class="series-count tabular">${wins.join("-")}</span></span
  >`;
}

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

/**
 * @param {Game} game
 * @param {Game[]} games
 */
const renderGame = (game, games) =>
  renderGameRow({
    id: game.id,
    classes: [game.state],
    away: describeSide(game, "away"),
    home: describeSide(game, "home"),
    label: renderSeriesLabel(game, games),
    headline: renderHeadline(game),
    status: renderStatus(game),
  });

/**
 * @param {Game[]} games
 * @param {Game[]} allGames every game of the season, which the series labels count from
 */
const renderGameList = (games, allGames) =>
  html`<ul class="game-list">
    ${games.map((game) => renderGame(game, allGames))}
  </ul>`;

/**
 * Games grouped by day, in the order given.
 * @param {{ day: Date, games: Game[] }[]} days
 * @param {Game[]} allGames
 * @param {number} now
 */
const renderDays = (days, allGames, now) =>
  days.map(
    ({ day, games }) =>
      html`<h3 class="day-label">${describeDay(day, now)}</h3>
        ${renderGameList(games, allGames)}`,
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
  const allGames = season?.games ?? [];
  const shown = allGames.filter((game) => hasATeam(game) && !isCalledOff(game, seriesById));
  if (!shown.length) return html`<p class="empty-note">No playoff games yet.</p>`;
  const { today, ahead, before } = sortGamesByDay(shown, now);
  const todayList = today.length
    ? renderGameList(today, allGames)
    : html`<p class="empty-note">No games today.</p>`;
  return html`<section class="games-section">
      <h2 class="section-label">Today</h2>
      ${todayList}
    </section>
    ${
      ahead.length > 0 &&
      html`<section class="games-section">
      <h2 class="section-label">Upcoming</h2>
      ${renderDays(ahead, allGames, now)}
    </section>`
    }
    ${
      before.length > 0 &&
      html`<section class="games-section">
      <h2 class="section-label">Results</h2>
      ${renderDays(before, allGames, now)}
    </section>`
    }`;
}
