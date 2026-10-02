import { test, expect, openApp, GAMES } from "./harness.mjs";
import { holdRequests } from "../../../../tests/browser/hold-requests.mjs";
import { recordSheetMotions } from "../../../../tests/browser/sheet-motions.mjs";
import { recordSheetResizes } from "../../../../tests/browser/sheet-resizes.mjs";
import { listOffScaleText } from "../../../../tests/browser/type-scale.mjs";
import { readOklab } from "../../page/js/sheet-colors.js";
import { TEAMS } from "../../page/js/teams.js";

const ACES_AT_FEVER = "Game details: Aces at Fever, First Round Game 2";
const FEVER_AT_ACES = "Game details: Fever at Aces, First Round Game 3";
const VALKYRIES_AT_WINGS = "Game details: Valkyries at Wings, First Round Game 2";
const POLL_LIVE_MS = 15 * 1000;
// The type scale's smallest size, which the lead chart's words show at with no room above or below.
const SMALLEST_TEXT_PX = 13;
// The room the team stats keep from the parts around them, beyond the usual gap between parts.
const TAPE_ROOM_PX = 8;
// The least room between a team's name, as its font draws it, and the edge of the lead chart's tile.
const NAME_GAP_PX = 4;
// How far, in degrees, the paler bar of the side behind may turn from its team's own hue.
const LARGEST_HUE_TURN = 10;

// Most of these tests are about what a sheet shows, so they skip the eased scrolling between the
// Games lists. The ones about how a sheet moves ask for full motion.
test.use({ contextOptions: { reducedMotion: "reduce" } });

/**
 * A color as the browser computes it.
 * @param {string} hex like #1c1c1c
 */
const formatRgb = (hex) =>
  `rgb(${[1, 3, 5].map((start) => parseInt(hex.slice(start, start + 2), 16)).join(", ")})`;

/**
 * A color's hue in OKLCH, in degrees.
 * @param {string} hex like #1c1c1c
 */
function measureHue(hex) {
  const [, greenRed, blueYellow] = readOklab(hex);
  return (Math.atan2(blueYellow, greenRed) * 180) / Math.PI;
}

/**
 * The color an element's background paints, as hex, whatever form the browser computes it in.
 * @param {import("@playwright/test").Locator} locator
 */
const readPaintedBackground = (locator) =>
  locator.evaluate((element) => {
    const context = /** @type {CanvasRenderingContext2D} */ (
      document.createElement("canvas").getContext("2d")
    );
    context.fillStyle = getComputedStyle(element).backgroundColor;
    context.fillRect(0, 0, 1, 1);
    const [red, green, blue] = context.getImageData(0, 0, 1, 1).data;
    return `#${[red, green, blue].map((channel) => channel.toString(16).padStart(2, "0")).join("")}`;
  });

/**
 * Shows the Games list that has the game a button names, and finds the button.
 * @param {import("@playwright/test").Page} page
 * @param {string} name
 */
async function findGameButton(page, name) {
  await page.getByRole("tab", { name: "Games" }).click();
  for (const list of ["Today", "Previous", "Next"]) {
    await page.getByRole("tab", { name: list }).click();
    const button = page.locator(`#games-${list.toLowerCase()}`).getByRole("button", { name });
    if (await button.count()) return button;
  }
  throw new Error(`No game is named ${name}`);
}

/**
 * Opens the sheet of the game a button names, from whichever of the Games lists has it.
 * @param {import("@playwright/test").Page} page
 * @param {string} name
 */
async function openSheet(page, name) {
  await (await findGameButton(page, name)).click();
  return page.getByRole("dialog");
}

/** @param {import("@playwright/test").Page} page */
const holdBoxScores = (page) => holdRequests(page, (url) => url.pathname === "/box-score");

/**
 * Valkyries at Wings, Game 2, under way in the third quarter: the store's game, and the league's
 * box score as it would read then.
 * @param {any} season
 */
function startValkyriesAtWings(season) {
  const game = season.games.find((each) => each.id === "1042600112");
  Object.assign(game, { state: "live", status: "Q3 4:32", period: 3, clock: "4:32" });
  Object.assign(game.away, { score: 74 });
  Object.assign(game.home, { score: 72, isInBonus: true });
  return season;
}
const liveBoxScore = structuredClone(GAMES.boxScores["1042600112"]);
Object.assign(liveBoxScore.game, { gameStatus: 2, period: 3 });

/** @param {import("@playwright/test").Page} page */
function countBoxScoreReads(page) {
  const reads = { count: 0 };
  page.on("request", (request) => {
    if (new URL(request.url()).pathname === "/box-score") reads.count += 1;
  });
  return reads;
}

