import { html } from "#shared/html.js";
import { renderClub } from "./clubs.js";
import { describeDay, formatStartTime, readGameDay } from "./days.js";
import { BRACKET_ORDER, describeSeriesStanding } from "./series.js";
import { ROUNDS } from "./snapshot.js";

/** @typedef {import("./series.js").Series} Series */
/** @typedef {import("./series.js").SeriesSide} SeriesSide */
/** @typedef {import("./games-view.js").Game} Game */

/**
 * @param {SeriesSide | null} side
 * @param {Series} series
 */
function renderTeamLine(side, series) {
  if (!side?.team) return html`<div class="team-line tbd">${renderClub(null)}</div>`;
  const isOut = !!series.winner && series.winner !== side.team;
  const isWinner = series.winner === side.team;
  const state = isOut ? " out" : isWinner ? " won" : "";
  return html`<div class="team-line${state}">
    ${renderClub(side.team, { seed: side.seed })}<span class="wins tabular">${side.wins}</span>
  </div>`;
}

/**
 * When the series next plays, or that it's playing now.
 * @param {Series} series
 * @param {Game[]} games
 * @param {number} now
 */
function renderSeriesNote(series, games, now) {
  const live = games.find((game) => game.series === series.id && game.state === "live");
  if (live) return html`<span class="series-note live">Live, Game ${live.number}</span>`;
  if (series.winner)
    return html`<span class="series-note">${describeSeriesStanding(series)}</span>`;
  const next = games.find((game) => game.id === series.nextGame?.id);
  if (!next || !series.top || !series.bottom) return "";
  const day = readGameDay(next);
  const time = next.isTimeSet && next.start ? formatStartTime(next.start) : "";
  const when = [day && describeDay(day, now), time].filter(Boolean).join(" ");
  return html`<span class="series-note">Game ${next.number} ${when}</span>`;
}

/**
 * @param {Series | undefined} series
 * @param {Game[]} games
 * @param {number} now
 */
function renderSeries(series, games, now) {
  if (!series) return html`<div class="series empty"></div>`;
  return html`<div class="series" data-series="${series.id}">
    ${renderTeamLine(series.top, series)}${renderTeamLine(series.bottom, series)}
    ${renderSeriesNote(series, games, now)}
  </div>`;
}

/**
 * @param {{ games?: Game[], series?: Series[] } | null} season
 * @param {number} now
 */
export function renderBracket(season, now) {
  const allSeries = season?.series ?? [];
  if (!allSeries.length)
    return html`<p class="empty-note">The bracket fills in once the playoff field is set.</p>`;
  const seriesById = new Map(allSeries.map((series) => [series.id, series]));
  const games = season?.games ?? [];
  const rounds = Object.entries(BRACKET_ORDER).map(
    ([round, ids]) =>
      html`<div class="round round-${round}">
        <h2 class="round-name">${ROUNDS[round].name}</h2>
        ${ids.map((id) => renderSeries(seriesById.get(id), games, now))}
      </div>`,
  );
  return html`<div class="bracket">${rounds}</div>`;
}
