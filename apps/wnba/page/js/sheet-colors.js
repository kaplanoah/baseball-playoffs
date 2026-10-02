import { TEAMS } from "./teams.js";

// The game sheet draws each team's side of its charts and bars in the team's own color, on each
// theme. When the two teams' colors look alike, the away team takes its other color, and only if
// neither of its colors will do does the home team take its other one too. A team's sheet draws the
// team's side of its stats in the team's own first color, across from the league's in gray.

const THEMES = /** @type {const} */ (["light", "dark"]);
// How far apart two colors are in OKLab before one side reads apart from the other at a glance.
const SMALLEST_DISTANCE = 0.15;
// Which of the home and away teams' colors to try, in order.
const CHOICES = [
  [0, 0],
  [0, 1],
  [1, 0],
  [1, 1],
];

/** @param {number} channel from 0 to 1 */
const linearize = (channel) =>
  channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;

/**
 * @param {string} hex like #1c1c1c
 * @returns {[number, number, number]}
 */
export function readOklab(hex) {
  const [red, green, blue] = [1, 3, 5].map((start) =>
    linearize(parseInt(hex.slice(start, start + 2), 16) / 255),
  );
  const long = Math.cbrt(0.4122214708 * red + 0.5363325363 * green + 0.0514459929 * blue);
  const medium = Math.cbrt(0.2119034982 * red + 0.6806995451 * green + 0.1073969566 * blue);
  const short = Math.cbrt(0.0883024619 * red + 0.2817188376 * green + 0.6299787005 * blue);
  return [
    0.2104542553 * long + 0.793617785 * medium - 0.0040720468 * short,
    1.9779984951 * long - 2.428592205 * medium + 0.4505937099 * short,
    0.0259040371 * long + 0.7827717662 * medium - 0.808675766 * short,
  ];
}

/**
 * @param {string} first
 * @param {string} second
 */
export function measureColorDistance(first, second) {
  const [firstPoint, secondPoint] = [readOklab(first), readOklab(second)];
  return Math.hypot(...firstPoint.map((value, index) => value - secondPoint[index]));
}

/**
 * The colors the two teams' sides take on one theme.
 * @param {string} away
 * @param {string} home
 * @param {"light" | "dark"} theme
 */
export function pickSheetColors(away, home, theme) {
  const awayColors = TEAMS[away].chartColors[theme];
  const homeColors = TEAMS[home].chartColors[theme];
  const [homeIndex, awayIndex] =
    CHOICES.find(
      ([homeChoice, awayChoice]) =>
        measureColorDistance(awayColors[awayChoice], homeColors[homeChoice]) >= SMALLEST_DISTANCE,
    ) ?? CHOICES[CHOICES.length - 1];
  return { away: awayColors[awayIndex], home: homeColors[homeIndex] };
}

/**
 * The style that hands the sheet each team's color on each theme, or none while a team isn't
 * known.
 * @param {string | null} away
 * @param {string | null} home
 */
export function formatSheetColors(away, home) {
  if (!away || !home || !TEAMS[away] || !TEAMS[home]) return "";
  return THEMES.map((theme) => {
    const colors = pickSheetColors(away, home, theme);
    return `--away-${theme}: ${colors.away}; --home-${theme}: ${colors.home};`;
  }).join(" ");
}

/**
 * The style that hands a team's sheet the team's color on each theme.
 * @param {string} code
 */
export const formatTeamColors = (code) =>
  THEMES.map((theme) => `--team-${theme}: ${TEAMS[code].chartColors[theme][0]};`).join(" ");