test("tapping a final opens its sheet with the score, the box score, and the top scorers, and Done closes it", async ({
  page,
}) => {
  await openApp(page);
  const sheet = await openSheet(page, ACES_AT_FEVER);

  await expect(sheet.getByRole("heading", { level: 2 })).toHaveText("First Round Game 2");
  await expect(sheet.locator("#gameWhen")).toHaveText("Fever won to tie 1-1•Yesterday");
  await expect(sheet.locator(".faceoff .score")).toHaveText(/89\s*99/);
  await expect(sheet.locator(".faceoff-record")).toHaveText(["31-13", "28-16"]);
  await expect(sheet.locator(".line-score tbody tr").first()).toHaveText(
    /Aces\s*26\s*17\s*17\s*29\s*89/,
  );
  await expect(sheet.locator(".tape-label")).toHaveText([
    "Field goals",
    "3-pointers",
    "Free throws",
    "Rebounds",
    "Assists",
    "Turnovers",
    "Points in the paint",
    "Bench points",
  ]);
  await expect(sheet.locator(".tape-row").first().locator(".home .tape-bar i")).toHaveClass("lead");
  await expect(sheet.locator(".players").nth(1).locator("tbody tr").first()).toContainText(
    "Caitlin Clark",
  );
  await expect(sheet.locator(".foul-chip")).toHaveText(["Fouled out"]);

  await sheet.getByRole("button", { name: "Done" }).click();
  await expect(sheet).toBeHidden();
});

test("only the team rows of By quarter have a line above them, not its heading row", async ({
  page,
}) => {
  await openApp(page);
  const sheet = await openSheet(page, ACES_AT_FEVER);
  const lineScore = sheet.locator(".line-score");
  await expect(lineScore.locator("tbody tr")).toHaveCount(2);

  for (const cell of await lineScore.locator("thead td, thead th").all())
    await expect(cell).toHaveCSS("border-top-width", "0px");
  for (const cell of await lineScore.locator("tbody td, tbody th").all())
    await expect(cell).toHaveCSS("border-top-width", "1px");
});

/**
 * Valkyries at Wings, Game 2, over: the Wings won 108-100 in overtime.
 * @param {any} season
 */
function finishValkyriesAtWings(season) {
  const game = season.games.find((each) => each.id === "1042600112");
  Object.assign(game, { state: "final", status: "Final/OT" });
  Object.assign(game.away, { score: 100 });
  Object.assign(game.home, { score: 108 });
  return season;
}

test("a final's sheet charts the lead through the game under its quarters, and one ESPN has no lead for goes without", async ({
  page,
}) => {
  const app = await openApp(page);
  await app.changeSeason(finishValkyriesAtWings);
  const sheet = await openSheet(page, VALKYRIES_AT_WINGS);

  const chart = sheet.locator(".lead-chart");
  await expect(chart.getByRole("img")).toHaveAttribute(
    "aria-label",
    "The Wings led by as many as 8, the Valkyries led by as many as 8",
  );
  await expect(sheet.locator(".sheet-part h3")).toHaveText([
    "By quarter",
    "Lead through the game",
    "Team stats",
    "Top scorers",
  ]);
  await expect(chart.locator(".lead-period")).toHaveText(["Q1", "Q2", "Q3", "Q4", "OT"]);
  await sheet.getByRole("button", { name: "Done" }).click();
  await expect(sheet).toBeHidden();

  await openSheet(page, ACES_AT_FEVER);
  await expect(sheet.locator(".line-score tbody tr")).toHaveCount(2);
  await expect(sheet.locator(".sheet-part h3")).toHaveText([
    "By quarter",
    "Team stats",
    "Top scorers",
  ]);
});

test("the lead chart keeps each biggest lead's label on its tile and each team's name just off it", async ({
  page,
}) => {
  const app = await openApp(page);
  await app.changeSeason(finishValkyriesAtWings);
  const sheet = await openSheet(page, VALKYRIES_AT_WINGS);
  const chart = sheet.locator(".lead-chart");
  await expect(chart.locator(".lead-peak-label")).toHaveText(["Wings +8", "Valkyries +8"]);

  const readBox = (/** @type {import("@playwright/test").Locator} */ locator) =>
    locator.evaluateAll((elements) =>
      elements.map((element) => {
        const { top, bottom, left, right } = element.getBoundingClientRect();
        return { top, bottom, left, right };
      }),
    );
  const [tile] = await readBox(chart.locator(".lead-tile"));
  const [homeName, awayName] = await readBox(chart.locator(".lead-side"));
  const labels = await readBox(chart.locator(".lead-peak-label"));
  expect(tile.top - homeName.bottom).toBeGreaterThanOrEqual(NAME_GAP_PX);
  expect(awayName.top - tile.bottom).toBeGreaterThanOrEqual(NAME_GAP_PX);
  for (const label of labels) {
    expect(label.left).toBeGreaterThanOrEqual(tile.left);
    expect(label.right).toBeLessThanOrEqual(tile.right);
  }
});

