import { countDaysBetween, formatClockTime } from "#shared/days.js";
import { html, joinWithSeparator } from "#shared/html.js";
import { findOpeningRound } from "#shared/opening-round.js";
import { renderClub } from "./clubs.js";
import { describeDay, readGameDay } from "./days.js";
import { BRACKET_FEEDERS, BRACKET_ORDER, describeSeriesStanding } from "./series.js";
import { ROUNDS } from "./snapshot.js";

/** @typedef {import("./series.js").Series} Series */
/** @typedef {import("./series.js").SeriesSide} SeriesSide */
/** @typedef {import("./games-view.js").Game} Game */

/**
 * A seed shows only in the first round, where its team enters the bracket.
 * @param {SeriesSide | null} side
 * @param {Series} series
 */
function renderTeamLine(side, series) {
  if (!side?.team) return html`<div class="team-line tbd">${renderClub(null)}</div>`;
  const isOut = !!series.winner && series.winner !== side.team;
  const isWinner = series.winner === side.team;
  const state = isOut ? " out" : isWinner ? " won" : "";
  return html`<div class="team-line${state}">
    ${renderClub(side.team, { seed: series.round === 1 ? side.seed : null })}<span class="wins tabular"><span>${side.wins}</span></span>
  </div>`;
}

/**
 * What a series still without both teams waits on: the series that feed it, by their seeds.
 * @param {Series} series
 * @param {Map<string, Series>} seriesById
 */
function describeWait(series, seriesById) {
  if (series.round === 3) return "Starts after the Semifinals";
  const feeders = (BRACKET_FEEDERS[series.id] ?? [])
    .map((id) => seriesById.get(id))
    .filter((feeder) => feeder && !feeder.winner && feeder.top?.seed && feeder.bottom?.seed)
    .map((feeder) => `${feeder?.top?.seed}-${feeder?.bottom?.seed}`);
  return feeders.length ? `Waits on ${feeders.join(" and ")}` : "";
}

/**
 * When the series next plays, that it's playing now, how it ended, or what it waits on.
 * @param {Series} series
 * @param {Game[]} games
 * @param {number} now
 * @param {Map<string, Series>} seriesById
 */
function renderSeriesNote(series, games, now, seriesById) {
  const live = games.find((game) => game.series === series.id && game.state === "live");
  if (live) return html`<span class="series-note live">Live, Game ${live.number}</span>`;
  if (series.winner)
    return html`<span class="series-note decided">${describeSeriesStanding(series)}</span>`;
  const next = games.find((game) => game.id === series.nextGame?.id);
  if (!next || !series.top || !series.bottom)
    return html`<span class="series-note">${describeWait(series, seriesById)}</span>`;
  const day = readGameDay(next);
  const time = next.isTimeSet && next.start ? formatClockTime(new Date(next.start)) : "";
  const when = [day && describeDay(day, now), time].filter(Boolean).join(" ");
  const isToday = !!day && countDaysBetween(new Date(now), day) === 0;
  return html`<span class="series-note${isToday ? " today" : ""}">${joinWithSeparator(
    [`Game ${next.number}`, when].filter(Boolean),
  )}</span>`;
}

/**
 * @param {Series} series
 * @param {Game[]} games
 * @param {number} now
 * @param {Map<string, Series>} seriesById
 */
function renderSeries(series, games, now, seriesById) {
  return html`<div class="bracket-cell cell-${series.id}">
    <div class="series" data-series="${series.id}">
      <div class="series-head">${renderSeriesNote(series, games, now, seriesById)}</div>
      ${renderTeamLine(series.top, series)}${renderTeamLine(series.bottom, series)}
    </div>
  </div>`;
}

/**
 * A series the feeds don't list yet, drawn with its teams to be decided.
 * @param {string} id
 * @returns {Series}
 */
const describeUnlisted = (id) => ({
  id,
  round: Number(id.split("-")[0]),
  top: null,
  bottom: null,
  winner: null,
  status: "",
  nextGame: null,
});

/**
 * The rounds left to right, each series beside the two it follows, under round names that mark
 * the round the bracket opens on. Its lines are drawn once it's on the page (bracket-tree.js).
 * @param {{ games?: Game[], series?: Series[] } | null} season
 * @param {number} now
 */
export function renderBracket(season, now) {
  const allSeries = season?.series ?? [];
  if (!allSeries.length)
    return html`<p class="empty-note">The bracket fills in once the playoff field is set.</p>`;
  const seriesById = new Map(allSeries.map((series) => [series.id, series]));
  const games = season?.games ?? [];
  const rounds = Object.values(BRACKET_ORDER).map((ids) =>
    ids.map((id) => seriesById.get(id) ?? describeUnlisted(id)),
  );
  const openingRound = findOpeningRound(rounds, (series) => !!series.winner) + 1;
  const names = Object.keys(BRACKET_ORDER).map(
    (round) =>
      html`<h2 class="round-name round-${round}${Number(round) === openingRound ? " now" : ""}" data-round="${round}">
        <span>${ROUNDS[round].name}</span><span class="best-of">Best of ${ROUNDS[round].bestOf}</span>
      </h2>`,
  );
  const cells = rounds.flat().map((series) => renderSeries(series, games, now, seriesById));
  const roundDots = Object.keys(BRACKET_ORDER).map(
    (round) => html`<span data-round="${round}"></span>`,
  );
  return html`<div class="bracket" data-opening-round="${openingRound}">
      <svg class="bracket-lines" aria-hidden="true"></svg>${names}${cells}
    </div>
    <div class="round-dots" aria-hidden="true">${roundDots}</div>`;
}
