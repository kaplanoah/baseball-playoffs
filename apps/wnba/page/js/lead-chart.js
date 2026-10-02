import { html } from "#shared/html.js";
import { nameTeam } from "./series.js";

// The game sheet's chart of the lead through a game: the home team's lead above the middle line
// and the visitors' below it, after each basket, on a tile with each team named just outside its
// own half and each side's biggest lead marked, each side in its team's color, which the game
// sheet sets. A live game's line stops at its latest basket.

/** @typedef {{ periods: number, isOver: boolean, scores: [number, number, number][] }} Lead each score's seconds from tip-off, then the away and home scores */

const QUARTER_SECONDS = 10 * 60;
const OVERTIME_SECONDS = 5 * 60;
const REGULATION_PERIODS = 4;

const WIDTH = 320;
const LEFT = 30;
const RIGHT = 6;
const HOME_NAME_BASELINE = 13;
const TILE_TOP = 22;
// The tile reaches past the scale's dashed edges, so a biggest lead near one keeps its label inside.
const TILE_ROOM = 10;
const TOP = TILE_TOP + TILE_ROOM;
const PLOT_HEIGHT = 102;
const MIDDLE = TOP + PLOT_HEIGHT / 2;
const TILE_BOTTOM = TOP + PLOT_HEIGHT + TILE_ROOM;
const AWAY_NAME_BASELINE = TILE_BOTTOM + 18;
const PERIOD_BASELINE = AWAY_NAME_BASELINE + 19;
const HEIGHT = PERIOD_BASELINE + 5;
const STEP = 5;
const SMALLEST_REACH = 10;
// From a biggest lead's dot to the tile's edge: the dot, the label beyond it, and a gap.
const PEAK_ROOM = 20;
// About half a 13px Barlow Condensed character, to keep a biggest lead's label inside the chart.
const HALF_CHARACTER = 3.3;
const TICK_HALF = 3;

/** @param {number} periods */
const measureGame = (periods) =>
  REGULATION_PERIODS * QUARTER_SECONDS +
  Math.max(0, periods - REGULATION_PERIODS) * OVERTIME_SECONDS;

/** @param {number} index */
const measurePeriodStart = (index) =>
  Math.min(index, REGULATION_PERIODS) * QUARTER_SECONDS +
  Math.max(0, index - REGULATION_PERIODS) * OVERTIME_SECONDS;

/** @param {number} index */
const namePeriod = (index) =>
  index < REGULATION_PERIODS
    ? `Q${index + 1}`
    : index === REGULATION_PERIODS
      ? "OT"
      : `${index - REGULATION_PERIODS + 1}OT`;

/** @param {number} value */
const formatCoordinate = (value) => String(Math.round(value * 10) / 10);

/**
 * The biggest lead each side had, and when, home's as a positive margin and the visitors' as a
 * negative one.
 * @param {{ at: number, margin: number }[]} margins
 * @param {1 | -1} sign
 */
function findBiggestLead(margins, sign) {
  return margins.reduce(
    (best, point) => (point.margin * sign > best.margin * sign ? point : best),
    { at: 0, margin: 0 },
  );
}

/**
 * @param {string} name
 * @param {number} margin
 */
const describeBiggestLead = (name, margin) =>
  margin > 0 ? `the ${name} led by as many as ${margin}` : `the ${name} never led`;

/**
 * The scale's reach, in points either way: the biggest lead rounded up to a step, and a step more
 * while that leaves its dot and label too near the tile's edge.
 * @param {number} biggest
 */
function chooseReach(biggest) {
  let reach = Math.max(SMALLEST_REACH, Math.ceil(biggest / STEP) * STEP);
  while (((reach - biggest) / reach) * (PLOT_HEIGHT / 2) + TILE_ROOM < PEAK_ROOM) reach += STEP;
  return reach;
}

/**
 * The lead holds until the next basket, so the line steps.
 * @param {{ at: number, margin: number }[]} margins
 * @param {number} end
 */
function traceSteps(margins, end) {
  const steps = margins.flatMap((point, index) =>
    index
      ? [
          [point.at, margins[index - 1].margin],
          [point.at, point.margin],
        ]
      : [[point.at, point.margin]],
  );
  steps.push([end, margins[margins.length - 1].margin]);
  return steps;
}

/**
 * @param {Lead} lead
 * @param {{ away: string, home: string }} teams
 */