for (const { screen, viewport } of [
  { screen: "a phone", viewport: { width: 390, height: 844 } },
  { screen: "a wide screen", viewport: { width: 1280, height: 900 } },
]) {
  test.describe(`on ${screen}`, () => {
    test.use({ viewport });

    test("the lead chart's words show at the type scale's smallest size", async ({ page }) => {
      const app = await openApp(page);
      await app.changeSeason(finishValkyriesAtWings);
      const sheet = await openSheet(page, VALKYRIES_AT_WINGS);
      const words = sheet.locator(
        ".lead-chart :is(.lead-side, .lead-reach, .lead-peak-label, .lead-period)",
      );
      await expect(words).toHaveCount(11);
      const heights = await words.evaluateAll((elements) =>
        elements.map((element) => element.getBoundingClientRect().height),
      );
      for (const height of heights) expect(height).toBeCloseTo(SMALLEST_TEXT_PX, 0);
    });
  });
}

test("the team stats stand further from the parts above and below them than the other parts do from each other", async ({
  page,
}) => {
  const app = await openApp(page);
  await app.changeSeason(finishValkyriesAtWings);
  const sheet = await openSheet(page, VALKYRIES_AT_WINGS);
  await expect(sheet.locator(".lead-peak-label")).toHaveCount(2);
  const parts = await sheet.locator(".game-sheet-body > .sheet-part").evaluateAll((sections) =>
    sections.map((section) => {
      const { top, bottom } = section.getBoundingClientRect();
      return { title: section.querySelector("h3")?.textContent, top, bottom };
    }),
  );
  const gapBefore = (/** @type {string} */ title) => {
    const index = parts.findIndex((part) => part.title === title);
    return parts[index].top - parts[index - 1].bottom;
  };
  const usual = gapBefore("Lead through the game");
  expect(gapBefore("Team stats")).toBeGreaterThanOrEqual(usual + TAPE_ROOM_PX);
  expect(gapBefore("Top scorers")).toBeGreaterThanOrEqual(usual + TAPE_ROOM_PX);
});

test("while the lead loads after the box score, the sheet holds the chart's place, so nothing below it moves as it arrives", async ({
  page,
}) => {
  const app = await openApp(page);
  await app.changeSeason(finishValkyriesAtWings);
  const releaseLead = await holdRequests(page, (url) => url.pathname === "/lead");
  const sheet = await openSheet(page, VALKYRIES_AT_WINGS);
  const teamStats = sheet.locator(".sheet-part h3", { hasText: "Team stats" });
  await expect(sheet.locator(".line-score .total").last()).toHaveText("108");
  await expect(sheet.locator(".lead-tile.pending")).toBeVisible();
  const before = await teamStats.boundingBox();

  releaseLead();

  await expect(sheet.locator(".lead-peak-label")).toHaveCount(2);
  await expect(sheet.locator(".lead-tile.pending")).toHaveCount(0);
  expect((await teamStats.boundingBox())?.y).toBeCloseTo(before?.y ?? 0, 0);
});

test("each team's side of the lead chart and the team stats takes its color, on each theme", async ({
  page,
}) => {
  await page.emulateMedia({ colorScheme: "light" });
  const app = await openApp(page);
  await app.changeSeason(finishValkyriesAtWings);
  const sheet = await openSheet(page, VALKYRIES_AT_WINGS);
  const chart = sheet.locator(".lead-chart");
  const fieldGoals = sheet.locator(".tape-row").first();
  await expect(fieldGoals.locator(".home .tape-bar i")).toHaveClass("lead");

  for (const theme of /** @type {const} */ (["light", "dark"])) {
    await page.emulateMedia({ colorScheme: theme });
    const [awayColor, homeColor] = ["GSV", "DAL"].map((code) =>
      formatRgb(TEAMS[code].chartColors[theme][0]),
    );
    await expect(chart.locator(".lead-side.home")).toHaveCSS("color", homeColor);
    await expect(chart.locator(".lead-peak.home")).toHaveCSS("fill", homeColor);
    await expect(chart.locator(".lead-side.away")).toHaveCSS("color", awayColor);
    await expect(chart.locator(".lead-peak-label.away")).toHaveCSS("color", awayColor);
    await expect(fieldGoals.locator(".home .tape-bar i")).toHaveCSS("background-color", homeColor);
    await expect(fieldGoals.locator(".away .tape-bar i")).not.toHaveCSS(
      "background-color",
      awayColor,
    );
  }
});

