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
// A 1 lights only its right side, so on its own it moves to the middle to look centered.
const LONE_ONE_SHIFT = (WIDTH / 2 - (WIDTH - EDGE - SEGMENT_THICKNESS / 2)).toFixed(2);

/**
 * @param {number} digit
 * @param {boolean} isAlone
 */
function renderDigit(digit, isAlone) {
  const shift = isAlone && digit === 1 ? LONE_ONE_SHIFT : "0";
  const segments = SEGMENTS.map(
    ({ name, box: [x, y, width, height] }) =>
      html`<rect class="${LIT[digit].includes(name) ? "on" : ""}" x="${x}" y="${y}" width="${width}" height="${height}" rx="1.17"/>`,
  );
  return html`<svg viewBox="0 0 ${WIDTH} ${HEIGHT}" aria-hidden="true"><g transform="translate(${shift} 0)">${segments}</g></svg>`;
}

/**
 * A score in lit digits on a dark panel, which still reads as text to a screen reader and a search.
 * @param {number | null} score
 * @param {{ isLoser?: boolean }} [options]
 */
export function renderScoreboard(score, { isLoser = false } = {}) {
  const digits = [...String(score ?? "")].map(Number);
  return html`<span class="scoreboard${isLoser ? " lost" : ""}"
    ><span class="scoreboard-text">${score}</span>${digits.map((digit) =>
      renderDigit(digit, digits.length === 1),
    )}</span
  >`;
}
