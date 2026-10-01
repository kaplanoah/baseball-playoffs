import { test, expect, openApp, GAMES } from "./harness.mjs";
import { holdRequests } from "../../../../tests/browser/hold-requests.mjs";
import { recordSheetResizes } from "../../../../tests/browser/sheet-resizes.mjs";

const ACES_AT_FEVER = "Game details: Aces at Fever, First Round Game 2";
const FEVER_AT_ACES = "Game details: Fever at Aces, First Round Game 3";
const VALKYRIES_AT_WINGS = "Game details: Valkyries at Wings, First Round Game 2";
const POLL_LIVE_MS = 15 * 1000;

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
  await expect(sheet.locator("#gameWhen")).toHaveText("Tied 1-1•Yesterday");
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
  await expect(sheet.locator(".sheet-part-head").nth(1)).toContainText("So far");
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

test("a game that hasn't started previews the meetings, the two seasons, and the leading scorers", async ({
  page,
}) => {
  await openApp(page);
  const sheet = await openSheet(page, FEVER_AT_ACES);

  await expect(sheet.getByRole("heading", { level: 2 })).toHaveText("First Round Game 3");
  await expect(sheet.locator(".faceoff .time")).toHaveText(/^9:00\sPM$/);
  await expect(sheet.locator(".sheet-part-head").first()).toHaveText(
    /Meetings\s*Fever won the season series 2-1/,
  );
  await expect(sheet.locator(".meetings li")).toHaveCount(5);
  await expect(sheet.locator(".meetings li").first()).toHaveText(
    /Sep 29\s*Fever\s*99-89\s*1st Rd G2/,
  );
  await expect(sheet.locator(".tape-label")).toHaveText([
    "Record",
    "Points",
    "Allowed",
    "Margin",
    "Road / Home",
    "Last 10",
  ]);
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

test("a game the league has no box score for says so, and a preview shows the parts that loaded", async ({
  page,
}) => {
  await openApp(page, { league: { refused: ["players"] } });
  const sheet = await openSheet(page, "Game details: Fever at Aces, First Round Game 1");
  await expect(sheet.locator(".sheet-message")).toHaveText(
    "The league hasn't posted a box score for this game yet.",
  );
  await sheet.getByRole("button", { name: "Done" }).click();

  const preview = await openSheet(page, FEVER_AT_ACES);
  await expect(preview.locator(".meetings li")).toHaveCount(5);
  await expect(preview.locator(".sheet-message")).toHaveText(
    "Couldn't load the players' averages.",
  );
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

test("while its preview loads, the sheet holds the preview's shape, then fills it in", async ({
  page,
}) => {
  await openApp(page);
  const release = await holdRequests(page, (url) => url.pathname === "/preview");
  const sheet = await openSheet(page, FEVER_AT_ACES);

  await expect(sheet.locator(".sheet-part-head h3")).toHaveText([
    "Meetings",
    "The two seasons",
    "Leading scorers",
  ]);
  await expect(sheet.locator(".meetings .placeholder")).toHaveCount(9);
  await expect(sheet.locator(".tape-label")).toHaveCount(6);
  await expect(sheet.locator(".players tbody tr")).toHaveCount(6);

  release();
  await expect(sheet.locator(".meetings li")).toHaveCount(5);
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

test.describe("on a phone", () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

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
});