test("the side behind on a measure gets a paler bar of its own team's hue, on each theme", async ({
  page,
}) => {
  await page.emulateMedia({ colorScheme: "light" });
  const app = await openApp(page);
  await app.changeSeason(finishValkyriesAtWings);
  const sheet = await openSheet(page, VALKYRIES_AT_WINGS);
  const behind = sheet.locator(".tape-row").first().locator(".away .tape-bar i");
  await expect(behind).not.toHaveClass("lead");

  for (const theme of /** @type {const} */ (["light", "dark"])) {
    await page.emulateMedia({ colorScheme: theme });
    const teamColor = TEAMS.GSV.chartColors[theme][0];
    await expect(behind).not.toHaveCSS("background-color", formatRgb(teamColor));
    const turn = Math.abs(measureHue(await readPaintedBackground(behind)) - measureHue(teamColor));
    expect(Math.min(turn, 360 - turn)).toBeLessThan(LARGEST_HUE_TURN);
  }
});

test("a live game's sheet reads its lead again with its box score", async ({ page }) => {
  const app = await openApp(page, { league: { boxScores: { 1042600112: liveBoxScore } } });
  await app.changeSeason(startValkyriesAtWings);
  const reads = { count: 0 };
  page.on("request", (request) => {
    if (new URL(request.url()).pathname === "/lead") reads.count += 1;
  });
  const sheet = await openSheet(page, VALKYRIES_AT_WINGS);
  await expect(sheet.locator(".lead-chart")).toBeVisible();
  await expect.poll(() => reads.count).toBe(1);

  await page.clock.runFor(POLL_LIVE_MS);

  await expect.poll(() => reads.count).toBe(2);
});

for (const { screen, viewport } of [
  { screen: "a wide screen", viewport: { width: 1280, height: 900 } },
  { screen: "a phone", viewport: { width: 390, height: 844 } },
]) {
  test.describe(`on ${screen}`, () => {
    test.use({ viewport });

    test("every piece of text in a live game's row, its sheet, a final's sheet, and a preview keeps to the type scale", async ({
      page,
    }) => {
      const app = await openApp(page, { league: { boxScores: { 1042600112: liveBoxScore } } });
      await app.changeSeason(startValkyriesAtWings);
      const sheet = await openSheet(page, VALKYRIES_AT_WINGS);
      await expect(page.locator(".bonus").first()).toBeAttached();
      await expect(sheet.locator(".line-score th.now")).toBeVisible();
      expect(await listOffScaleText(page)).toEqual([]);
      await page.keyboard.press("Escape");
      await expect(page.locator(".clock").first()).toBeVisible();
      expect(await listOffScaleText(page)).toEqual([]);
      const final = await openSheet(page, ACES_AT_FEVER);
      await expect(final.locator(".line-score")).toBeVisible();
      expect(await listOffScaleText(page)).toEqual([]);
      await page.keyboard.press("Escape");
      await expect(final).toBeHidden();
      const preview = await openSheet(page, FEVER_AT_ACES);
      await expect(preview.locator(".meeting-score").first()).toBeVisible();
      expect(await listOffScaleText(page)).toEqual([]);
    });
  });
}

test("a live game's sheet reads its box score again as often as the score, until it closes", async ({
  page,
}) => {
  const app = await openApp(page, { league: { boxScores: { 1042600112: liveBoxScore } } });
  await app.changeSeason(startValkyriesAtWings);
  const reads = countBoxScoreReads(page);
  const sheet = await openSheet(page, VALKYRIES_AT_WINGS);

  await expect(sheet.locator(".faceoff .clock")).toHaveText("Q3 4:32");
  await expect(sheet.locator(".faceoff-side.home .bonus")).toHaveText("Bonus");
  await expect(sheet.locator(".line-score th.now")).toHaveText("3");
  await expect(sheet.locator(".sheet-part-head", { hasText: "Team stats" })).toContainText(
    "So far",
  );
  await expect(sheet.locator(".foul-chip")).toHaveText(["Fouled out", "5 fouls", "4 fouls"]);
  await expect.poll(() => reads.count).toBe(1);

  await page.clock.runFor(POLL_LIVE_MS);
  await expect.poll(() => reads.count).toBe(2);

  await app.changeSeason((season) => {
    season.games.find((each) => each.id === "1042600112").away.score = 77;
    return season;
  });
  await expect(sheet.locator(".faceoff .score")).toHaveText(/77\s*72/);

  await sheet.getByRole("button", { name: "Done" }).click();
  await page.clock.runFor(POLL_LIVE_MS * 2);
  expect(reads.count).toBe(2);
});

