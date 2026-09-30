import { test, expect, openApp, buildSnapshotWithStarters } from "./harness.mjs";

// What the Worker answers for Astros at Athletics' starters, Blubaugh and Springs.
const describePitcher = (id, name, hand, line, ranks, pitches) => ({
  id,
  name,
  hand,
  age: 27,
  line,
  ranks,
  starters: { count: 141, minimum: 17 },
  pitches,
  starts: [
    { date: "2026-09-19", opp: "SEA", home: true, ip: "5.2", runs: 2, k: 6 },
    { date: "2026-09-13", opp: "TEX", home: false, ip: "6.0", runs: 0, k: 8 },
  ],
});
const PITCHERS = {
  1: describePitcher(
    1,
    "AJ Blubaugh",
    "R",
    { era: "3.66", k9: 9.1, bb9: 3.4, speed: 95.4 },
    {
      era: { rank: 50, of: 141 },
      k9: { rank: 8, of: 141 },
      bb9: { rank: 100, of: 141 },
      speed: { rank: 29, of: 141 },
    },
    [
      { code: "FF", name: "Four-seam FB", share: 0.52, mph: 95.4 },
      { code: "SL", name: "Slider", share: 0.3, mph: 86.1 },
      { code: "CH", name: "Changeup", share: 0.17, mph: 87.0 },
      { code: "CS", name: "Slow Curve", share: 0.01, mph: 74.0 },
    ],
  ),
  2: describePitcher(
    2,
    "Jeffrey Springs",
    "L",
    { era: "4.02", k9: 7.7, bb9: 2.9, speed: 90.8 },
    {
      era: { rank: 90, of: 141 },
      k9: { rank: 80, of: 141 },
      bb9: { rank: 60, of: 141 },
      speed: { rank: 130, of: 141 },
    },
    [
      { code: "FF", name: "Four-seam FB", share: 0.4, mph: 90.8 },
      { code: "CH", name: "Changeup", share: 0.35, mph: 79.5 },
    ],
  ),
};

/**
 * @param {import("@playwright/test").Page} page
 * @param {Record<number, object>} [pitchers]
 */
async function openMatchup(page, pitchers = PITCHERS) {
  await openApp(page, { snapshots: { 2026: buildSnapshotWithStarters() }, pitchers });
  await page.getByRole("tab", { name: "Games" }).click();
  await page.getByRole("button", { name: "Pitching matchup: Blubaugh vs Springs" }).click();
  return page.getByRole("dialog");
}

test("tapping a game with its starters named opens their matchup, and Done closes it", async ({
  page,
}) => {
  const sheet = await openMatchup(page);
  await expect(sheet.getByRole("heading", { level: 2 })).toHaveText("Blubaugh vs Springs");
  await expect(sheet.locator(".pitcher-name")).toHaveText(["AJ Blubaugh", "Jeffrey Springs"]);
  await expect(sheet.locator(".pitcher-bio")).toHaveText(["Righty•27", "Lefty•27"]);
  await expect(sheet.locator(".scout-read").first()).toHaveText(
    "Throws harder than most starters and strikes out more hitters than all but seven. " +
      "His 3.66 ERA ranks 50th of 141.",
  );
  await expect(sheet.locator(".recent-starts").first()).toContainText(
    "Sep 19vs Mariners5 2/3 IP, 2 R, 6 K",
  );

  await sheet.getByRole("button", { name: "Done" }).click();
  await expect(sheet).toBeHidden();
});

test("each bar is the share of starters he beats, gold for whichever starter ranks higher", async ({
  page,
}) => {
  const sheet = await openMatchup(page);
  const eraRow = sheet.locator(".tape-row").first();
  await expect(eraRow.locator(".tape-value")).toHaveText(["3.66", "4.02"]);
  await expect(sheet.locator(".tape-label")).toHaveText(["ERA", "K/9", "BB/9", "Fastball mph"]);
  await expect(eraRow.locator(".away .tape-bar i")).toHaveClass("lead");
  await expect(eraRow.locator(".home .tape-bar i")).not.toHaveClass("lead");
  await expect(eraRow.locator(".away .tape-bar i")).toHaveAttribute("style", "width: 65%");
  await expect(sheet.locator(".tape-note")).toContainText(
    "Bars are the share of this season's 141 starters, pitchers with 17 or more",
  );
});

test("the pitches run slowest to fastest, leaving out the ones he barely throws", async ({
  page,
}) => {
  const sheet = await openMatchup(page);
  const columns = sheet.locator(".pitch-columns").first();
  await expect(columns.locator(".pitch-name")).toHaveText(["Slider", "Changeup", "Four-seam"]);
  await expect(columns.locator(".pitch-share")).toHaveText(["30%", "17%", "52%"]);
});

test("a starter the Worker can't describe says so, and the other still shows", async ({ page }) => {
  const sheet = await openMatchup(page, { 1: PITCHERS[1] });
  await expect(sheet.locator(".scout-read")).toHaveCount(1);
  await expect(sheet.locator(".scout-note")).toHaveText(
    "Couldn't load his numbers. Close and try again in a minute.",
  );
});

test("a game without its starters named has no matchup to open", async ({ page }) => {
  await openApp(page, { snapshots: { 2026: buildSnapshotWithStarters() } });
  await page.getByRole("tab", { name: "Games" }).click();
  await expect(page.locator("#games-today .game-open")).toHaveCount(1);
});
