import { test, expect, openApp, buildSnapshotWithStarters, swipeSheetDown } from "./harness.mjs";
import { holdRequests } from "../../../../tests/browser/hold-requests.mjs";
import { recordSheetMotions } from "../../../../tests/browser/sheet-motions.mjs";
import { recordSheetResizes } from "../../../../tests/browser/sheet-resizes.mjs";
import { listOffScaleText } from "../../../../tests/browser/type-scale.mjs";

// What the Worker answers for Astros at Athletics' starters, Blubaugh and Springs.
const describePitcher = (id, [firstName, lastName], hand, line, ranks, pitches) => ({
  id,
  firstName,
  lastName,
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
    ["AJ", "Blubaugh"],
    "R",
    { starts: 28, era: "3.66", k9: 9.1, bb9: 3.4, speed: 95.4 },
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
    ["Jeffrey", "Springs"],
    "L",
    { starts: 24, era: "4.02", k9: 7.7, bb9: 2.9, speed: 90.8 },
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

const BLUBAUGH_VS_SPRINGS = "Pitching matchup: Blubaugh vs Springs";

/**
 * @param {import("@playwright/test").Page} page
 * @param {Record<number, object>} [pitchers]
 * @param {object} [snapshot]
 */
async function showGames(page, pitchers = PITCHERS, snapshot = buildSnapshotWithStarters()) {
  await openApp(page, { snapshots: { 2026: snapshot }, pitchers });
  await page.getByRole("tab", { name: "Games" }).click();
}

/**
 * @param {import("@playwright/test").Page} page
 * @param {Record<number, object>} [pitchers]
 * @param {object} [snapshot]
 */
async function openMatchup(page, pitchers = PITCHERS, snapshot = buildSnapshotWithStarters()) {
  await showGames(page, pitchers, snapshot);
  await page.getByRole("button", { name: BLUBAUGH_VS_SPRINGS }).click();
  return page.getByRole("dialog");
}

/** @param {import("@playwright/test").Page} page */
const holdPitchers = (page) => holdRequests(page, (url) => url.pathname === "/pitcher");

/** @param {import("@playwright/test").Page} page */
function countPitcherReads(page) {
  const reads = { count: 0 };
  page.on("request", (request) => {
    if (new URL(request.url()).pathname === "/pitcher") reads.count += 1;
  });
  return reads;
}

test("tapping a game with its starters named opens their matchup, and Done closes it", async ({
  page,
}) => {
  const sheet = await openMatchup(page);
  await expect(sheet.getByRole("heading", { level: 2 })).toHaveText("Blubaugh vs Springs");
  await expect(sheet.locator(".pitcher-first")).toHaveText(["AJ", "Jeffrey"]);
  await expect(sheet.locator(".pitcher-last")).toHaveText(["Blubaugh", "Springs"]);
  await expect(sheet.locator(".pitcher-bio .arm")).toHaveText(["R", "L"]);
  await expect(sheet.locator(".pitcher-bio .arm").first()).toHaveAttribute(
    "title",
    "Throws right-handed",
  );
  await expect(sheet.locator(".pitcher-bio")).toHaveText(["RAge 27", "LAge 27"]);
  await expect(sheet.locator(".scout h3 span")).toHaveText(["What he throws", "What he throws"]);
  await expect(sheet.locator(".recent-starts").first()).toContainText(
    "Sep 19vs Mariners5 2/3 IP, 2 R, 6 K",
  );

  await sheet.getByRole("button", { name: "Done" }).click();
  await expect(sheet).toBeHidden();
});

test("on a phone, the matchup rises as a sheet that a swipe down closes", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const sheet = await openMatchup(page);
  await expect(sheet.locator(".pitch-mix")).toHaveCount(2);
  await page.waitForFunction(() => document.getAnimations().length === 0);
  const done = sheet.getByRole("button", { name: "Done" });
  expect((await done.boundingBox()).width).toBeLessThanOrEqual(1);
  expect(Math.round((await sheet.boundingBox()).x)).toBe(0);

  await swipeSheetDown(page, {
    target: "#matchupDialog .sheet-top",
    distance: 200,
    steps: 10,
    stepMs: 30,
  });
  await expect(sheet).toBeHidden();
});

test("on a phone, Done and a tap outside slide the matchup down as its backdrop fades out", async ({
  page,
}) => {
  const readMotions = await recordSheetMotions(page);
  await page.setViewportSize({ width: 390, height: 844 });
  const closings = {
    Done: () => page.locator("#matchupDoneBtn").dispatchEvent("click"),
    "a tap outside": () => page.mouse.click(195, 20),
  };
  await showGames(page);
  for (const [way, close] of Object.entries(closings)) {
    await page.getByRole("button", { name: BLUBAUGH_VS_SPRINGS }).click();
    const sheet = page.getByRole("dialog");
    await page.waitForFunction(() => document.getAnimations().length === 0);
    await readMotions();

    await close();
    await expect(sheet, way).toBeHidden();
    expect(await readMotions(), way).toEqual([
      { id: "matchupDialog", part: "sheet", to: { transform: "translateY(100%)" } },
      { id: "matchupDialog", part: "::backdrop", to: { opacity: 0 } },
    ]);
  }
});

test("on a phone, the matchup rises only when the viewer allows motion", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  const sheet = await openMatchup(page);
  await expect(sheet).toHaveCSS("animation-name", "none");

  await sheet.press("Escape");
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.getByRole("button", { name: BLUBAUGH_VS_SPRINGS }).click();
  await expect(sheet).toHaveCSS("animation-name", "sheet-rise");
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
  const pitches = sheet.locator(".pitch-mix").first();
  await expect(pitches.locator(".pitch-name")).toHaveText(["Slider", "Changeup", "Four-seam"]);
  await expect(pitches.locator(".pitch-share")).toHaveText(["30%", "17%", "52%"]);
});