test("a game that hasn't started previews the meetings, the season stats, and the leading scorers", async ({
  page,
}) => {
  await openApp(page);
  const sheet = await openSheet(page, FEVER_AT_ACES);

  await expect(sheet.getByRole("heading", { level: 2 })).toHaveText("First Round Game 3");
  await expect(sheet.locator(".faceoff .time")).toHaveText(/^9:00\sPM$/);
  await expect(sheet.locator(".sheet-part-head").first()).toHaveText(
    /Meetings\s*Fever won the season series 2-1/,
  );
  await expect(sheet.locator(".meetings li")).toHaveCount(3);
  await expect(sheet.locator(".meetings li").first()).toHaveText(
    /Aug 6\s*Aces\s*86-84\s*on the road/,
  );
  await expect(sheet.locator(".tape-label")).toHaveText([
    "Record",
    "PPG",
    "Opp PPG",
    "Margin",
    /^Road\s+Home$/,
    "Last 10",
  ]);
  await expect(sheet.locator(".tape-note")).toHaveCount(0);
  await expect(sheet.locator(".players tbody tr").first()).toHaveText(
    /Kelsey Mitchell\s*24\.7\s*1\.7\s*2\.8/,
  );
});

test("a sheet open on a preview switches to the box score once the game starts", async ({
  page,
}) => {
  const app = await openApp(page, { league: { boxScores: { 1042600112: liveBoxScore } } });
  const sheet = await openSheet(page, VALKYRIES_AT_WINGS);
  await expect(sheet.locator(".meetings")).toBeVisible();

  await app.changeSeason(startValkyriesAtWings);

  await expect(sheet.locator(".line-score")).toBeVisible();
  await expect(sheet.locator(".meetings")).toHaveCount(0);
  await expect(sheet.locator(".faceoff .clock")).toHaveText("Q3 4:32");
});

test("a game the league has no box score for says so, and a preview whose meetings can't load shows the rest", async ({
  page,
}) => {
  await openApp(page, { league: { isScheduleRefused: true } });
  const sheet = await openSheet(page, "Game details: Fever at Aces, First Round Game 1");
  await expect(sheet.locator(".sheet-message")).toHaveText(
    "The league hasn't posted a box score for this game yet.",
  );
  await sheet.getByRole("button", { name: "Done" }).click();

  const preview = await openSheet(page, FEVER_AT_ACES);
  await expect(preview.locator(".sheet-message")).toHaveText(
    "Couldn't load this season's meetings.",
  );
  await expect(preview.locator(".tape-label")).toHaveCount(6);
  await expect(preview.locator(".players tbody tr")).toHaveCount(6);
});

test("a preview takes the season stats and leading scorers from the store as it changes", async ({
  page,
}) => {
  const app = await openApp(page);
  const sheet = await openSheet(page, FEVER_AT_ACES);
  await expect(sheet.locator(".players tbody tr")).toHaveCount(6);

  await app.changeSeason((season) => ({ ...season, leaders: [] }));

  await expect(sheet.locator(".sheet-message")).toHaveText("Couldn't load the players' averages.");
  await expect(sheet.locator(".tape-label")).toHaveCount(6);
});

test("a sheet the Worker can't load says to try again", async ({ page }) => {
  await openApp(page);
  await page.route(
    (url) => url.pathname === "/box-score",
    (route) => route.fulfill({ status: 502, json: { error: "Couldn't read the WNBA: test" } }),
  );
  const sheet = await openSheet(page, ACES_AT_FEVER);
  await expect(sheet.locator(".sheet-message")).toHaveText(
    "Couldn't load the box score. Close and try again in a minute.",
  );
});

test("while its box score loads, the sheet holds the box score's shape, then fills it in", async ({
  page,
}) => {
  await openApp(page);
  const release = await holdBoxScores(page);
  const sheet = await openSheet(page, ACES_AT_FEVER);
  const body = sheet.locator("#gameBody");

  await expect(body).toHaveAttribute("aria-busy", "true");
  await expect(sheet.locator(".sheet-part-head h3")).toHaveText([
    "By quarter",
    "Team stats",
    "Top scorers",
  ]);
  await expect(sheet.locator(".tape-label")).toHaveCount(8);
  await expect(sheet.locator(".line-score tbody th")).toHaveText(["Aces", "Fever"]);
  await expect(sheet.locator(".players tbody tr")).toHaveCount(6);
  await expect(sheet.locator(".tape-value .placeholder")).toHaveCount(16);

  release();
  await expect(sheet.locator(".line-score tbody tr").first()).toHaveText(
    /Aces\s*26\s*17\s*17\s*29\s*89/,
  );
  await expect(sheet.locator(".placeholder")).toHaveCount(0);
  await expect(body).toHaveAttribute("aria-busy", "false");
});

