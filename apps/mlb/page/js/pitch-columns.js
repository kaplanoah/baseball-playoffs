// A pitcher's pitches as columns from slowest to fastest, each as tall as how often he throws it,
// under a line that places each pitch by its speed.

import { html } from "#shared/html.js";

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

// Pitches he barely throws would be columns too thin to see.
const SMALLEST_SHARE = 0.02;
const MOST_COLUMNS = 7;
const WIDTH = 320;
const EDGE = 10;
const LINE_Y = 22;
const DOT_RADIUS = 5.5;
const STACK_STEP = 12;
const BAR_TOP = 50;
const BAR_SPACE = 50; // a pitch thrown half the time fills it
const BAR_BASE = BAR_TOP + BAR_SPACE;
const NAME_LINE = 12;

export const namePitch = (pitch) => PITCH_NAMES[pitch.code] || pitch.name;

export function listShownPitches(pitches) {
  return pitches
    .filter((pitch) => pitch.share >= SMALLEST_SHARE && Number.isFinite(pitch.mph))
    .sort((first, second) => second.share - first.share)
    .slice(0, MOST_COLUMNS)
    .sort((first, second) => first.mph - second.mph);
}

// The line runs from 70 to 100 mph, wider only for a pitch outside that.
function measureScale(pitches) {
  const speeds = pitches.map((pitch) => pitch.mph);
  const low = Math.min(70, Math.floor(Math.min(...speeds) / 5) * 5);
  const high = Math.max(100, Math.ceil(Math.max(...speeds) / 5) * 5);
  const toX = (mph) => EDGE + ((mph - low) / (high - low)) * (WIDTH - 2 * EDGE);
  return { low, high, toX };
}

// The most-thrown pitch keeps its place on the line; a pitch at nearly the same speed sits above.
function placeDots(pitches, toX) {
  const placed = new Map();
  for (const pitch of [...pitches].sort((first, second) => second.share - first.share)) {
    const x = toX(pitch.mph);
    const crowded = (y) =>
      [...placed.values()].some((dot) => dot.y === y && Math.abs(dot.x - x) < 2 * DOT_RADIUS);
    let y = LINE_Y;
    while (crowded(y)) y -= STACK_STEP;
    placed.set(pitch, { x, y });
  }
  return placed;
}

const formatNumber = (value) => Number(value.toFixed(1));

function renderColumn(pitch, center, width) {
  const percent = Math.round(pitch.share * 100);
  const barHeight = Math.max(2, Math.min(BAR_SPACE, pitch.share * 100));
  const barWidth = Math.min(26, width * 0.45);
  const lines = namePitch(pitch).split(" ");
  const nameLines = lines.map(
    (line, index) =>
      html`<tspan x="${formatNumber(center)}" dy="${index ? NAME_LINE : 0}">${line}</tspan>`,
  );
  const speedY = BAR_BASE + 15 + lines.length * NAME_LINE;
  return html`<g class="pitch-${pitch.code}">
    <rect class="pitch-bar" x="${formatNumber(center - barWidth / 2)}" y="${formatNumber(BAR_BASE - barHeight)}" width="${formatNumber(barWidth)}" height="${formatNumber(barHeight)}" rx="2"/>
    <text class="pitch-share" x="${formatNumber(center)}" y="${formatNumber(BAR_BASE - barHeight - 4)}">${percent}%</text>
    <text class="pitch-name" x="${formatNumber(center)}" y="${BAR_BASE + 15}">${nameLines}</text>
    <text class="pitch-speed" x="${formatNumber(center)}" y="${speedY}">${Math.round(pitch.mph)} mph</text>
  </g>`;
}

function renderDot(pitch, { x, y }) {
  const stem =
    y !== LINE_Y &&
    html`<line class="pitch-stem" x1="${formatNumber(x)}" y1="${LINE_Y}" x2="${formatNumber(x)}" y2="${y}"/>`;
  return html`${stem}<circle class="pitch-dot pitch-${pitch.code}" cx="${formatNumber(x)}" cy="${y}" r="${DOT_RADIUS}"/>`;
}

/** @param {{ code: string, name: string, share: number, mph: number }[]} allPitches */
export function renderPitchColumns(allPitches, pitcherName) {
  const pitches = listShownPitches(allPitches);
  if (!pitches.length) return html``;
  const { low, high, toX } = measureScale(pitches);
  const dots = placeDots(pitches, toX);
  const width = (WIDTH - 2 * EDGE) / pitches.length;
  const hasTwoLineName = pitches.some((pitch) => namePitch(pitch).includes(" "));
  const height = BAR_BASE + 32 + (hasTwoLineName ? NAME_LINE : 0);
  const speeds = pitches.map((pitch) => pitch.mph);
  const [first, last] = [toX(Math.min(...speeds)), toX(Math.max(...speeds))];
  const label = `${pitcherName}'s pitches from slowest to fastest, with how often he throws each`;
  return html`<svg class="pitch-columns" viewBox="0 0 ${WIDTH} ${height}" role="img" aria-label="${label}">
    <line class="speed-axis" x1="${EDGE}" y1="${LINE_Y}" x2="${WIDTH - EDGE}" y2="${LINE_Y}"/>
    <line class="speed-range" x1="${formatNumber(first)}" y1="${LINE_Y}" x2="${formatNumber(last)}" y2="${LINE_Y}"/>
    <text class="speed-label" x="${EDGE}" y="${LINE_Y + 16}">${low} mph</text>
    <text class="speed-label end" x="${WIDTH - EDGE}" y="${LINE_Y + 16}">${high}</text>
    <line class="pitch-base" x1="${EDGE}" y1="${BAR_BASE}" x2="${WIDTH - EDGE}" y2="${BAR_BASE}"/>
    ${pitches.map((pitch, index) => renderColumn(pitch, EDGE + width * (index + 0.5), width))}
    ${[...dots.entries()].reverse().map(([pitch, dot]) => renderDot(pitch, dot))}
  </svg>`;
}
