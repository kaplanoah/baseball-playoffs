import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  formatSheetColors,
  measureColorDistance,
  pickSheetColors,
} from "../page/js/sheet-colors.js";
import { TEAMS } from "../page/js/teams.js";

const STYLES = readFileSync(`${import.meta.dirname}/../page/styles.css`, "utf8");
const THEMES = /** @type {const} */ (["light", "dark"]);
const CODES = Object.keys(TEAMS);
// What a team's name needs to read, as WCAG asks of text its size.
const SMALLEST_CONTRAST = 4.5;

/**
 * A token's value in the block of styles.css that a selector opens.
 * @param {string} selector
 * @param {string} token
 */
function readToken(selector, token) {
  const block = STYLES.slice(STYLES.indexOf(`${selector} {`));
  return block.match(new RegExp(`${token}: (#[0-9a-f]{6});`))[1];
}

/** @param {string} hex */
function measureLuminance(hex) {
  const [red, green, blue] = [1, 3, 5].map((start) => {
    const channel = parseInt(hex.slice(start, start + 2), 16) / 255;
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

/**
 * @param {string} first
 * @param {string} second
 */
function measureContrast(first, second) {
  const [lighter, darker] = [measureLuminance(first), measureLuminance(second)].sort(
    (one, other) => other - one,
  );
  return (lighter + 0.05) / (darker + 0.05);
}

// The lead chart's tile is a mix of the sheet and the floor, so reading on both reads on it too.
test("every team's chart colors read as text on the sheet and the floor, on each theme", () => {
  const surfaces = {
    light: [readToken(":root", "--card"), readToken(":root", "--bg")],
    dark: [
      readToken(':root[data-theme="dark"]', "--card"),
      readToken(':root[data-theme="dark"]', "--bg"),
    ],
  };
  for (const code of CODES) {
    for (const theme of THEMES) {
      for (const color of TEAMS[code].chartColors[theme]) {
        for (const surface of surfaces[theme]) {
          const contrast = measureContrast(color, surface);
          assert.ok(
            contrast >= SMALLEST_CONTRAST,
            `${code}'s ${color} on ${surface} is ${contrast.toFixed(2)} to 1`,
          );
        }
      }
    }
  }
});

test("every pairing of teams, either way round, gets two colors that read apart, on each theme", () => {
  for (const away of CODES) {
    for (const home of CODES.filter((code) => code !== away)) {
      for (const theme of THEMES) {
        const colors = pickSheetColors(away, home, theme);
        assert.ok(
          measureColorDistance(colors.away, colors.home) >= 0.15,
          `${away} at ${home} on ${theme}: ${colors.away} and ${colors.home}`,
        );
      }
    }
  }
});

test("each team keeps its first color unless it looks like the other team's", () => {
  assert.deepEqual(pickSheetColors("GSV", "DAL", "light"), {
    away: TEAMS.GSV.chartColors.light[0],
    home: TEAMS.DAL.chartColors.light[0],
  });
  // The Dream and the Mystics are both red, so the Dream, away, take their blue.
  for (const theme of THEMES)
    assert.deepEqual(pickSheetColors("ATL", "WAS", theme), {
      away: TEAMS.ATL.chartColors[theme][1],
      home: TEAMS.WAS.chartColors[theme][0],
    });
});

test("when neither of the away team's colors reads apart from the home team's first, the home team takes its other", () => {
  // Both of the Storm's colors are too near the Wings' olive, so the Wings take their navy.
  assert.deepEqual(pickSheetColors("SEA", "DAL", "light"), {
    away: TEAMS.SEA.chartColors.light[0],
    home: TEAMS.DAL.chartColors.light[1],
  });
});

test("the sheet's style hands it each side's color on each theme, and nothing while a team isn't known", () => {
  assert.equal(
    formatSheetColors("ATL", "WAS"),
    `--away-light: ${TEAMS.ATL.chartColors.light[1]}; --home-light: ${TEAMS.WAS.chartColors.light[0]}; ` +
      `--away-dark: ${TEAMS.ATL.chartColors.dark[1]}; --home-dark: ${TEAMS.WAS.chartColors.dark[0]};`,
  );
  assert.equal(formatSheetColors(null, "LVA"), "");
});
