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
  await expect(sheet.getByRole("heading", { level: 2 })).toHaveText("Pitching matchup");
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

test("the sheet's title names it in capitals, at one size on a desktop and a phone", async ({
  page,
}) => {
  const sheet = await openMatchup(page);
  const title = sheet.getByRole("heading", { level: 2 });
  await expect(title).toHaveCSS("text-transform", "uppercase");
  await expect(title).toHaveCSS("font-weight", "400");
  await expect(title).toHaveCSS("font-size", "16px");
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(title).toHaveCSS("font-size", "16px");
});

test("on a desktop, the title centers over the sheet, with Done at its right edge, and 18px sides as on a phone", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  const sheet = await openMatchup(page);
  await expect(sheet.locator(".pitch-mix")).toHaveCount(2);
  const { titleCenter, sheetCenter, doneRight, sheetRight } = await sheet.evaluate((dialog) => {
    const box = dialog.getBoundingClientRect();
    const title = dialog.querySelector(".sheet-title").getBoundingClientRect();
    const done = dialog.querySelector(".sheet-done").getBoundingClientRect();
    return {
      titleCenter: title.left + title.width / 2,
      sheetCenter: box.left + box.width / 2,
      doneRight: done.right,
      sheetRight: box.right,
    };
  });
  expect(titleCenter).toBeCloseTo(sheetCenter, 0);
  expect(sheetRight - doneRight).toBeCloseTo(11, 0);
  const sides = await sheet.evaluate((dialog) => {
    const box = dialog.getBoundingClientRect();
    const faceoff = dialog.querySelector(".faceoff").getBoundingClientRect();
    return [faceoff.left - box.left, box.right - faceoff.right];
  });
  expect(sides.map(Math.round)).toEqual([19, 19]);
});

test("the sheet's title scrolls away with the rest, and the sheet never scrolls past its ends", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 500 });
  const sheet = await openMatchup(page);
  await expect(sheet.locator(".pitch-mix")).toHaveCount(2);
  await expect(sheet).toHaveCSS("overscroll-behavior-y", "none");

  await sheet.evaluate((dialog) => {
    dialog.scrollTop = 200;
  });
  await expect(sheet.locator(".sheet-top")).not.toBeInViewport();
});