test("a starter the Worker can't describe says so, and the other still shows", async ({ page }) => {
  const sheet = await openMatchup(page, { 1: PITCHERS[1] });
  await expect(sheet.locator(".pitch-mix")).toHaveCount(1);
  await expect(sheet.locator(".scout-note")).toHaveText(
    "Couldn't load his numbers. Close and try again in a minute.",
  );
});

test("a game under way or on a later day without its starters named has no matchup to open", async ({
  page,
}) => {
  await openApp(page, { snapshots: { 2026: buildSnapshotWithStarters() } });
  await page.getByRole("tab", { name: "Games" }).click();
  await expect(page.locator("#games-today .game-row.live .game-open")).toHaveCount(0);
  await expect(page.locator("#games-today .game-row.final .game-open")).toHaveCount(0);
  await expect(page.locator("#games-next .game-open")).toHaveCount(0);
  await expect(page.locator("#games-next .starter.pending")).toHaveCount(0);
});

test("on a desktop, a game that opens lights up under the pointer, and one that doesn't stays as it is", async ({
  page,
}) => {
  await openApp(page, { snapshots: { 2026: buildSnapshotWithStarters() } });
  await page.getByRole("tab", { name: "Games" }).click();
  const readBackground = (row) =>
    row.evaluate((element) => getComputedStyle(element).backgroundColor);
  const opens = page.locator("#games-today .game-row:has(.game-open)").first();
  const stays = page.locator("#games-today .game-row.final").first();
  const resting = await readBackground(opens);

  await opens.hover();
  await expect.poll(() => readBackground(opens)).not.toBe(resting);
  await stays.hover();
  await expect.poll(() => readBackground(opens)).toBe(resting);
  expect(await readBackground(stays)).toBe(resting);
});

// What the Worker answers for the last starters of the Angels, who play at Seattle tonight.
const ANGELS_ROTATION = {
  club: "LAA",
  date: "2026-09-24",
  starters: [
    {
      id: 11,
      name: "Kochanowicz",
      hand: "R",
      start: { date: "2026-09-23", ip: "6.1", pitches: 98 },
      rest: 0,
    },
    {
      id: 12,
      name: "Soriano",
      hand: "R",
      start: { date: "2026-09-19", ip: "5.0", pitches: 101 },
      rest: 4,
    },
  ],
};

async function openStillTbd(page, rotations) {
  await openApp(page, { rotations });
  await page.getByRole("tab", { name: "Games" }).click();
  const row = page.locator("#games-today .game-row").filter({ hasText: "Angels" });
  await expect(row.locator(".starter.pending")).toHaveText(["Still TBD", "Still TBD"]);
  await row.getByRole("button", { name: "Pitching matchup: TBD vs TBD" }).click();
  return page.getByRole("dialog");
}