test("while its meetings load, the sheet holds their shape, with the season stats and leading scorers already in", async ({
  page,
}) => {
  await openApp(page);
  const release = await holdRequests(page, (url) => url.pathname === "/preview");
  const sheet = await openSheet(page, FEVER_AT_ACES);

  await expect(sheet.locator(".sheet-part-head h3")).toHaveText([
    "Meetings",
    "Season stats",
    "Leading scorers",
  ]);
  await expect(sheet.locator(".meetings .placeholder")).toHaveCount(9);
  await expect(sheet.locator(".placeholder")).toHaveCount(9);
  await expect(sheet.locator(".tape-label")).toHaveCount(6);
  await expect(sheet.locator(".players tbody tr").first()).toHaveText(
    /Kelsey Mitchell\s*24\.7\s*1\.7\s*2\.8/,
  );

  release();
  await expect(sheet.locator(".meetings li")).toHaveCount(3);
  await expect(sheet.locator(".placeholder")).toHaveCount(0);
});

test("a finger coming down on a game starts reading its box score, and the sheet the tap opens uses that read", async ({
  page,
}) => {
  await openApp(page);
  const reads = countBoxScoreReads(page);
  const button = await findGameButton(page, ACES_AT_FEVER);

  await button.dispatchEvent("pointerdown");
  await expect.poll(() => reads.count).toBe(1);

  await button.click();
  await expect(page.getByRole("dialog").locator(".line-score")).toBeVisible();
  expect(reads.count).toBe(1);
});

test("a sheet that can't load its box score eases from the box score's shape down to the message", async ({
  page,
}) => {
  const readResizes = await recordSheetResizes(page);
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await openApp(page);
  await page.route(
    (url) => url.pathname === "/box-score",
    (route) => route.fulfill({ status: 502, json: { error: "Couldn't read the WNBA: test" } }),
  );
  const release = await holdBoxScores(page);
  const sheet = await openSheet(page, ACES_AT_FEVER);
  await expect(sheet.locator(".tape-label")).toHaveCount(8);

  release();
  await expect(sheet.locator(".sheet-message")).toBeVisible();
  const resizes = (await readResizes()).filter((resize) => resize.id === "gameDialog");
  expect(resizes).toHaveLength(1);
  const [from, to] = resizes[0].heights.map(parseFloat);
  expect(to).toBeLessThan(from);
});

test("with less motion asked for, a sheet takes its new height at once", async ({ page }) => {
  const readResizes = await recordSheetResizes(page);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await openApp(page);
  await page.route(
    (url) => url.pathname === "/box-score",
    (route) => route.fulfill({ status: 502, json: { error: "Couldn't read the WNBA: test" } }),
  );
  const sheet = await openSheet(page, ACES_AT_FEVER);

  await expect(sheet.locator(".sheet-message")).toBeVisible();
  expect(await readResizes()).toEqual([]);
});

test("no text in a game's sheet is smaller than 10.5px, in its box score or its preview", async ({
  page,
}) => {
  await openApp(page);
  for (const name of [ACES_AT_FEVER, FEVER_AT_ACES]) {
    const sheet = await openSheet(page, name);
    await expect(sheet.locator("#gameBody")).toHaveAttribute("aria-busy", "false");
    const smallest = await sheet.evaluate((dialog) =>
      Math.min(
        ...[...dialog.querySelectorAll("*")]
          .filter((element) =>
            [...element.childNodes].some((node) => node.nodeType === 3 && node.textContent.trim()),
          )
          .map((element) => parseFloat(getComputedStyle(element).fontSize)),
      ),
    );
    expect(smallest, name).toBeGreaterThanOrEqual(10.5);
    await sheet.getByRole("button", { name: "Done" }).click();
    await expect(sheet).toBeHidden();
  }
});

test.describe("on a phone", () => {
  test.use({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
    contextOptions: { reducedMotion: "no-preference" },
  });

  test("the game sheet rises from the bottom, with a grabber in place of Done", async ({
    page,
  }) => {
    await openApp(page);
    const sheet = await openSheet(page, ACES_AT_FEVER);
    await expect(sheet.locator(".sheet-grabber")).toBeVisible();
    await page.waitForFunction(() => document.getAnimations().length === 0);
    await expect(sheet.getByRole("button", { name: "Done" })).toHaveCSS("width", "1px");
    const box = await sheet.boundingBox();
    expect(Math.round(box.y + box.height)).toBe(844);
    expect(box.width).toBe(390);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
  });

  test("the game sheet's backdrop fades in, and Done, a tap outside, or Escape slides the sheet down as the backdrop fades out", async ({
    page,
  }) => {
    const readMotions = await recordSheetMotions(page);
    await openApp(page);
    const closings = {
      Done: () => page.locator("#gameDoneBtn").dispatchEvent("click"),
      "a tap outside": () => page.touchscreen.tap(195, 20),
      Escape: () => page.keyboard.press("Escape"),
    };
    for (const [way, close] of Object.entries(closings)) {
      const sheet = await openSheet(page, ACES_AT_FEVER);
      await expect.poll(readMotions, way).toContainEqual({
        id: "gameDialog",
        part: "::backdrop",
        name: "backdrop-fade-in",
      });
      await page.waitForFunction(() => document.getAnimations().length === 0);
      await readMotions();

      await close();
      await expect(sheet, way).toBeHidden();
      expect(await readMotions(), way).toEqual([
        { id: "gameDialog", part: "sheet", to: { transform: "translateY(100%)" } },
        { id: "gameDialog", part: "::backdrop", to: { opacity: 0 } },
      ]);
    }
  });
});