test("the sheet's parts and lists leave room between their rows", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  const sheet = await openMatchup(page);
  const blubaugh = sheet.locator(".scout").first();
  await expect(blubaugh.locator(".pitch-name")).toHaveCount(3);
  const readGaps = (list) =>
    list.evaluateAll((items) =>
      items.slice(1).map((item, index) => {
        const above = items[index].getBoundingClientRect();
        return Math.round(item.getBoundingClientRect().top - above.bottom);
      }),
    );
  expect(await readGaps(blubaugh.locator(".pitch-name"))).toEqual([10, 10]);
  expect(await readGaps(blubaugh.locator(".recent-starts li"))).toEqual([8]);
  const rowsToLastStarts = await blubaugh.evaluate((scout) => {
    const rows = scout.querySelector(".pitch-rows").getBoundingClientRect();
    return scout.querySelector("h4").getBoundingClientRect().top - rows.bottom;
  });
  expect(Math.round(rowsToLastStarts)).toBe(20);
  const tapeToScout = await sheet.locator(".matchup-body").evaluate((body) => {
    const tape = body.querySelector(".tape").getBoundingClientRect();
    return body.querySelector(".scout").getBoundingClientRect().top - tape.bottom;
  });
  expect(Math.round(tapeToScout)).toBe(22);
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

test("the pitch rows run fastest to slowest, leaving out the ones he barely throws", async ({
  page,
}) => {
  const sheet = await openMatchup(page);
  const pitches = sheet.locator(".pitch-mix").first();
  await expect(pitches.locator(".pitch-name")).toHaveText([
    "Four-seam fastball",
    "Changeup",
    "Slider",
  ]);
  await expect(pitches.locator(".pitch-share")).toHaveText(["52%", "17%", "30%"]);
});

test("a starter the Worker can't describe says so, and the other still shows", async ({ page }) => {
  const sheet = await openMatchup(page, { 1: PITCHERS[1] });
  await expect(sheet.locator(".pitch-mix")).toHaveCount(1);
  await expect(sheet.locator(".scout-note")).toHaveText(
    "Couldn't load his numbers. Close and try again in a minute.",
  );
});

test("every game opens, whether or not its starters are named", async ({ page }) => {
  await openApp(page, { snapshots: { 2026: buildSnapshotWithStarters() } });
  await page.getByRole("tab", { name: "Games" }).click();
  for (const list of ["#games-previous", "#games-today", "#games-next"]) {
    const rows = page.locator(`${list} .game-row`);
    await expect(rows.locator(".game-open")).toHaveCount(await rows.count());
  }
  await expect(page.locator("#games-next .starter.pending")).toHaveCount(0);
});

test("a game on a later day without its starters says to check back for them, under its clubs", async ({
  page,
}) => {
  const reads = countPitcherReads(page);
  await showGames(page);
  await page.locator("#games-next .game-open").first().click();
  const sheet = page.getByRole("dialog");
  await expect(sheet.getByRole("heading", { level: 2 })).toHaveText("Pitching matchup");
  await expect(sheet.locator(".pitcher-last")).toHaveText(["Still TBD", "Still TBD"]);
  await expect(sheet.locator(".pitcher-id .club")).toHaveCount(2);
  await expect(sheet.locator(".check-back")).toHaveText("Check back for pitchers");
  await expect(sheet.locator(".tape, .scout")).toHaveCount(0);
  expect(reads.count).toBe(0);
});

test("a finished game without its starters has nothing to check back for", async ({ page }) => {
  await showGames(page);
  await page.locator("#games-today .game-row.final .game-open").first().click();
  const sheet = page.getByRole("dialog");
  await expect(sheet.getByRole("heading", { level: 2 })).toHaveText("Pitching matchup");
  await expect(sheet.locator(".pitcher-id .club")).toHaveCount(2);
  await expect(sheet.locator(".check-back")).toHaveCount(0);
});

test("a game with its starters named has nothing to check back for", async ({ page }) => {
  const sheet = await openMatchup(page);
  await expect(sheet.locator(".pitch-mix")).toHaveCount(2);
  await expect(sheet.locator(".check-back")).toHaveCount(0);
});

test("on a desktop, a game lights up under the pointer, past the row's sides, and goes back after", async ({
  page,
}) => {
  await openApp(page, { snapshots: { 2026: buildSnapshotWithStarters() } });
  await page.getByRole("tab", { name: "Games" }).click();
  const readHighlight = (row) =>
    row.evaluate((element) => {
      const { backgroundColor, boxShadow } = getComputedStyle(element);
      return { backgroundColor, boxShadow };
    });
  const [first, second] = [0, 1].map((index) => page.locator("#games-today .game-row").nth(index));
  const resting = await readHighlight(first);

  // The highlight's color fills the row and both 12px reaches beyond its sides.
  const isReachingPast = async () => {
    const { backgroundColor, boxShadow } = await readHighlight(first);
    const reach = `${backgroundColor} -12px 0px 0px 0px, ${backgroundColor} 12px 0px 0px 0px`;
    return backgroundColor !== resting.backgroundColor && boxShadow === reach;
  };

  await first.hover();
  await expect.poll(isReachingPast).toBe(true);
  await second.hover();
  await expect.poll(() => readHighlight(first)).toEqual(resting);
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
  const rotationGap = await angels.locator(".rotation").evaluate((list) => {
    const [above, below] = [...list.children].map((item) => item.getBoundingClientRect());
    return below.top - above.bottom;
  });
  expect(Math.round(rotationGap)).toBe(5);
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

test("each pitch is a row with its dot, name, share, and speed", async ({ page }) => {
  const sheet = await openMatchup(page);
  const rows = sheet.locator(".pitch-mix").first().locator(".pitch-rows li");
  await expect(rows.locator(".pitch-key")).toHaveCount(3);
  await expect(rows.locator(".pitch-name")).toHaveText([
    "Four-seam fastball",
    "Changeup",
    "Slider",
  ]);
  await expect(rows.locator(".pitch-share")).toHaveText(["52%", "17%", "30%"]);
  await expect(rows.locator(".pitch-speed")).toHaveText(["95 mph", "87 mph", "86 mph"]);
});

/** @param {import("@playwright/test").Locator} chart */
function measurePitchMix(chart) {
  return chart.evaluate((element) => {
    const readNumber = (selector, attribute) =>
      Number(element.querySelector(selector).getAttribute(attribute));
    const lineBox = element.querySelector(".speed-line").getBoundingClientRect();
    const [, , viewWidth] = element.querySelector(".speed-line").getAttribute("viewBox").split(" ");
    const scale = lineBox.width / Number(viewWidth);
    const usage = element.querySelector(".pitch-usage").getBoundingClientRect();
    return {
      lineStart: lineBox.left + readNumber(".speed-axis", "x1") * scale,
      lineEnd: lineBox.left + readNumber(".speed-axis", "x2") * scale,
      usageStart: usage.left,
      usageEnd: usage.right,
      lineDot:
        (2 * readNumber(".pitch-dot", "r") - readNumber(".pitch-dot", "stroke-width")) * scale,
      rowDots: [...element.querySelectorAll(".pitch-key")].map((key) => {
        const box = key.getBoundingClientRect();
        return { width: box.width, height: box.height };
      }),
      slices: [...element.querySelectorAll(".pitch-usage i")].map(
        (slice) => slice.getBoundingClientRect().width,
      ),
    };
  });
}

test("the bar over the line ends where the line does, split by how often he throws each", async ({
  page,
}) => {
  const sheet = await openMatchup(page);
  const chart = sheet.locator(".pitch-mix").first();
  await expect(chart.locator(".pitch-usage i")).toHaveCount(3);
  const { lineStart, lineEnd, usageStart, usageEnd, slices } = await measurePitchMix(chart);
  expect(usageStart).toBeCloseTo(lineStart, 0);
  expect(usageEnd).toBeCloseTo(lineEnd, 0);
  const [slider, changeup, fourSeam] = slices;
  expect(fourSeam / slider).toBeCloseTo(0.52 / 0.3, 1);
  expect(changeup / slider).toBeCloseTo(0.17 / 0.3, 1);
});

for (const viewport of [
  { width: 1280, height: 720 },
  { width: 320, height: 640 },
]) {
  test(`at ${viewport.width}px wide, the speed labels stay 13px, each number on its speed, over the pitches`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    await page.emulateMedia({ reducedMotion: "reduce" });
    const sheet = await openMatchup(page);
    const chart = sheet.locator(".pitch-mix").first();
    const labels = chart.locator(".speed-label");
    await expect(labels).toHaveText(["70 mph", "80", "90", "100"]);
    await expect(labels.first()).toHaveCSS("font-size", "13px");
    const { lineStart, lineEnd } = await measurePitchMix(chart);
    const readCenters = () =>
      labels.evaluateAll((elements) =>
        elements.map((element) => {
          const box = element.getBoundingClientRect();
          return box.left + box.width / 2;
        }),
      );
    const centers = await readCenters();
    expect(centers[0]).toBeCloseTo(lineStart, 0);
    expect(centers.at(-1)).toBeCloseTo(lineEnd, 0);
    const labelsToRows = await chart.evaluate((element) => {
      const scale = element.querySelector(".speed-labels").getBoundingClientRect();
      return element.querySelector(".pitch-rows").getBoundingClientRect().top - scale.bottom;
    });
    expect(Math.round(labelsToRows)).toBe(12);
  });
}

for (const { screen, viewport, smallest } of [
  { screen: "a phone", viewport: { width: 390, height: 844 }, smallest: false },
  { screen: "the narrowest phone", viewport: { width: 320, height: 640 }, smallest: true },
]) {
  test.describe(`on ${screen}`, () => {
    test.use({ viewport });

    test("each row's dot is the speed line's dot, and never under 10px", async ({ page }) => {
      const sheet = await openMatchup(page);
      const chart = sheet.locator(".pitch-mix").first();
      await expect(chart.locator(".pitch-key")).toHaveCount(3);
      const { lineDot, rowDots } = await measurePitchMix(chart);
      const expected = Math.max(10, lineDot);
      expect(lineDot < 10).toBe(smallest);
      for (const { width, height } of rowDots) {
        expect(width).toBeCloseTo(expected, 1);
        expect(height).toBeCloseTo(expected, 1);
      }
    });
  });
}
