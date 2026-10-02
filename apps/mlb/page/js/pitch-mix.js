// A pitcher's pitches from slowest to fastest: a line that places each by its speed, then a row
// for each with a bar for how often he throws it. Until they load, gray rows stand in.

import { html } from "#shared/html.js";
import { renderPlaceholder } from "#shared/placeholder.js";

const PITCH_NAMES = {
  FF: "Four-seam",
  SI: "Sinker",
  FC: "Cutter",
  SL: "Slider",
  ST: "Sweeper",
  SV: "Slurve",
  CU: "Curveball",
  KC: "Knuckle curve",
  CS: "Slow curve",
  CH: "Changeup",
  FS: "Splitter",
  FO: "Forkball",
  SC: "Screwball",
  KN: "Knuckleball",
  EP: "Eephus",
};

// Pitches he barely throws would be bars too thin to see.
const SMALLEST_SHARE = 0.02;
const MOST_PITCHES = 7;
const WIDTH = 320;
const EDGE = 10;
const LINE_Y = 8;
const DOT_RADIUS = 5.5;
const DOT_STEP = 2 * DOT_RADIUS + 1;
const LABEL_STEP_MPH = 10;
const LABEL_Y = LINE_Y + 19;
const LINE_HEIGHT = 32;
// A pitch thrown half the time fills its bar.
const FULL_BAR_SHARE = 0.5;

export const namePitch = (pitch) => PITCH_NAMES[pitch.code] || pitch.name;

export function listShownPitches(pitches) {
  return pitches
    .filter((pitch) => pitch.share >= SMALLEST_SHARE && Number.isFinite(pitch.mph))
    .sort((first, second) => second.share - first.share)
    .slice(0, MOST_PITCHES)
    .sort((first, second) => first.mph - second.mph);
}

// The line runs from 70 to 100 mph, wider only for a pitch outside that.
function measureScale(pitches) {
  const speeds = pitches.map((pitch) => pitch.mph);
  const low = Math.min(70, Math.floor(Math.min(...speeds) / LABEL_STEP_MPH) * LABEL_STEP_MPH);
  const high = Math.max(100, Math.ceil(Math.max(...speeds) / LABEL_STEP_MPH) * LABEL_STEP_MPH);
  const toX = (mph) => EDGE + ((mph - low) / (high - low)) * (WIDTH - 2 * EDGE);
  return { low, high, toX };
}

const spreadDots = (group) => {
  const center = group.reduce((sum, dot) => sum + dot.x, 0) / group.length;
  return group.map((dot, index) => ({
    ...dot,
    x: center + (index - (group.length - 1) / 2) * DOT_STEP,
  }));
};

const isCrowding = (group, next) => spreadDots(next)[0].x - spreadDots(group).at(-1).x < DOT_STEP;

// Pitches at nearly the same speed sit side by side on the line, slowest first, centered on
// their speeds, so no dot covers another.
function placeDots(pitches, toX) {
  const groups = pitches.map((pitch) => [{ pitch, x: toX(pitch.mph) }]);
  for (let index = 0; index + 1 < groups.length;) {
    if (isCrowding(groups[index], groups[index + 1])) {
      groups.splice(index, 2, [...groups[index], ...groups[index + 1]]);
      index = Math.max(0, index - 1);
    } else index++;
  }
  return groups.flatMap((group) => keepOnLine(spreadDots(group)));
}

function keepOnLine(dots) {
  const first = EDGE + DOT_RADIUS - dots[0].x;
  const last = WIDTH - EDGE - DOT_RADIUS - dots.at(-1).x;
  const shift = Math.max(0, first) + Math.min(0, last);
  return dots.map((dot) => ({ ...dot, x: dot.x + shift }));
}

const formatNumber = (value) => Number(value.toFixed(1));

const renderDot = ({ pitch, x }) =>
  html`<circle class="pitch-dot pitch-${pitch.code}" cx="${formatNumber(x)}" cy="${LINE_Y}" r="${DOT_RADIUS}"/>`;

// A label every 10 mph, with the unit on the first, whose number still centers on its speed.
function renderSpeedLabels(low, high, toX) {
  const labels = [];
  for (let mph = low; mph <= high; mph += LABEL_STEP_MPH) {
    const x = formatNumber(toX(mph));
    labels.push(
      mph === low
        ? html`<text class="speed-label first" x="${x}" dx="-${String(mph).length * 0.3}em" y="${LABEL_Y}">${mph} mph</text>`
        : html`<text class="speed-label" x="${x}" y="${LABEL_Y}">${mph}</text>`,
    );
  }
  return labels;
}

function renderSpeedLine(pitches) {
  const { low, high, toX } = measureScale(pitches);
  const speeds = pitches.map((pitch) => pitch.mph);
  const [first, last] = [toX(Math.min(...speeds)), toX(Math.max(...speeds))];
  return html`<svg class="speed-line" viewBox="0 0 ${WIDTH} ${LINE_HEIGHT}" aria-hidden="true">
    <line class="speed-axis" x1="${EDGE}" y1="${LINE_Y}" x2="${WIDTH - EDGE}" y2="${LINE_Y}"/>
    <line class="speed-range" x1="${formatNumber(first)}" y1="${LINE_Y}" x2="${formatNumber(last)}" y2="${LINE_Y}"/>
    ${renderSpeedLabels(low, high, toX)}
    ${placeDots(pitches, toX).map(renderDot)}
  </svg>`;
}

const measureBar = (share) => Math.round(Math.min(1, share / FULL_BAR_SHARE) * 100);

const renderPitchRow = (pitch) =>
  html`<li class="pitch-${pitch.code}">
    <span class="pitch-name">${namePitch(pitch)}</span>
    <span class="pitch-bar"><i style="width: ${measureBar(pitch.share)}%"></i></span>
    <span class="pitch-share tabular">${Math.round(pitch.share * 100)}%</span>
    <span class="pitch-speed tabular">${Math.round(pitch.mph)} mph</span>
  </li>`;

/** @param {{ code: string, name: string, share: number, mph: number }[]} allPitches */
export function renderPitchMix(allPitches) {
  const pitches = listShownPitches(allPitches);
  if (!pitches.length) return html``;
  return html`<div class="pitch-mix">
    ${renderSpeedLine(pitches)}
    <ol class="pitch-rows">${pitches.map(renderPitchRow)}</ol>
  </div>`;
}

// The stand-in rows' bars, as shares of a full bar.
const PENDING_BARS = [60, 90, 30];

const renderPendingRow = (width) =>
  html`<li>
    <span class="pitch-name">${renderPlaceholder("Four-seam")}</span>
    <span class="pitch-bar pending"><i style="width: ${width}%"></i></span>
    <span class="pitch-share">${renderPlaceholder("00%")}</span>
    <span class="pitch-speed">${renderPlaceholder("00 mph")}</span>
  </li>`;

export function renderPendingPitchMix() {
  return html`<div class="pitch-mix">
    <svg class="speed-line" viewBox="0 0 ${WIDTH} ${LINE_HEIGHT}" aria-hidden="true">
      <line class="speed-axis" x1="${EDGE}" y1="${LINE_Y}" x2="${WIDTH - EDGE}" y2="${LINE_Y}"/>
    </svg>
    <ol class="pitch-rows">${PENDING_BARS.map(renderPendingRow)}</ol>
  </div>`;
}