/**
 * How far down each of a text's words sits, so a test can tell which line it's on.
 * @param {import("@playwright/test").Locator} element
 */
const readWordTops = (element) =>
  element.evaluate((root) => {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const tops = [];
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const text = /** @type {Text} */ (node);
      for (const word of text.data.matchAll(/\S+/g)) {
        const range = document.createRange();
        range.setStart(text, word.index);
        range.setEnd(text, word.index + word[0].length);
        tops.push({ word: word[0], top: Math.round(range.getBoundingClientRect().top) });
      }
    }
    return tops;
  });

/** @param {{ word: string, top: number }[]} tops */
const groupLines = (tops) =>
  [...new Set(tops.map(({ top }) => top))].map((line) =>
    tops
      .filter(({ top }) => top === line)
      .map(({ word }) => word)
      .join(" "),
  );

test.describe("on a phone, with less motion", () => {
  test.use({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
  });

  test("a team stat's label that takes two lines splits them evenly", async ({ page }) => {
    await openApp(page);
    const sheet = await openSheet(page, ACES_AT_FEVER);
    const label = sheet.locator(".tape-label", { hasText: "Points in the paint" });
    await expect(label).toBeVisible();

    expect(groupLines(await readWordTops(label))).toEqual(["Points in", "the paint"]);
  });

  test("the game's facts under the team stats break only after a dot, each fact on one line", async ({
    page,
  }) => {
    const app = await openApp(page, { league: { boxScores: { 1042600112: liveBoxScore } } });
    await app.changeSeason(startValkyriesAtWings);
    const sheet = await openSheet(page, VALKYRIES_AT_WINGS);
    const note = sheet.locator(".tape-note");
    await expect(note).toContainText("Timeouts left");

    expect(groupLines(await readWordTops(note))).toEqual([
      "Biggest lead: Valkyries 8, Wings 8 \u2022 Lead changes: 15 \u2022",
      "Ties: 14 \u2022 Timeouts left: Valkyries 0, Wings 1",
    ]);
  });
});

test("a team's name in a game's row opens its sheet, set like the row's other names, and the rest of the row opens the game", async ({
  page,
}) => {
  await openApp(page);
  const gameButton = await findGameButton(page, ACES_AT_FEVER);
  const row = gameButton.locator("xpath=..");
  const fever = row.getByRole("button", { name: "Team details: Indiana Fever" });
  await expect(fever).toHaveCSS("font-family", /^"Barlow Condensed"/);
  await expect(fever).toHaveCSS("font-weight", "600");
  const aces = row.getByRole("button", { name: "Team details: Las Vegas Aces" });
  const acesBox = await aces.boundingBox();
  const awaySideBox = await row.locator(".game-side.away").boundingBox();
  expect(acesBox.width).toBeLessThan(awaySideBox.width / 2);

  await fever.click();
  const teamSheet = page.locator("#teamDialog");
  await expect(teamSheet.locator("#teamTitle")).toHaveText("Indiana Fever");
  await expect(page.locator("#gameDialog")).toBeHidden();
  await teamSheet.getByRole("button", { name: "Done" }).click();
  await expect(teamSheet).toBeHidden();

  await gameButton.click();
  await expect(page.locator("#gameTitle")).toHaveText("First Round Game 2");
});

test("a team's name in a game's sheet opens its sheet over the game's, and Done goes back to the game", async ({
  page,
}) => {
  await openApp(page);
  await (await findGameButton(page, ACES_AT_FEVER)).click();
  const gameSheet = page.locator("#gameDialog");
  await expect(gameSheet.locator(".line-score")).toBeVisible();
  const teamSheet = page.locator("#teamDialog");

  for (const place of [".faceoff", ".line-score", ".players"]) {
    await gameSheet
      .locator(place)
      .first()
      .getByRole("button", { name: "Team details: Las Vegas Aces" })
      .click();
    await expect(teamSheet.locator("#teamTitle")).toHaveText("Las Vegas Aces");
    await teamSheet.getByRole("button", { name: "Done" }).click();
    await expect(teamSheet).toBeHidden();
    await expect(gameSheet).toBeVisible();
  }
});

