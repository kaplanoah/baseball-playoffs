import { html } from "#shared/html.js";
import { nameTeam } from "./series.js";

// The game sheet's chart of the lead through a game: the home team's lead above the middle line
// and the visitors' below it, after each basket, with each side's biggest lead marked. A live
// game's line stops at its latest basket.

/** @typedef {{ periods: number, isOver: boolean, scores: [number, number, number][] }} Lead each score's seconds from tip-off, then the away and home scores */

const QUARTER_SECONDS = 10 * 60;
const OVERTIME_SECONDS = 5 * 60;
const REGULATION_PERIODS = 4;

const WIDTH = 320;
const HEIGHT = 140;
const LEFT = 24;
const RIGHT = 6;
const TOP = 18;
const BOTTOM = 20;
const PLOT_HEIGHT = HEIGHT - TOP - BOTTOM;
const MIDDLE = TOP + PLOT_HEIGHT / 2;
const STEP = 5;
const SMALLEST_REACH = 10;
// Half a biggest lead's label, which stays inside the chart however near its edge the lead came.
const PEAK_LABEL_ROOM = 10;

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
 * @param {Lead} lead
 * @param {{ away: string, home: string }} teams
 */
export function renderLeadChart(lead, teams) {
  const length = measureGame(lead.periods);
  const margins = lead.scores.map(([at, away, home]) => ({ at, margin: home - away }));
  const homeBest = findBiggestLead(margins, 1);
  const awayBest = findBiggestLead(margins, -1);
  const biggest = Math.max(homeBest.margin, -awayBest.margin);
  const reach = Math.max(SMALLEST_REACH, Math.ceil(biggest / STEP) * STEP);
  const x = (/** @type {number} */ at) => LEFT + (at / length) * (WIDTH - LEFT - RIGHT);
  const y = (/** @type {number} */ margin) => MIDDLE - (margin / reach) * (PLOT_HEIGHT / 2);
  const end = lead.isOver ? length : margins[margins.length - 1].at;

  // The lead holds until the next basket, so the line steps.
  const steps = margins.flatMap((point, index) =>
    index
      ? [
          [point.at, margins[index - 1].margin],
          [point.at, point.margin],
        ]
      : [[point.at, point.margin]],
  );
  steps.push([end, margins[margins.length - 1].margin]);
  const line = `M${steps.map(([at, margin]) => `${formatCoordinate(x(at))},${formatCoordinate(y(margin))}`).join("L")}`;
  const area = `${line}L${formatCoordinate(x(end))},${MIDDLE}L${formatCoordinate(x(0))},${MIDDLE}Z`;

  const periodIndexes = [...Array(lead.periods).keys()];
  const periodLines = periodIndexes
    .slice(1)
    .map(
      (index) =>
        html`<line class="lead-grid" x1="${x(measurePeriodStart(index))}" x2="${x(measurePeriodStart(index))}" y1="${TOP}" y2="${HEIGHT - BOTTOM}"></line>`,
    );
  const periodNames = periodIndexes.map((index) => {
    const middle = (measurePeriodStart(index) + measurePeriodStart(index + 1)) / 2;
    return html`<text class="lead-period" x="${formatCoordinate(x(middle))}" y="${HEIGHT - 5}" text-anchor="middle">${namePeriod(index)}</text>`;
  });
  const reachLines = [reach, -reach].map(
    (margin) =>
      html`<line class="lead-grid dashed" x1="${LEFT}" x2="${WIDTH - RIGHT}" y1="${y(margin)}" y2="${y(margin)}"></line>
        <text class="lead-reach" x="${LEFT - 5}" y="${y(margin) + 4}" text-anchor="end">${reach}</text>`,
  );
  const renderPeak = (/** @type {{ at: number, margin: number }} */ peak) => {
    if (!peak.margin) return "";
    const labelY = peak.margin > 0 ? y(peak.margin) - 6 : y(peak.margin) + 15;
    const labelX = Math.min(Math.max(x(peak.at), LEFT + PEAK_LABEL_ROOM), WIDTH - PEAK_LABEL_ROOM);
    return html`<circle class="lead-peak" cx="${formatCoordinate(x(peak.at))}" cy="${formatCoordinate(y(peak.margin))}" r="3.5"></circle>
      <text class="lead-peak-label" x="${formatCoordinate(labelX)}" y="${formatCoordinate(labelY)}" text-anchor="middle">+${Math.abs(peak.margin)}</text>`;
  };
  const homeName = nameTeam(teams.home);
  const awayName = nameTeam(teams.away);
  const label = [
    describeBiggestLead(homeName, homeBest.margin),
    describeBiggestLead(awayName, -awayBest.margin),
  ].join(", ");

  return html`<div class="lead-chart">
    <p class="lead-key">
      <span>&#9650; ${homeName} ahead</span><span>&#9660; ${awayName} ahead</span>
    </p>
    <svg viewBox="0 0 ${WIDTH} ${HEIGHT}" role="img" aria-label="${label.charAt(0).toUpperCase()}${label.slice(1)}">
      ${reachLines}${periodLines}
      <path class="lead-area" d="${area}"></path>
      <line class="lead-middle" x1="${LEFT}" x2="${WIDTH - RIGHT}" y1="${MIDDLE}" y2="${MIDDLE}"></line>
      <path class="lead-line" d="${line}"></path>
      ${renderPeak(homeBest)}${renderPeak(awayBest)}${periodNames}
    </svg>
  </div>`;
}