test("a game later today without a starter says Still TBD, and opens to who started lately and how rested each is", async ({
  page,
}) => {
  const sheet = await openStillTbd(page, { LAA: ANGELS_ROTATION });
  await expect(sheet.locator(".pitcher-last")).toHaveText(["Still TBD", "Still TBD"]);
  const angels = sheet.locator(".scout").first();
  await expect(angels.locator("h3")).toHaveText("AngelsWho's rested");
  await expect(angels.locator(".scout-note")).toHaveText(
    "No starter named yet. Each recent starter's last start, and the rest he'd have on Sep 24.",
  );
  const starters = angels.locator(".rotation li");
  await expect(starters.first()).toHaveText(
    /Kochanowicz\s*R\s*6 1\/3 IP, 98 pitches\s*0 days' rest/,
  );
  await expect(starters.nth(1)).toHaveText(/Soriano\s*R\s*5 IP, 101 pitches\s*4 days' rest/);
  await expect(starters.nth(1)).toHaveClass("rested");
  await expect(starters.first()).not.toHaveClass("rested");
  await expect(sheet.locator(".scout").nth(1).locator(".scout-note")).toHaveText(
    "Couldn't load who started lately. Close and try again in a minute.",
  );
});

test("a club with no starts to go by says so", async ({ page }) => {
  const sheet = await openStillTbd(page, {
    LAA: { ...ANGELS_ROTATION, starters: [] },
  });
  await expect(sheet.locator(".scout").first().locator(".scout-note")).toHaveText(
    "No starts in the last two weeks to go by",
  );
  await expect(sheet.locator(".scout").first().locator(".rotation")).toHaveCount(0);
});

test("a starter with too few starts to rank has his numbers, and a line saying why he has no bars", async ({
  page,
}) => {
  const sheet = await openMatchup(page, { ...PITCHERS, 2: { ...PITCHERS[2], ranks: null } });
  await expect(sheet.locator(".tape-row").first().locator(".tape-value")).toHaveText([
    "3.66",
    "4.02",
  ]);
  await expect(sheet.locator(".home .tape-bar")).toHaveCount(0);
  await expect(sheet.locator(".tape-bar i.lead")).toHaveCount(0);
  await expect(sheet.locator(".tape-note")).toHaveText([
    "Bars are the share of this season's 141 starters, pitchers with 17 or more starts, he beats",
    "Springs's 24 starts are too few to rank him among this season's starters",
  ]);
});

test("with neither starter ranked, the sheet says why and drops the note about bars", async ({
  page,
}) => {
  const unranked = (pitcher, starts) => ({
    ...pitcher,
    ranks: null,
    line: { ...pitcher.line, starts },
  });
  const sheet = await openMatchup(page, {
    1: unranked(PITCHERS[1], 1),
    2: unranked(PITCHERS[2], 8),
  });
  await expect(sheet.locator(".tape-note")).toHaveText([
    "Blubaugh's 1 start is too few to rank him among this season's starters",
    "Springs's 8 starts are too few to rank him among this season's starters",
  ]);
});

test("a start in the game under way says Now instead of its date", async ({ page }) => {
  const snapshot = buildSnapshotWithStarters();
  const game = snapshot.slate.today.games.find((candidate) => candidate.away === "HOU");
  Object.assign(game, { state: "live", score: [1, 0], inning: 3, half: "top", outs: 1 });
  const tonight = {
    date: snapshot.slate.today.date,
    opp: "ATH",
    home: false,
    ip: "2.0",
    runs: 0,
    k: 3,
  };
  const blubaugh = { ...PITCHERS[1], starts: [tonight, ...PITCHERS[1].starts] };
  const sheet = await openMatchup(page, { ...PITCHERS, 1: blubaugh }, snapshot);
  const starts = sheet.locator(".recent-starts").first().locator("li");
  await expect(starts.first()).toHaveText("Now@ Athletics2 IP, 0 R, 3 K");
  await expect(starts.nth(1)).toHaveText("Sep 19vs Mariners5 2/3 IP, 2 R, 6 K");
});

test("while the starters' numbers load, the matchup holds their shape, then fills it in", async ({
  page,
}) => {
  await showGames(page);
  const release = await holdPitchers(page);
  await page.getByRole("button", { name: BLUBAUGH_VS_SPRINGS }).click();
  const sheet = page.getByRole("dialog");
  const body = sheet.locator("#matchupBody");

  await expect(body).toHaveAttribute("aria-busy", "true");
  await expect(sheet.locator(".pitcher-last")).toHaveText(["Blubaugh", "Springs"]);
  await expect(sheet.locator(".pitcher-first .placeholder")).toHaveCount(2);
  await expect(sheet.locator(".tape-label")).toHaveText(["ERA", "K/9", "BB/9", "Fastball mph"]);
  await expect(sheet.locator(".scout h3 span")).toHaveText(["What he throws", "What he throws"]);
  await expect(sheet.locator(".pitch-mix")).toHaveCount(2);
  await expect(sheet.locator(".recent-starts li")).toHaveCount(6);

  release();
  await expect(sheet.locator(".pitcher-first")).toHaveText(["AJ", "Jeffrey"]);
  await expect(sheet.locator(".placeholder")).toHaveCount(0);
  await expect(body).toHaveAttribute("aria-busy", "false");
});

test("while a club's last starters load, its side holds a list's shape, then fills it in", async ({
  page,
}) => {
  await openApp(page, { rotations: { LAA: ANGELS_ROTATION } });
  await page.getByRole("tab", { name: "Games" }).click();
  const release = await holdRequests(page, (url) => url.pathname === "/rotation");
  const row = page.locator("#games-today .game-row").filter({ hasText: "Angels" });
  await row.getByRole("button", { name: "Pitching matchup: TBD vs TBD" }).click();
  const angels = page.getByRole("dialog").locator(".scout").first();

  await expect(angels.locator("h3")).toHaveText("AngelsWho's rested");
  await expect(angels.locator(".rotation li")).toHaveCount(5);
  await expect(angels.locator(".placeholder").first()).toBeVisible();

  release();
  await expect(angels.locator(".rotation li")).toHaveCount(2);
  await expect(angels.locator(".placeholder")).toHaveCount(0);
});

test("a finger coming down on a game starts reading its starters' numbers", async ({ page }) => {
  await showGames(page);
  const reads = countPitcherReads(page);
  const button = page.getByRole("button", { name: BLUBAUGH_VS_SPRINGS });

  await button.dispatchEvent("pointerdown");
  await expect.poll(() => reads.count).toBe(2);

  await button.click();
  await expect(page.getByRole("dialog").locator(".pitch-mix")).toHaveCount(2);
  expect(reads.count).toBe(2);
});

test("a matchup whose starters can't load eases from their shape down to the messages", async ({
  page,
}) => {
  const readResizes = await recordSheetResizes(page);
  await showGames(page, {});
  const release = await holdPitchers(page);
  await page.getByRole("button", { name: BLUBAUGH_VS_SPRINGS }).click();
  const sheet = page.getByRole("dialog");
  await expect(sheet.locator(".tape-label")).toHaveCount(4);

  release();
  await expect(sheet.locator(".scout-note")).toHaveCount(2);
  await expect(sheet.locator(".placeholder")).toHaveCount(0);
  const resizes = (await readResizes()).filter((resize) => resize.id === "matchupDialog");
  expect(resizes.length).toBeGreaterThan(0);
  const [from] = resizes[0].heights.map(parseFloat);
  const [, to] = resizes.at(-1).heights.map(parseFloat);
  expect(to).toBeLessThan(from);
});

for (const { screen, viewport } of [
  { screen: "a wide screen", viewport: { width: 1280, height: 900 } },
  { screen: "a phone", viewport: { width: 390, height: 844 } },
]) {
  test.describe(`on ${screen}`, () => {
    test.use({ viewport });

    test("every piece of text in a matchup keeps to the type scale", async ({ page }) => {
      const sheet = await openMatchup(page);
      await expect(sheet.locator(".pitch-rows li")).toHaveCount(5);
      expect(await listOffScaleText(page)).toEqual([]);
    });
  });
}

test("each pitch is a row with its name, a bar for how often he throws it, its share, and its speed", async ({
  page,
}) => {
  const sheet = await openMatchup(page);
  const rows = sheet.locator(".pitch-mix").first().locator(".pitch-rows li");
  await expect(rows.locator(".pitch-name")).toHaveText(["Slider", "Changeup", "Four-seam"]);
  await expect(rows.locator(".pitch-share")).toHaveText(["30%", "17%", "52%"]);
  await expect(rows.locator(".pitch-speed")).toHaveText(["86 mph", "87 mph", "95 mph"]);
  await expect(rows.locator(".pitch-bar i").last()).toHaveAttribute("style", "width: 100%");
});

test("a game's matchup says where to watch it, above its starters, and its row doesn't", async ({
  page,
}) => {
  const snapshot = buildSnapshotWithStarters();
  const game = snapshot.slate.today.games.find((each) => each.starters?.[0]?.id === 1);
  game.networks = ["FOX ONE", "FS1", "Space City Home Network"];
  const sheet = await openMatchup(page, PITCHERS, snapshot);
  const networks = sheet.getByRole("group", { name: "Where to watch" });
  await expect(networks.locator(".network-name")).toHaveText("Space City Home Network");
  await expect(networks.getByRole("img", { name: "FS1" })).toBeVisible();
  await expect(networks.locator('img.for-dark[alt="FOX ONE"]')).toBeVisible();
  await expect(networks.locator('img.for-light[alt="FOX ONE"]')).toBeHidden();
  await expect(page.locator("#gamePager .network-logo")).toHaveCount(0);
  const logo = await networks.getByRole("img", { name: "FS1" }).boundingBox();
  const starters = await sheet.locator(".faceoff").boundingBox();
  expect(logo.y + logo.height).toBeLessThan(starters.y);
});

test("a game with nowhere to watch it listed has no line for it in its matchup", async ({
  page,
}) => {
  const sheet = await openMatchup(page);
  await expect(sheet.locator(".pitcher-last")).toHaveText(["Blubaugh", "Springs"]);
  await expect(sheet.locator(".networks")).toHaveCount(0);
});
