import { html } from "#shared/html.js";

// A score as an arena scoreboard shows it: seven-segment digits, each segment lit or not.

const SEGMENT_THICKNESS = 2.6;
const [WIDTH, HEIGHT, EDGE, GAP] = [14, 24, 0.4, 0.45];

/** Segments a to g on a 14 by 24 grid, as [x, y, width, height]. */
function buildSegments() {
  const acrossX = EDGE + SEGMENT_THICKNESS / 2 + GAP;
  const acrossWidth = WIDTH - 2 * acrossX;
  const sideHeight = HEIGHT / 2 - EDGE - SEGMENT_THICKNESS / 2 - 2 * GAP;
  const upperY = EDGE + SEGMENT_THICKNESS / 2 + GAP;
  const lowerY = HEIGHT / 2 + GAP;
  const right = WIDTH - EDGE - SEGMENT_THICKNESS;
  return {
    a: [acrossX, EDGE, acrossWidth, SEGMENT_THICKNESS],
    b: [right, upperY, SEGMENT_THICKNESS, sideHeight],
    c: [right, lowerY, SEGMENT_THICKNESS, sideHeight],
    d: [acrossX, HEIGHT - EDGE - SEGMENT_THICKNESS, acrossWidth, SEGMENT_THICKNESS],
    e: [EDGE, lowerY, SEGMENT_THICKNESS, sideHeight],
    f: [EDGE, upperY, SEGMENT_THICKNESS, sideHeight],
    g: [acrossX, HEIGHT / 2 - SEGMENT_THICKNESS / 2, acrossWidth, SEGMENT_THICKNESS],
  };
}
const SEGMENTS = Object.entries(buildSegments()).map(([name, box]) => ({
  name,
  box: box.map((value) => value.toFixed(2)),
}));
const LIT = [
  "abcdef",
  "bc",
  "abdeg",
  "abcdg",
  "bcfg",
  "acdfg",
  "acdefg",
  "abc",
  "abcdefg",
  "abcdfg",
];

/** @param {number | null} digit null for a place the score doesn't reach */
function renderDigit(digit) {
  const lit = digit === null ? "" : LIT[digit];
  const segments = SEGMENTS.map(
    ({ name, box: [x, y, width, height] }) =>
      html`<rect class="${lit.includes(name) ? "on" : ""}" x="${x}" y="${y}" width="${width}" height="${height}" rx="1.17"/>`,
  );
  return html`<svg viewBox="0 0 ${WIDTH} ${HEIGHT}" aria-hidden="true">${segments}</svg>`;
}

// A basketball score never reaches 200, so, as on an arena's board, its hundreds place is a narrow
// one that holds just a 1's two segments.
const HUNDREDS_WIDTH = (SEGMENT_THICKNESS + 2 * EDGE).toFixed(2);
const HUNDREDS_SEGMENTS = SEGMENTS.filter(({ name }) => "bc".includes(name)).map(
  ({ box: [, y, width, height] }) => ({ box: [EDGE.toFixed(2), y, width, height] }),
);

/** @param {boolean} isLit */
function renderHundreds(isLit) {
  const segments = HUNDREDS_SEGMENTS.map(
    ({ box: [x, y, width, height] }) =>
      html`<rect class="${isLit ? "on" : ""}" x="${x}" y="${y}" width="${width}" height="${height}" rx="1.17"/>`,
  );
  return html`<svg class="hundreds" viewBox="0 0 ${HUNDREDS_WIDTH} ${HEIGHT}" aria-hidden="true"
    >${segments}</svg
  >`;
}

/**
 * The tens and ones a score lights, with a 0 for the tens once a score reaches 100.
 * @param {number | null} score
 */
function readLastTwoPlaces(score) {
  if (score === null) return [null, null];
  const places = String(score % 100).padStart(2, score >= 100 ? "0" : " ");
  return [...places].map((place) => (place === " " ? null : Number(place)));
}

/**
 * A score in lit digits on a dark panel, which still reads as text to a screen reader and a search.
 * Every panel holds the same places, so all are one width, and the places a score doesn't reach
 * stay dark.
 * @param {number | null} score
 * @param {{ isLoser?: boolean }} [options]
 */
export function renderScoreboard(score, { isLoser = false } = {}) {
  return html`<span class="scoreboard${isLoser ? " lost" : ""}"
    ><span class="scoreboard-text">${score}</span>${renderHundreds((score ?? 0) >= 100)}${readLastTwoPlaces(
      score,
    ).map(renderDigit)}</span
  >`;
}