test("closing a team's sheet over a game's sheet leaves no focus ring around the game's", async ({
  page,
}) => {
  await openApp(page);
  await (await findGameButton(page, ACES_AT_FEVER)).click();
  const gameSheet = page.locator("#gameDialog");
  await expect(gameSheet.locator(".line-score")).toBeVisible();
  // On an iPhone a tapped button never takes focus, so the game's sheet keeps it.
  await gameSheet.evaluate((dialog) => dialog.focus());
  await gameSheet
    .locator(".faceoff")
    .getByRole("button", { name: "Team details: Las Vegas Aces" })
    .dispatchEvent("click");
  const teamSheet = page.locator("#teamDialog");
  await expect(teamSheet.locator("#teamTitle")).toHaveText("Las Vegas Aces");

  await page.keyboard.press("Escape");
  await expect(teamSheet).toBeHidden();
  await expect(gameSheet).toBeFocused();
  await expect(gameSheet).toHaveCSS("outline-style", "none");
});

/**
 * Opens the sheet of today's game between the Mystics and the Dream, which ESPN carries.
 * @param {import("@playwright/test").Page} page
 */
async function openWashingtonSheet(page) {
  await page.getByRole("tab", { name: "Games" }).click();
  await page.locator('#games-today [data-game="1042600132"] .game-open').click();
  return page.getByRole("dialog");
}

test("a game's sheet says where to watch it until it ends, and its row doesn't", async ({
  page,
}) => {
  const app = await openApp(page);
  const sheet = await openWashingtonSheet(page);
  const networks = sheet.getByRole("group", { name: "Where to watch" });
  await expect(networks.getByRole("img")).toHaveAttribute("alt", "ESPN");
  await expect(networks.getByRole("img")).toBeVisible();
  await expect(page.locator("#gamePager .network-logo")).toHaveCount(0);
  const faceOff = await sheet.locator(".faceoff-middle").boundingBox();
  const logo = await networks.getByRole("img").boundingBox();
  expect(logo.y).toBeGreaterThan(faceOff.y + faceOff.height);
  const readRoomBelow = () =>
    sheet.locator(".faceoff").evaluate((element) => getComputedStyle(element).paddingBottom);
  const roomBelowLogos = await readRoomBelow();

  await app.changeSeason((season) => {
    const game = season.games.find((each) => each.id === "1042600132");
    Object.assign(game, { state: "final", status: "Final", networks: [] });
    Object.assign(game.away, { score: 80 });
    Object.assign(game.home, { score: 77 });
    return season;
  });
  await expect(sheet.locator(".faceoff-status")).toHaveText("Final");
  await expect(networks).toHaveCount(0);
  expect(parseFloat(await readRoomBelow())).toBeGreaterThan(parseFloat(roomBelowLogos));
});

/** @type {["light" | "dark", string, string][]} */
const LOGO_LOOKS = [
  ["light", "for-light", "for-dark"],
  ["dark", "for-dark", "for-light"],
];
for (const [scheme, shown, hidden] of LOGO_LOOKS) {
  test(`in the ${scheme} look, a sheet shows each channel's logo in its version for that background`, async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme: scheme });
    const app = await openApp(page);
    await app.changeSeason((season) => {
      season.games.find((each) => each.id === "1042600132").networks = ["NBC", "ESPN"];
      return season;
    });
    const sheet = await openWashingtonSheet(page);
    const logo = sheet.locator(`.network-logo.${shown}`);
    await expect(logo).toBeVisible();
    await expect(logo).toHaveJSProperty("complete", true);
    await expect(logo).not.toHaveJSProperty("naturalWidth", 0);
    await expect(sheet.locator(`.network-logo.${hidden}`)).toBeHidden();
    await expect(sheet.getByRole("img", { name: "ESPN" })).toBeVisible();
  });
}

test("in a sheet, a square badge is drawn taller than a long wordmark", async ({ page }) => {
  const app = await openApp(page);
  await app.changeSeason((season) => {
    season.games.find((each) => each.id === "1042600132").networks = ["ABC", "ESPN"];
    return season;
  });
  const sheet = await openWashingtonSheet(page);
  const abc = await sheet.getByRole("img", { name: "ABC" }).boundingBox();
  const espn = await sheet.getByRole("img", { name: "ESPN" }).boundingBox();
  expect(abc.height).toBeGreaterThan(espn.height * 1.2);
  expect(espn.height).toBeGreaterThan(10);
});