export function renderLeadChart(lead, teams) {
  const length = measureGame(lead.periods);
  const margins = lead.scores.map(([at, away, home]) => ({ at, margin: home - away }));
  const homeBest = findBiggestLead(margins, 1);
  const awayBest = findBiggestLead(margins, -1);
  const reach = chooseReach(Math.max(homeBest.margin, -awayBest.margin));
  const x = (/** @type {number} */ at) => LEFT + (at / length) * (WIDTH - LEFT - RIGHT);
  const y = (/** @type {number} */ margin) => MIDDLE - (margin / reach) * (PLOT_HEIGHT / 2);
  const end = lead.isOver ? length : margins[margins.length - 1].at;

  const steps = traceSteps(margins, end);
  const trace = (/** @type {number[][]} */ points) =>
    `M${points.map(([at, margin]) => `${formatCoordinate(x(at))},${formatCoordinate(y(margin))}`).join("L")}`;
  const closeToMiddle = (/** @type {(margin: number) => number} */ clamp) =>
    `${trace(steps.map(([at, margin]) => [at, clamp(margin)]))}L${formatCoordinate(x(end))},${MIDDLE}L${formatCoordinate(x(0))},${MIDDLE}Z`;
  const homeArea = closeToMiddle((margin) => Math.max(margin, 0));
  const awayArea = closeToMiddle((margin) => Math.min(margin, 0));

  const periodIndexes = [...Array(lead.periods).keys()];
  const periodTicks = periodIndexes
    .slice(1)
    .map(
      (index) =>
        html`<line class="lead-tick" x1="${x(measurePeriodStart(index))}" x2="${x(measurePeriodStart(index))}" y1="${MIDDLE - TICK_HALF}" y2="${MIDDLE + TICK_HALF}"></line>`,
    );
  const periodNames = periodIndexes.map((index) => {
    const middle = (measurePeriodStart(index) + measurePeriodStart(index + 1)) / 2;
    return html`<text class="lead-period" x="${formatCoordinate(x(middle))}" y="${PERIOD_BASELINE}" text-anchor="middle">${namePeriod(index)}</text>`;
  });
  const reachLines = [reach, -reach].map(
    (margin) =>
      html`<line class="lead-grid" x1="${LEFT}" x2="${WIDTH - RIGHT}" y1="${y(margin)}" y2="${y(margin)}"></line>
        <text class="lead-reach" x="${LEFT - 5}" y="${y(margin) + 4}" text-anchor="end">+${reach}</text>`,
  );
  const homeName = nameTeam(teams.home);
  const awayName = nameTeam(teams.away);
  const renderPeak = (
    /** @type {{ at: number, margin: number }} */ peak,
    /** @type {string} */ name,
    /** @type {"away" | "home"} */ place,
  ) => {
    if (!peak.margin) return "";
    const label = `${name} +${Math.abs(peak.margin)}`;
    const halfWidth = label.length * HALF_CHARACTER;
    const labelY = peak.margin > 0 ? y(peak.margin) - 7 : y(peak.margin) + 15;
    const labelX = Math.min(Math.max(x(peak.at), LEFT + halfWidth), WIDTH - RIGHT - halfWidth);
    return html`<circle class="lead-peak ${place}" cx="${formatCoordinate(x(peak.at))}" cy="${formatCoordinate(y(peak.margin))}" r="3.5"></circle>
      <text class="lead-peak-label ${place}" x="${formatCoordinate(labelX)}" y="${formatCoordinate(labelY)}" text-anchor="middle">${label}</text>`;
  };
  const label = [
    describeBiggestLead(homeName, homeBest.margin),
    describeBiggestLead(awayName, -awayBest.margin),
  ].join(", ");

  return html`<div class="lead-chart">
    <svg viewBox="0 0 ${WIDTH} ${HEIGHT}" role="img" aria-label="${label.charAt(0).toUpperCase()}${label.slice(1)}">
      <rect class="lead-tile" x="${LEFT - 0.5}" y="${TILE_TOP}" width="${WIDTH - LEFT - RIGHT + 1}" height="${TILE_BOTTOM - TILE_TOP}" rx="4"></rect>
      ${reachLines}
      <path class="lead-area home" d="${homeArea}"></path>
      <path class="lead-area away" d="${awayArea}"></path>
      <line class="lead-middle" x1="${LEFT}" x2="${WIDTH - RIGHT}" y1="${MIDDLE}" y2="${MIDDLE}"></line>
      ${periodTicks}
      <path class="lead-line" d="${trace(steps)}"></path>
      <text class="lead-side home" x="${LEFT}" y="${HOME_NAME_BASELINE}">&#9650; ${homeName} ahead</text>
      <text class="lead-side away" x="${LEFT}" y="${AWAY_NAME_BASELINE}">&#9660; ${awayName} ahead</text>
      ${renderPeak(homeBest, homeName, "home")}${renderPeak(awayBest, awayName, "away")}${periodNames}
    </svg>
  </div>`;
}
