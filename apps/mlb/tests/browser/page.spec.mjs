import {
  test,
  expect,
  openApp,
  openSettings,
  buildFixtureSnapshot,
  buildSnapshotWithStarters,
  chooseSeason,
  EVENING_FIXTURE,
} from "./harness.mjs";
import { createReading } from "../../page/js/readings.js";
import { listAnimations } from "../../../../tests/browser/animations.mjs";
import { listOffScaleText } from "../../../../tests/browser/type-scale.mjs";
import { listTapFlashes, listTouchHoverRules } from "../../../../tests/browser/tap-states.mjs";

const PLAYOFF_FIELD_2026 = [
  "Rays",
  "Guardians",
  "Rangers",
  "Yankees",
  "Red Sox",
  "White Sox",
  "Brewers",
  "Dodgers",
  "Braves",
  "Padres",
  "Cubs",
  "Phillies",
];

test("the page's font comes from its own server, in every weight from one file", async ({
  page,
}) => {
  const fontRequests = [];
  page.on("request", (request) => {
    if (request.resourceType() === "font") fontRequests.push(new URL(request.url()).pathname);
  });
  await openApp(page);

  const loadedWeights = await page.evaluate(async () => {
    await document.fonts.ready;
    return [...document.fonts]
      .filter(
        (font) => font.family.replaceAll('"', "") === "Chivo Mono" && font.status === "loaded",
      )
      .map((font) => font.weight);
  });
  expect(loadedWeights).toContain("100 900");
  expect(fontRequests).toEqual(["/fonts/chivo-mono-latin.woff2"]);
});

test("the Games tab lists today's games and every game on each club's previous and next date", async ({
  page,
}) => {
  // The lists, not the scrolling between them, are what this test reads.
  await page.emulateMedia({ reducedMotion: "reduce" });
  await openApp(page);
  await page.getByRole("tab", { name: "Games" }).click();
  const shownGames = page.locator(".pager-page:not([inert])");
  await expect(shownGames).toHaveId("games-today");
  await expect(shownGames.locator(".game-row")).toHaveCount(12);
  await expect(shownGames.locator(".game-row.live").first()).toContainText("Top 9th");

  await page.getByRole("tab", { name: "Previous" }).click();
  await expect(shownGames).toHaveId("games-previous");
  await expect(shownGames.locator(".game-row")).toHaveCount(16);

  await page.getByRole("tab", { name: "Previous" }).press("End");
  await expect(page.getByRole("tab", { name: "Next" })).toBeFocused();
  await expect(page.getByRole("tab", { name: "Next" })).toHaveAttribute("aria-selected", "true");
  await expect(shownGames).toHaveId("games-next");
  await expect(shownGames.locator(".game-row")).toHaveCount(17);
});

test("a game under way shows its outs as two lights beside the inning", async ({ page }) => {
  await openApp(page);
  await page.getByRole("tab", { name: "Games" }).click();
  const liveStatuses = page.locator("#games-today .game-row.live .game-status");

  await expect(liveStatuses.first()).toHaveText("Top 9th");
  await expect(liveStatuses.first().getByRole("img", { name: "1 out" })).toBeVisible();
  await expect(liveStatuses.nth(1).getByRole("img", { name: "2 outs" })).toBeVisible();
  await expect(liveStatuses.nth(2).getByRole("img", { name: "0 outs" })).toBeVisible();
  await expect(liveStatuses.nth(2).locator(".out-light.on")).toHaveCount(0);
  await expect(liveStatuses.nth(1).locator(".out-light.on")).toHaveCount(2);
});

const readPagesPosition = (page) =>
  page
    .locator("#games-pages")
    .evaluate((pages) => Math.round((pages.scrollLeft / pages.clientWidth) * 100) / 100);

async function readThumbOffset(page, tabName) {
  const thumb = await page.locator(".pager-thumb").boundingBox();
  const tab = await page.getByRole("tab", { name: tabName }).boundingBox();
  return Math.abs(thumb.x + thumb.width / 2 - (tab.x + tab.width / 2));
}

test("on a phone, swiping the games sideways moves between the lists and slides the tab thumb", async ({
  page,
}) => {
  await page.setViewportSize(PHONE);
  await openApp(page);
  await page.getByRole("tab", { name: "Games" }).click();
  await expect.poll(() => readPagesPosition(page)).toBe(1);

  await page
    .locator("#games-pages")
    .evaluate((pages) => (pages.scrollLeft = pages.clientWidth / 4));
  await expect.poll(() => readPagesPosition(page)).toBe(0);
  await expect(page.getByRole("tab", { name: "Previous" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(page.locator("#games-previous")).not.toHaveAttribute("inert");
  await expect(page.locator("#games-today")).toHaveAttribute("inert");
  await expect.poll(() => readThumbOffset(page, "Previous")).toBeLessThan(1);

  await page.getByRole("tab", { name: "Next" }).click();
  await expect.poll(() => readPagesPosition(page)).toBe(2);
  await expect(page.getByRole("tab", { name: "Next" })).toHaveAttribute("aria-selected", "true");
  await expect.poll(() => readThumbOffset(page, "Next")).toBeLessThan(1);
});

test("the Games lists are as tall as the shown one when it runs past the screen", async ({
  page,
}) => {
  await page.setViewportSize(PHONE);
  await openApp(page);
  await page.getByRole("tab", { name: "Games" }).click();
  const pages = page.locator("#games-pages");
  const readHeight = async (locator) => (await locator.boundingBox()).height;

  await page.getByRole("tab", { name: "Previous" }).click();
  await expect
    .poll(() => readHeight(pages))
    .toBe(await readHeight(page.locator("#games-previous")));
  await page.getByRole("tab", { name: "Today" }).click();
  await expect.poll(() => readHeight(pages)).toBe(await readHeight(page.locator("#games-today")));
});

const openShortToday = async (page) => {
  const snapshot = buildFixtureSnapshot(EVENING_FIXTURE);
  snapshot.slate.today = { ...snapshot.slate.today, games: snapshot.slate.today.games.slice(0, 2) };
  await openApp(page, { snapshots: { [EVENING_FIXTURE.season]: snapshot } });
  await page.getByRole("tab", { name: "Games" }).click();
};

const readListsTop = (page) =>
  page.evaluate(() => {
    const bar = document.getElementById("games-bar");
    return document.getElementById("games-pages").getBoundingClientRect().top - bar.offsetHeight;
  });

test("on a phone, the space below a short list of games swipes too, and scrolls only as far as the pill", async ({
  page,
}) => {
  await page.setViewportSize(PHONE);
  await openShortToday(page);
  await expect(page.locator("#games-today .game-row")).toHaveCount(2);

  const lastRow = await page.locator("#games-today .game-row").last().boundingBox();
  const isSwipedBelowGames = await page.evaluate(
    (y) => Boolean(document.elementFromPoint(195, y)?.closest("#games-pages")),
    lastRow.y + lastRow.height + 200,
  );
  expect(isSwipedBelowGames).toBe(true);

  await page.evaluate(() => scrollTo({ top: document.body.scrollHeight, behavior: "instant" }));
  expect(Math.abs(await readListsTop(page))).toBeLessThanOrEqual(1);
});

test("on a phone, the Games pill stays at the top while the games scroll under it", async ({
  page,
}) => {
  await page.setViewportSize(PHONE);
  await openApp(page);
  await page.getByRole("tab", { name: "Games" }).click();
  const pill = page.getByRole("tablist", { name: "Games" });
  const pillTop = (await pill.boundingBox()).y;
  expect(pillTop).toBeGreaterThan(100);

  await page.evaluate(() => scrollTo({ top: 600, behavior: "instant" }));

  await expect.poll(async () => (await pill.boundingBox()).y).toBe(10);
  await expect(page.locator("#games-bar")).toHaveClass(/stuck/);
  const coveringPillCenter = await page.evaluate(() => {
    const box = document.querySelector(".pager-tabs").getBoundingClientRect();
    return document
      .elementFromPoint(box.x + box.width / 2, box.y + box.height / 2)
      ?.closest(".pager-tabs");
  });
  expect(coveringPillCenter).not.toBeNull();
});

test("on a phone, a list swiped in from far down another starts just under the pill, and stays put", async ({
  page,
}) => {
  await page.setViewportSize(PHONE);
  await openApp(page);
  await page.getByRole("tab", { name: "Games" }).click();
  await page.getByRole("tab", { name: "Previous" }).click();
  await expect(page.locator("#games-previous")).not.toHaveAttribute("inert");
  await page.evaluate(() => scrollTo({ top: 700, behavior: "instant" }));
  const readFirstDateY = async () =>
    (await page.locator("#games-today .game-day").first().boundingBox()).y;
  const pillBottom = await page.evaluate(
    () => document.getElementById("games-bar").getBoundingClientRect().bottom,
  );

  await expect.poll(readFirstDateY).toBeCloseTo(pillBottom, 0);
  await page
    .locator("#games-pages")
    .evaluate((pages) => (pages.scrollLeft = pages.clientWidth * 0.5));
  expect(await readFirstDateY()).toBeCloseTo(pillBottom, 0);
  await page.locator("#games-pages").evaluate((pages) => (pages.scrollLeft = pages.clientWidth));

  await expect(page.locator("#games-today")).not.toHaveAttribute("inert");
  expect(await readFirstDateY()).toBeCloseTo(pillBottom, 0);
  expect(Math.abs(await readListsTop(page))).toBeLessThanOrEqual(1);
  await expect(page.locator("#games-today")).toHaveCSS("transform", "none");
});

test("on a phone, a swipe that comes to rest between two lists goes on to the nearer once let go", async ({
  page,
}) => {
  await page.setViewportSize(PHONE);
  await openApp(page);
  await page.getByRole("tab", { name: "Games" }).click();
  await expect.poll(() => readPagesPosition(page)).toBe(1);
  const pages = page.locator("#games-pages");
  await pages.evaluate((element) => (element.style.scrollSnapType = "none"));

  await pages.dispatchEvent("touchstart", {
    touches: [{ identifier: 0, clientX: 195, clientY: 400 }],
  });
  await pages.evaluate(
    (element) =>
      new Promise((resolve) => {
        element.addEventListener("scroll", resolve, { once: true });
        element.scrollLeft = element.clientWidth * 0.3;
      }),
  );
  await page.clock.runFor(400);
  expect(await readPagesPosition(page)).toBe(0.3);
  await expect(page.locator("#games-today")).not.toHaveAttribute("inert");

  await pages.evaluate((element) => {
    const elsewhere = new Touch({ identifier: 1, target: document.body });
    element.dispatchEvent(new TouchEvent("touchend", { touches: [elsewhere], bubbles: true }));
  });
  await expect.poll(() => readPagesPosition(page)).toBe(0);
  await expect(page.getByRole("tab", { name: "Previous" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(page.locator("#games-today")).toHaveAttribute("inert");

  await pages.evaluate((element) => (element.scrollLeft = element.clientWidth * 0.96));
  await expect.poll(() => readPagesPosition(page)).toBe(1);
  await expect(page.getByRole("tab", { name: "Today" })).toHaveAttribute("aria-selected", "true");
});

test("a tapped Games tab keeps its list while the lists are still on their way", async ({
  page,
}) => {
  await page.setViewportSize(PHONE);
  await openApp(page);
  await page.getByRole("tab", { name: "Games" }).click();
  await expect.poll(() => readPagesPosition(page)).toBe(1);

  const pages = page.locator("#games-pages");
  await pages.evaluate((element) => (element.scrollTo = () => {}));
  await page.getByRole("tab", { name: "Previous" }).click();
  await pages.dispatchEvent("scroll");
  await page.clock.runFor(400);

  await expect(page.getByRole("tab", { name: "Previous" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(page.locator("#games-today")).not.toHaveAttribute("inert");
});

/** @param {import("@playwright/test").Page} page @param {boolean} hidden */
const setHidden = (page, hidden) =>
  page.evaluate((isHidden) => {
    Object.defineProperty(document, "hidden", { configurable: true, get: () => isHidden });
    document.dispatchEvent(new Event("visibilitychange"));
  }, hidden);

/** @param {import("@playwright/test").Page} page @param {number} minutes */
async function comeBackAfter(page, minutes) {
  await setHidden(page, true);
  const now = await page.evaluate(() => Date.now());
  await page.clock.setSystemTime(now + minutes * 60 * 1000);
  await setHidden(page, false);
}

/** @param {import("@playwright/test").Page} page @param {string} name @param {number} position */
async function expectGameList(page, name, position) {
  await expect.poll(() => readPagesPosition(page)).toBe(position);
  await expect(page.getByRole("tab", { name })).toHaveAttribute("aria-selected", "true");
  await expect(page.locator(`#games-${name.toLowerCase()}`)).not.toHaveAttribute("inert");
}

test("the Games tab keeps its list after another tab was shown", async ({ page }) => {
  await page.setViewportSize(PHONE);
  await openApp(page);
  await page.getByRole("tab", { name: "Games" }).click();
  await page.getByRole("tab", { name: "Next" }).click();
  await expectGameList(page, "Next", 2);

  await page.getByRole("tab", { name: "Bracket" }).click();
  await page.getByRole("tab", { name: "Games" }).click();

  await expectGameList(page, "Next", 2);
});

for (const list of ["Previous", "Next"]) {
  test(`on a phone, tapping the Games tab while it shows ${list} goes back to today's list`, async ({
    page,
  }) => {
    await page.setViewportSize(PHONE);
    await openApp(page);
    await page.getByRole("tab", { name: "Games" }).click();
    await page.getByRole("tab", { name: list }).click();
    await expectGameList(page, list, list === "Previous" ? 0 : 2);

    await page.getByRole("tab", { name: "Games" }).click();

    await expectGameList(page, "Today", 1);
    await expect(page.locator("#view-games")).toBeVisible();
  });
}

test("on a phone, tapping the Games tab while it shows today's list scrolls back to the top", async ({
  page,
}) => {
  await page.setViewportSize(PHONE);
  await openApp(page);
  await page.getByRole("tab", { name: "Games" }).click();
  await expectGameList(page, "Today", 1);
  await page.mouse.wheel(0, 800);
  await expect.poll(() => page.evaluate(() => scrollY)).toBeGreaterThan(0);

  await page.getByRole("tab", { name: "Games" }).click();

  await expect.poll(() => page.evaluate(() => scrollY)).toBe(0);
  await expectGameList(page, "Today", 1);
});

test("the Games tab keeps its list when the page comes back within the hour", async ({ page }) => {
  await page.setViewportSize(PHONE);
  await openApp(page);
  await page.getByRole("tab", { name: "Games" }).click();
  await page.getByRole("tab", { name: "Previous" }).click();
  await expectGameList(page, "Previous", 0);

  await comeBackAfter(page, 59);

  await expectGameList(page, "Previous", 0);
});

test("the Games tab goes back to today's list when the page comes back after an hour away", async ({
  page,
}) => {
  await page.setViewportSize(PHONE);
  await openApp(page);
  await page.getByRole("tab", { name: "Games" }).click();
  await page.getByRole("tab", { name: "Previous" }).click();
  await expectGameList(page, "Previous", 0);

  await comeBackAfter(page, 60);

  await expectGameList(page, "Today", 1);
});

test("the Games tab opens on today's list after an hour away spent on another tab", async ({
  page,
}) => {
  await page.setViewportSize(PHONE);
  await openApp(page);
  await page.getByRole("tab", { name: "Games" }).click();
  await page.getByRole("tab", { name: "Next" }).click();
  await expectGameList(page, "Next", 2);
  await page.getByRole("tab", { name: "Bracket" }).click();

  await comeBackAfter(page, 60);
  await page.getByRole("tab", { name: "Games" }).click();

  await expectGameList(page, "Today", 1);
});

test("the page reopens on the Games list it was last on", async ({ page }) => {
  await page.setViewportSize(PHONE);
  await openApp(page);
  await page.getByRole("tab", { name: "Games" }).click();
  await page.getByRole("tab", { name: "Next" }).click();
  await expectGameList(page, "Next", 2);

  await page.reload();

  await expectGameList(page, "Next", 2);
});

test("a doubleheader shows as two games on its date, with no game number", async ({ page }) => {
  await openApp(page);
  await page.getByRole("tab", { name: "Games" }).click();
  await page.getByRole("tab", { name: "Previous" }).click();
  const doubleheader = page
    .locator("#games-previous .game-row")
    .filter({ hasText: "Blue Jays" })
    .filter({ hasText: "Orioles" });

  await expect(doubleheader).toHaveCount(2);
  await expect(doubleheader.locator(".game-status")).toHaveText(["Final", "Final"]);
});

test("each day of games is closed by lines, with its date in open space above it", async ({
  page,
}) => {
  const snapshot = buildFixtureSnapshot(EVENING_FIXTURE);
  const later = snapshot.slate.next.slice(8).map((game) => ({ ...game, date: "2026-09-26" }));
  snapshot.slate.next = [...snapshot.slate.next.slice(0, 8), ...later];
  await openApp(page, { snapshots: { [EVENING_FIXTURE.season]: snapshot } });
  await page.getByRole("tab", { name: "Games" }).click();
  await page.getByRole("tab", { name: "Next" }).click();
  const shownGames = page.locator("#games-next");
  const days = shownGames.locator(".game-list");
  const dates = shownGames.locator(".game-day");
  await expect(days).toHaveCount(2);

  await expect(dates.first()).toHaveCSS("font-size", "13px");
  await expect(days.first()).toHaveCSS("border-top-width", "1px");
  await expect(days.first().locator(".game-row").last()).toHaveCSS("border-bottom-width", "1px");
  const firstDay = await days.first().boundingBox();
  const secondDate = await dates.nth(1).boundingBox();
  const secondDay = await days.nth(1).boundingBox();
  expect(secondDate.y - (firstDay.y + firstDay.height)).toBe(30);
  expect(secondDay.y - (secondDate.y + secondDate.height)).toBe(8);
});

test("a game still to come shows its start time centered in its row, under the Today tab", async ({
  page,
}) => {
  await page.setViewportSize(PHONE);
  await openApp(page);
  await page.getByRole("tab", { name: "Games" }).click();
  const row = page.locator("#games-today .game-row.pre").first();
  const rowBox = await row.boundingBox();
  const timeBox = await row.locator(".game-time").boundingBox();
  const todayBox = await page.getByRole("tab", { name: "Today" }).boundingBox();
  const findCenterX = (box) => box.x + box.width / 2;

  expect(Math.abs(timeBox.y + timeBox.height / 2 - (rowBox.y + rowBox.height / 2))).toBeLessThan(1);
  expect(Math.abs(findCenterX(timeBox) - findCenterX(rowBox))).toBeLessThan(1);
  expect(Math.abs(findCenterX(timeBox) - findCenterX(todayBox))).toBeLessThan(1);
});

// A series' teamA is its higher seed or its first feeder's winner, not the game's away club.
const openPostseasonDay = async (page, series, games) => {
  const snapshot = buildFixtureSnapshot(EVENING_FIXTURE);
  const start = "2026-09-24T18:08:00Z";
  Object.assign(snapshot.series, series);
  snapshot.slate.today.games = games.map((game) => ({
    state: "pre",
    start,
    postseason: true,
    ...game,
  }));
  await openApp(page, { snapshots: { [EVENING_FIXTURE.season]: snapshot } });
  await page.getByRole("tab", { name: "Games" }).click();
};

const openWildCardDay = (page) =>
  openPostseasonDay(
    page,
    {
      NL_WC1: { winsA: 1, winsB: 0 },
      AL_WC1: { winsA: 0, winsB: 1 },
      AL_WC2: { winsA: 1, winsB: 1 },
      NL_WC2: { winsA: 0, winsB: 2 },
    },
    [
      { away: "PHI", home: "ATL" },
      { away: "CWS", home: "TEX", state: "live", score: [3, 1], inning: 5, half: "top" },
      { away: "BOS", home: "NYY", state: "final", score: [4, 6] },
      { away: "CHC", home: "SD", state: "final", score: [5, 2] },
    ],
  );

test("a postseason game today names its round and the series, away wins first, over its time or score", async ({
  page,
}) => {
  await page.setViewportSize(PHONE);
  await openWildCardDay(page);
  const labels = page.locator("#games-today .series-label");

  await expect(labels).toHaveText(["NL WC 0-1", "AL WC 1-0", "AL WC 1-1", "NL WC 2-0"]);
  await expect(labels.first()).toHaveCSS("text-transform", "uppercase");
  await expect(labels.first()).toHaveCSS("color", await readColor(page, "--ink-dim"));
  await expect(labels.last()).toHaveCSS("color", await readColor(page, "--gold"));
  await expect(labels.last().locator(".series-count")).toHaveCSS(
    "color",
    await readColor(page, "--gold"),
  );

  const row = await page.locator("#games-today .game-row").first().boundingBox();
  const time = await page.locator("#games-today .game-time").boundingBox();
  expect(Math.abs(time.x + time.width / 2 - (row.x + row.width / 2))).toBeLessThan(1);
});

test("with starters named, each sits under its club with his arm, clear of the row's edges", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await openApp(page, { snapshots: { 2026: buildSnapshotWithStarters() } });
  await page.getByRole("tab", { name: "Games" }).click();
  const row = page.locator("#games-today .game-row:has(.starter:not(.pending))");
  const box = await row.boundingBox();
  const clubs = await row.locator(".game-side.away").boundingBox();
  const time = await row.locator(".game-time").boundingBox();
  const facts = await row.locator(".game-side.away .game-facts").boundingBox();
  const starter = await row.locator(".starter.away").boundingBox();

  const home = await row.locator(".game-side.home").boundingBox();

  await expect(row.locator(".starter")).toHaveText(["BlubaughR", "SpringsL"]);
  expect(clubs.x).toBeLessThan(time.x);
  expect(time.x + time.width).toBeLessThan(home.x);
  expect(starter.y - (facts.y + facts.height)).toBeCloseTo(4, 1);
  expect(clubs.y - box.y).toBeGreaterThan(8);
  expect(box.y + box.height - (starter.y + starter.height)).toBeGreaterThan(8);
});

test("on the narrowest phone, a club's race letter stays on its record's line, clear of the score", async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 640 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await openApp(page);
  await page.getByRole("tab", { name: "Games" }).click();
  const row = page.locator("#games-today .game-row:has(.game-side.home .race)").first();
  const facts = row.locator(".game-side.home .game-facts");
  await facts.locator(".tabular").evaluate((record) => (record.textContent = "103-59"));
  const tops = await facts.evaluate((element) =>
    [...element.children].map((child) => Math.round(child.getBoundingClientRect().top)),
  );
  expect(new Set(tops).size).toBe(1);
  const middle = await row.locator(".game-headline").boundingBox();
  expect((await facts.boundingBox()).x).toBeGreaterThan(middle.x + middle.width);
});

test("a clinched club's race letter is gold at the facts' own weight", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await openApp(page);
  await page.getByRole("tab", { name: "Games" }).click();
  const race = page.locator("#games-today .race.clinched").first();
  await expect(race).toHaveCSS("color", await readColor(page, "--gold"));
  await expect(race).toHaveCSS("font-weight", "400");
});

test("on a phone, a long starter's name keeps his arm on its line", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openApp(page, { snapshots: { 2026: buildSnapshotWithStarters() } });
  await page.getByRole("tab", { name: "Games" }).click();
  const starter = page.locator("#games-today .starter.home:not(.pending)");
  const readHeight = async () => (await starter.boundingBox()).height;
  const oneLine = await readHeight();
  await starter.locator(".starter-name").evaluate((name) => (name.textContent = "Misiorowski"));
  expect(await readHeight()).toBe(oneLine);
});

test("a game still to come is as tall as a finished one", async ({ page }) => {
  await openApp(page);
  await page.getByRole("tab", { name: "Games" }).click();
  const readRowHeight = async (state) =>
    (await page.locator(`#games-today .game-row.${state}`).first().boundingBox()).height;

  expect(await readRowHeight("pre")).toBe(await readRowHeight("final"));
});

const readToken = (page, token) =>
  page.evaluate(
    (name) => parseFloat(getComputedStyle(document.documentElement).getPropertyValue(name)),
    token,
  );

// How far each piece's middle sits below its row's, measured on the row's middle column.
const measureOffsets = (row, selectors) =>
  row.evaluate((element, pieces) => {
    const middle = element.querySelector(".game-middle").getBoundingClientRect();
    const findCenter = (box) => box.top + box.height / 2;
    return pieces.map(
      (piece) =>
        findCenter(element.querySelector(piece).getBoundingClientRect()) - findCenter(middle),
    );
  }, selectors);

// Measured on the text itself, which is what has to sit where the offsets say.
test("every game is one height, with each piece at its own offset from the row's middle", async ({
  page,
}) => {
  await page.setViewportSize(PHONE);
  await openWildCardDay(page);
  const [height, side, label, headline, status] = await Promise.all(
    ["height", "side", "label", "headline", "status"].map((piece) =>
      readToken(page, piece === "height" ? "--game-row-height" : `--game-${piece}-offset`),
    ),
  );
  const rows = page.locator("#games-today .game-row");
  for (const row of await rows.all()) expect((await row.boundingBox()).height).toBe(height);

  const live = rows.filter({ has: page.locator(".game-status") }).first();
  const offsets = await measureOffsets(live, [
    ".game-side.away",
    ".series-label",
    ".game-score",
    ".game-status",
  ]);
  for (const [index, expected] of [side, label, headline, status].entries())
    expect(offsets[index]).toBeCloseTo(expected, 1);
  const upcoming = rows.filter({ has: page.locator(".game-time") }).first();
  expect((await measureOffsets(upcoming, [".game-time"]))[0]).toBeCloseTo(headline, 1);
});

test("without a series line, a time centers in its row, and a score and its status center as a pair", async ({
  page,
}) => {
  await page.setViewportSize(PHONE);
  await openApp(page);
  await page.getByRole("tab", { name: "Games" }).click();
  const headline = await readToken(page, "--game-headline-offset");
  const status = await readToken(page, "--game-status-offset");
  const rows = page.locator("#games-today .game-row");
  const [timeOffset] = await measureOffsets(
    rows.filter({ has: page.locator(".game-time") }).first(),
    [".game-time"],
  );
  expect(timeOffset).toBeCloseTo(0, 1);
  const [scoreOffset, statusOffset] = await measureOffsets(
    rows.filter({ has: page.locator(".game-score") }).first(),
    [".game-score", ".game-status"],
  );
  expect(scoreOffset).toBeCloseTo((headline - status) / 2, 1);
  expect(statusOffset - scoreOffset).toBeCloseTo(status - headline, 1);
});

const PHONE = { width: 390, height: 844 };
const WIDE_SCREEN = { width: 1800, height: 900 };
const LAPTOP = { width: 1280, height: 800 };

const CREAM = "rgb(241, 234, 212)";
const GREEN = "rgb(127, 168, 143)";
const TAUPE = "rgb(138, 122, 106)";
const GOLD = "rgb(244, 193, 92)";

test("the Games tab bolds each winner and dims only the clubs that are out", async ({ page }) => {
  await openApp(page);
  await page.getByRole("tab", { name: "Games" }).click();
  await page.getByRole("tab", { name: "Previous" }).click();
  const findSide = (away, home, side) =>
    page
      .locator("#games-previous .game-row")
      .filter({ hasText: away })
      .filter({ hasText: home })
      .locator(`.game-side.${side}`);

  const winnerStillIn = findSide("Brewers", "Phillies", "away").locator(".team-name");
  const loserStillIn = findSide("Brewers", "Phillies", "home").locator(".team-name");
  const winnerOut = findSide("Nationals", "Tigers", "away").locator(".team-name");
  const loserOut = findSide("Nationals", "Tigers", "home");

  await expect(winnerStillIn).toHaveCSS("font-weight", "550");
  await expect(winnerStillIn).toHaveCSS("color", CREAM);
  await expect(loserStillIn).toHaveCSS("font-weight", "400");
  await expect(loserStillIn).toHaveCSS("color", CREAM);
  await expect(winnerOut).toHaveCSS("font-weight", "550");
  await expect(winnerOut).toHaveCSS("color", GREEN);
  await expect(loserOut.locator(".team-name")).toHaveCSS("color", GREEN);
  await expect(loserOut.locator(".dot")).toHaveCSS("opacity", "0.55");
});

test("the bracket shows an eliminated club in taupe, without a line through its name", async ({
  page,
}) => {
  await openApp(page, {
    store: { "seasons/2025": { year: 2025, teams: {}, series: {}, ranking: [], log: [] } },
  });
  await chooseSeason(page, "2025");

  const eliminated = page
    .locator(".matchup-row.eliminated .team-name")
    .filter({ hasText: "Mariners" })
    .first();
  await expect(eliminated).toHaveCSS("color", TAUPE);
  await expect(eliminated).toHaveCSS("text-decoration-line", "none");
});

test("a club's seed is labeled beside its card only where it enters the bracket: its Wild Card slot or its bye's Division Series slot", async ({
  page,
}) => {
  await openApp(page, {
    store: { "seasons/2025": { year: 2025, teams: {}, series: {}, ranking: [], log: [] } },
  });
  await chooseSeason(page, "2025");
  const bracket = page.locator("#bracketWrap");
  const readLabels = (round, club) =>
    bracket.locator(`.box[data-round="${round}"]`).filter({ hasText: club }).locator(".seed-label");

  await expect(readLabels("WC", "Yankees")).toHaveText(["5 seed", "4 seed"]);
  await expect(readLabels("DS", "Blue Jays")).toHaveText(["1 seed"]);
  await expect(readLabels("CS", "Blue Jays")).toHaveCount(0);
  await expect(readLabels("WS", "Dodgers")).toHaveCount(0);
  await expect(bracket.locator(".seed-label")).toHaveCount(12);
  await expect(bracket.locator(".matchup-row .seed-label")).toHaveCount(0);

  const division = bracket.locator('.box[data-round="DS"]').filter({ hasText: "Blue Jays" });
  const byeRow = await division
    .locator(".matchup-row")
    .filter({ hasText: "Blue Jays" })
    .boundingBox();
  const label = await division.locator(".seed-label").boundingBox();
  const card = await division.locator(".series").boundingBox();
  expect(label.x + label.width).toBeLessThanOrEqual(card.x);
  expect(Math.abs(label.y + label.height / 2 - (byeRow.y + byeRow.height / 2))).toBeLessThan(1);
});

test("the bracket leaves a score empty until its series' first game starts, and gives each TBD row one too", async ({
  page,
}) => {
  await openApp(page);
  const bracket = page.locator("#bracketWrap");

  await expect(bracket.locator(".matchup-row")).toHaveCount(22);
  await expect(bracket.locator(".matchup-row:has(.tbd) .nscore")).toHaveCount(10);
  await expect(bracket.locator(".nscore")).toHaveText(Array(22).fill(""));
});

test("once a series' first game starts, both clubs' scores show 0, at the height of an empty score", async ({
  page,
}) => {
  const snapshot = buildFixtureSnapshot(EVENING_FIXTURE);
  snapshot.series.AL_WC1.started = true;
  await openApp(page, { snapshots: { [EVENING_FIXTURE.season]: snapshot } });
  const scores = page.locator("#bracketWrap .nscore");
  const started = page
    .locator("#bracketWrap .series")
    .filter({ has: page.locator(".nscore", { hasText: "0" }) });

  await expect(started.locator(".nscore")).toHaveText(["0", "0"]);
  await expect(scores.filter({ hasText: "0" })).toHaveCount(2);
  const filled = await scores.filter({ hasText: "0" }).first().boundingBox();
  const empty = await scores.filter({ hasText: /^$/ }).first().boundingBox();
  expect(empty.height).toBe(filled.height);
});

test("a club's score shows its wins, and a swept club's shows 0", async ({ page }) => {
  await openApp(page, {
    store: { "seasons/2025": { year: 2025, teams: {}, series: {}, ranking: [], log: [] } },
  });
  await chooseSeason(page, "2025");
  const wildCard = page.locator("#bracketWrap .series").filter({ hasText: "Reds" });
  const readScore = (club) =>
    wildCard.locator(".matchup-row").filter({ hasText: club }).locator(".nscore");

  await expect(readScore("Dodgers")).toHaveText("2");
  await expect(readScore("Reds")).toHaveText("0");
});

test("a series winner's digit sits higher in its gold box than a dark box's, in a box of the same height", async ({
  page,
}) => {
  await openApp(page, {
    store: { "seasons/2025": { year: 2025, teams: {}, series: {}, ranking: [], log: [] } },
  });
  await chooseSeason(page, "2025");
  const wildCard = page.locator("#bracketWrap .series").filter({ hasText: "Reds" });
  const readScore = (club) =>
    wildCard.locator(".matchup-row").filter({ hasText: club }).locator(".nscore");

  await expect(readScore("Dodgers")).toHaveCSS("padding-top", "2.75px");
  await expect(readScore("Reds")).toHaveCSS("padding-top", "3.5px");
  const gold = await readScore("Dodgers").boundingBox();
  const dark = await readScore("Reds").boundingBox();
  expect(gold.height).toBe(dark.height);
});

test("a series saved without being marked started still shows 0 beside a club's wins", async ({
  page,
}) => {
  const snapshot = buildFixtureSnapshot(EVENING_FIXTURE);
  snapshot.series.AL_WC1 = { winsA: 1, winsB: 0 };
  await openApp(page, { snapshots: { [EVENING_FIXTURE.season]: snapshot } });
  const started = page
    .locator("#bracketWrap .series")
    .filter({ has: page.locator(".nscore", { hasText: "1" }) });

  await expect(started.locator(".nscore")).toHaveText(["0", "1"]);
});

test("on a phone, the bracket's round dots sit just above the tab bar and follow its scroll", async ({
  page,
}) => {
  await page.setViewportSize(PHONE);
  await openApp(page);
  const dots = page.locator("#bracketWrap .round-dots");
  await expect(dots.locator("[data-round]")).toHaveCount(4);
  await expect(dots.locator(".on")).toHaveCount(1);
  const dotsBox = await dots.boundingBox();
  const bar = await page.locator("#tabBar").boundingBox();
  expect(bar.y - (dotsBox.y + dotsBox.height)).toBeGreaterThan(0);
  expect(bar.y - (dotsBox.y + dotsBox.height)).toBeLessThanOrEqual(8);

  const scroller = page.locator("#bracketWrap .tree-scroll");
  await scroller.evaluate((tree) => tree.scrollTo({ left: 0, behavior: "instant" }));
  await expect(dots.locator('[data-round="WC"]')).toHaveClass("on");
  await scroller.evaluate((tree) => tree.scrollTo({ left: tree.scrollWidth, behavior: "instant" }));
  await expect(dots.locator('[data-round="WS"]')).toHaveClass("on");
});

test("on a wide screen, the whole bracket shows without round dots", async ({ page }) => {
  await page.setViewportSize(WIDE_SCREEN);
  await openApp(page);
  await expect(page.locator("#bracketWrap .tree-scroll")).not.toHaveClass(/stacked/);
  await expect(page.locator("#bracketWrap .round-dots")).toHaveCount(0);
});

test("a stacked bracket that fits the screen's width has no round dots and nothing to scroll", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1400, height: 900 });
  await openApp(page);
  const scroller = page.locator("#bracketWrap .tree-scroll");
  const dots = page.locator("#bracketWrap .round-dots");
  const canScroll = () => scroller.evaluate((tree) => tree.scrollWidth > tree.clientWidth);
  await expect(scroller).toHaveClass(/stacked/);
  await expect(dots).toHaveCount(0);
  expect(await canScroll()).toBe(false);

  await page.setViewportSize({ width: 900, height: 900 });
  await expect(dots).toHaveCount(1);
  expect(await canScroll()).toBe(true);

  await page.setViewportSize({ width: 1400, height: 900 });
  await expect(dots).toHaveCount(0);
  expect(await canScroll()).toBe(false);
});

test("on a phone, the bracket stacks the AL above the NL, each running left to right into the World Series", async ({
  page,
}) => {
  await page.setViewportSize(PHONE);
  await openApp(page);
  const bracket = page.locator("#bracketWrap");
  const findCard = (round) => bracket.locator(".box").filter({ hasText: round });
  const readLeft = async (round) => (await findCard(round).first().boundingBox()).x;

  const al = bracket.locator(".league-head.al");
  const nl = bracket.locator(".league-head.nl");
  await expect(al).toHaveText("American League");
  await expect(nl).toHaveText("National League");
  await expect(al).toHaveCSS("text-align", "left");
  const alTop = (await al.boundingBox()).y;
  const nlTop = (await nl.boundingBox()).y;
  expect(alTop).toBeLessThan(nlTop);

  const worldSeries = await bracket
    .locator(".box")
    .filter({ has: page.locator(".world") })
    .boundingBox();
  expect(await readLeft("Wild Card")).toBeLessThan(await readLeft("Division Series"));
  expect(await readLeft("Division Series")).toBeLessThan(await readLeft("Championship Series"));
  expect(await readLeft("Championship Series")).toBeLessThan(worldSeries.x);

  const alcs = await findCard("Championship Series").nth(0).boundingBox();
  const nlcs = await findCard("Championship Series").nth(1).boundingBox();
  expect(alcs.y).toBeGreaterThan(alTop);
  expect(alcs.y).toBeLessThan(nlTop);
  expect(nlcs.y).toBeGreaterThan(nlTop);
  expect(worldSeries.y).toBeGreaterThan(alcs.y);
  expect(worldSeries.y).toBeLessThan(nlcs.y);
});

test("under each card, the next game shows its day, as today or tomorrow when it can, and its start time", async ({
  page,
}) => {
  const snapshot = buildFixtureSnapshot(EVENING_FIXTURE);
  snapshot.series.AL_WC1.next = {
    at: "2026-09-25T01:10:00Z",
    date: "2026-09-24",
    tbd: false,
    game: 1,
  };
  snapshot.series.AL_WC2.next = {
    at: "2026-09-25T23:08:00Z",
    date: "2026-09-25",
    tbd: false,
    game: 1,
  };
  snapshot.series.NL_WC1.next = {
    at: "2026-09-25T07:33:00Z",
    date: "2026-09-25",
    tbd: true,
    game: 1,
  };
  snapshot.series.NL_DS1.next = {
    at: "2026-10-03T20:08:00Z",
    date: "2026-10-03",
    tbd: false,
    game: 1,
  };
  await openApp(page, { snapshots: { [EVENING_FIXTURE.season]: snapshot } });
  const notes = page.locator("#bracketWrap .card-note");

  await expect(notes.filter({ hasText: /^Today\u20229:10\sPM$/ })).toHaveCount(1);
  await expect(notes.filter({ hasText: /^Tomorrow\u20227:08\sPM$/ })).toHaveCount(1);
  await expect(notes.filter({ hasText: /^Tomorrow\u2022time TBD$/ })).toHaveCount(1);
  await expect(notes.filter({ hasText: /^Sat Oct 3\u20224:08\sPM$/ })).toHaveCount(1);
  await expect(notes.filter({ hasText: /^Sat Oct 3\u2022time TBD$/ })).toHaveCount(3);
  await expect(notes.filter({ hasText: /^Tue Sep 29\u2022time TBD$/ })).toHaveCount(1);
});

// The page's clock reads 8:44 PM Eastern, which is already the next morning in London.
test.describe("in Europe/London", () => {
  test.use({ timezoneId: "Europe/London" });

  test("a card's next game reads its day and time by the viewer's own clock", async ({ page }) => {
    const snapshot = buildFixtureSnapshot(EVENING_FIXTURE);
    snapshot.series.AL_WC1.next = {
      at: "2026-09-25T17:10:00Z",
      date: "2026-09-25",
      tbd: false,
      game: 1,
    };
    await openApp(page, { snapshots: { [EVENING_FIXTURE.season]: snapshot } });

    await expect(
      page.locator("#bracketWrap .card-note").filter({ hasText: /^Today\u20226:10\sPM$/ }),
    ).toHaveCount(1);
  });
});

const WILD_CARD_SERIES = ["AL_WC1", "AL_WC2", "NL_WC1", "NL_WC2"];

for (const width of [360, 390]) {
  test.describe(`on a ${width}px phone`, () => {
    test.use({ viewport: { width, height: 844 }, hasTouch: true, isMobile: true });

    test("every card's next game fits on one line under it", async ({ page }) => {
      await openApp(page);
      const notes = page.locator("#bracketWrap .card-note");
      await expect(notes.first()).toBeVisible();
      const lineCounts = await notes.evaluateAll((elements) =>
        elements.map((note) => {
          const range = document.createRange();
          range.selectNodeContents(note);
          return new Set([...range.getClientRects()].map((rect) => Math.round(rect.bottom))).size;
        }),
      );
      expect(lineCounts.length).toBeGreaterThan(0);
      expect(lineCounts.filter((count) => count !== 1)).toEqual([]);
    });
  });
}

test("under a card whose game is under way, the score, inning, and outs show instead of the next game", async ({
  page,
}) => {
  const snapshot = buildFixtureSnapshot(EVENING_FIXTURE);
  const start = "2026-09-24T23:08:00Z";
  for (const seriesId of WILD_CARD_SERIES)
    snapshot.series[seriesId].next = { at: start, date: "2026-09-24", tbd: false, game: 1 };
  snapshot.slate.today.games.push(
    {
      away: "NYY",
      home: "BOS",
      state: "live",
      start,
      score: [2, 3],
      inning: 4,
      half: "top",
      outs: 1,
    },
    { away: "PHI", home: "ATL", state: "live", start, score: [4, 1], inning: 5, half: "middle" },
    {
      away: "SD",
      home: "CHC",
      state: "live",
      start,
      score: [1, 1],
      inning: 6,
      half: "top",
      outs: 2,
      delay: "Delayed: Rain",
    },
  );
  await openApp(page, { snapshots: { [EVENING_FIXTURE.season]: snapshot } });
  const notes = page.locator("#bracketWrap .card-note");

  const batting = notes.filter({ hasText: /^3-2 Top 4th$/ });
  await expect(batting).toHaveCount(1);
  await expect(batting).toHaveCSS("color", await readColor(page, "--copper-ink"));
  await expect(batting).toHaveCSS("font-style", "normal");
  await expect(batting.getByRole("img", { name: "1 out" })).toBeVisible();
  await expect(batting.locator(".out-light")).toHaveCount(2);
  await expect(batting.locator(".out-light.on")).toHaveCount(1);
  const [score, inning, lights] = await Promise.all(
    [
      batting.locator(".live-part").nth(0),
      batting.locator(".live-part").nth(1),
      batting.locator(".out-lights"),
    ].map((part) => part.boundingBox()),
  );
  const spaceBeforeInning = inning.x - (score.x + score.width);
  const spaceBeforeLights = lights.x - (inning.x + inning.width);
  expect(spaceBeforeLights).toBeGreaterThan(spaceBeforeInning);
  const betweenHalves = notes.filter({ hasText: /^4-1 Mid 5th$/ });
  await expect(betweenHalves).toHaveCount(1);
  await expect(betweenHalves.locator(".out-light")).toHaveCount(0);
  const delayed = notes.filter({ hasText: /^1-1 Delayed: Rain$/ });
  await expect(delayed).toHaveCount(1);
  await expect(delayed).toHaveCSS("color", await readColor(page, "--gold"));
  await expect(delayed.locator(".out-light")).toHaveCount(0);
  await expect(notes.filter({ hasText: /^Today\u20227:08\sPM$/ })).toHaveCount(1);
});

test("under a card whose series already counts the game, the next game shows even while the slate reads it as under way", async ({
  page,
}) => {
  const snapshot = buildFixtureSnapshot(EVENING_FIXTURE);
  for (const seriesId of WILD_CARD_SERIES)
    snapshot.series[seriesId].next = {
      at: "2026-09-25T23:08:00Z",
      date: "2026-09-25",
      tbd: false,
      game: 2,
    };
  snapshot.slate.today.games.push({
    away: "PHI",
    home: "ATL",
    state: "live",
    start: "2026-09-24T23:08:00Z",
    score: [3, 5],
    inning: 9,
    half: "middle",
  });
  await openApp(page, { snapshots: { [EVENING_FIXTURE.season]: snapshot } });
  const notes = page.locator("#bracketWrap .card-note");

  await expect(notes.filter({ hasText: /^Tomorrow\u20227:08\sPM$/ })).toHaveCount(4);
  await expect(page.locator("#bracketWrap .card-note.live")).toHaveCount(0);
});

// The page's clock reads 8:44:43 PM Eastern.
const buildFirstPitchSnapshot = (start, slateGame = {}) => {
  const snapshot = buildFixtureSnapshot(EVENING_FIXTURE);
  for (const seriesId of WILD_CARD_SERIES)
    snapshot.series[seriesId].next = { at: start, date: "2026-09-24", tbd: false, game: 1 };
  snapshot.slate.today.games.push({ away: "NYY", home: "BOS", state: "pre", start, ...slateGame });
  return snapshot;
};

test("in the half hour before first pitch, a card counts down the minutes on the viewer's clock", async ({
  page,
}) => {
  const snapshot = buildFirstPitchSnapshot("2026-09-25T01:02:00Z");
  await openApp(page, { snapshots: { [EVENING_FIXTURE.season]: snapshot } });
  const notes = page.locator("#bracketWrap .card-note");

  const countdown = notes.filter({ hasText: /^First pitch in 18 min$/ });
  await expect(countdown).toHaveCount(1);
  await expect(countdown).toHaveCSS("color", await readColor(page, "--copper-ink"));
  await expect(notes.filter({ hasText: /^Today\u20229:02\sPM$/ })).toHaveCount(3);

  await page.clock.runFor(60 * 1000);
  await expect(notes.filter({ hasText: /^First pitch in 17 min$/ })).toHaveCount(1);
});

test("more than a half hour before first pitch, a card shows its next game", async ({ page }) => {
  const snapshot = buildFirstPitchSnapshot("2026-09-25T01:20:00Z");
  await openApp(page, { snapshots: { [EVENING_FIXTURE.season]: snapshot } });

  await expect(
    page.locator("#bracketWrap .card-note").filter({ hasText: /^Today\u20229:20\sPM$/ }),
  ).toHaveCount(4);
});

test("past its start, a game still before its first pitch reads as warmup", async ({ page }) => {
  const snapshot = buildFirstPitchSnapshot("2026-09-25T00:40:00Z");
  await openApp(page, { snapshots: { [EVENING_FIXTURE.season]: snapshot } });

  const note = page.locator("#bracketWrap .card-note").filter({ hasText: /^Warmup$/ });
  await expect(note).toHaveCount(1);
  await expect(note).toHaveCSS("color", await readColor(page, "--copper-ink"));
});

test("a delayed start shows its delay instead of a countdown", async ({ page }) => {
  const snapshot = buildFirstPitchSnapshot("2026-09-25T01:02:00Z", { delay: "Delayed: Rain" });
  await openApp(page, { snapshots: { [EVENING_FIXTURE.season]: snapshot } });

  const note = page.locator("#bracketWrap .card-note").filter({ hasText: /^Delayed: Rain$/ });
  await expect(note).toHaveCount(1);
  await expect(note).toHaveCSS("color", await readColor(page, "--gold"));
});

test("redrawing the bracket each minute keeps keyboard focus on it", async ({ page }) => {
  await openApp(page);
  const bracket = page.getByRole("region", { name: "Bracket" });
  await bracket.focus();

  await page.clock.runFor(60 * 1000);
  await expect(bracket).toBeFocused();
});

const readColor = (page, token) =>
  page.evaluate((name) => {
    const probe = document.createElement("span");
    probe.style.color = `var(${name})`;
    document.body.append(probe);
    const color = getComputedStyle(probe).color;
    probe.remove();
    return color;
  }, token);

test("on a phone, the World Series card scrolls all the way to the middle of the screen", async ({
  page,
}) => {
  await page.setViewportSize(PHONE);
  await openApp(page);
  const scroller = page.locator(".tree-scroll");
  await expect(scroller).toBeVisible();
  await scroller.evaluate(
    (element) =>
      new Promise((resolve) => {
        element.addEventListener("scrollend", resolve, { once: true });
        element.scrollLeft = element.scrollWidth;
      }),
  );

  const worldSeries = await page
    .locator("#bracketWrap .box")
    .filter({ has: page.locator(".world") })
    .boundingBox();
  expect(Math.abs(worldSeries.x + worldSeries.width / 2 - PHONE.width / 2)).toBeLessThan(2);
  expect((await readBracketFit(page)).pageOverflow).toBe(0);
});

test("on a phone, the bracket opens on the earliest round still playing, and swipes either way", async ({
  page,
}) => {
  await page.setViewportSize(PHONE);
  await openApp(page, {
    store: { "seasons/2025": { year: 2025, teams: {}, series: {}, ranking: [], log: [] } },
  });
  const scroller = page.locator(".tree-scroll");
  await expect(page.locator('.box[data-round="WC"]').first()).toBeInViewport();
  expect(await scroller.evaluate((element) => element.scrollLeft)).toBe(0);

  await chooseSeason(page, "2025");
  const worldSeries = page.locator('.box[data-round="WS"]');
  await expect(worldSeries).toBeInViewport({ ratio: 1 });
  await expect(page.locator('.box[data-round="WC"]').first()).not.toBeInViewport();

  await scroller.evaluate((element) => (element.scrollLeft = 0));
  await expect(page.locator('.box[data-round="WC"]').first()).toBeInViewport();
  await expect(worldSeries).not.toBeInViewport();

  await page.getByRole("tab", { name: "Games" }).click();
  await page.getByRole("tab", { name: "Bracket" }).click();
  await expect(worldSeries).toBeInViewport({ ratio: 1 });
});

test("on a phone, a bracket opening on the Division Series keeps its byes' seed labels in view", async ({
  page,
}) => {
  await page.setViewportSize(PHONE);
  const snapshot = buildFixtureSnapshot(EVENING_FIXTURE);
  for (const id of ["AL_WC1", "AL_WC2", "NL_WC1", "NL_WC2"])
    snapshot.series[id] = { winsA: 2, winsB: 0, started: true };
  await openApp(page, { snapshots: { [EVENING_FIXTURE.season]: snapshot } });

  const division = page.locator('.box[data-round="DS"]').first();
  await expect(division.locator(".series")).toBeInViewport({ ratio: 1 });
  await expect(division.locator(".seed-label")).toBeInViewport({ ratio: 1 });
  await expect(page.locator('.box[data-round="WC"] .series').first()).not.toBeInViewport({
    ratio: 1,
  });
});

test("on a small tablet, which the app treats as a phone, the bracket opens on the round still playing", async ({
  page,
}) => {
  await page.setViewportSize({ width: 760, height: 900 });
  await openApp(page, {
    store: { "seasons/2025": { year: 2025, teams: {}, series: {}, ranking: [], log: [] } },
  });
  await chooseSeason(page, "2025");

  await expect(page.locator('.box[data-round="WS"]')).toBeInViewport({ ratio: 1 });
  expect(
    await page.locator(".tree-scroll").evaluate((scroller) => scroller.scrollLeft),
  ).toBeGreaterThan(0);
});

test("wider than a phone, the stacked bracket starts at the Wild Card with every seed in view, whatever round is still playing", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1000, height: 900 });
  await openApp(page, {
    store: { "seasons/2025": { year: 2025, teams: {}, series: {}, ranking: [], log: [] } },
  });
  const scroller = page.locator(".tree-scroll");
  const readScroll = () => scroller.evaluate((element) => element.scrollLeft);
  const expectSeedsInView = async () => {
    await expect(page.locator(".seed-label")).toHaveCount(12);
    for (const label of await page.locator(".seed-label").all())
      await expect(label).toBeInViewport();
  };
  await expectSeedsInView();
  expect(await readScroll()).toBe(0);

  await chooseSeason(page, "2025");
  await expect(page.locator('.box[data-round="WS"]').filter({ hasText: "Dodgers" })).toHaveCount(1);
  await expectSeedsInView();
  expect(await readScroll()).toBe(0);
});

const readStackedSpaces = (page) =>
  page.evaluate(() => {
    const readBox = (element) => element.getBoundingClientRect();
    const banner = readBox(document.getElementById("banner"));
    const line = readBox(document.querySelector("#bracketWrap .league-head.al"));
    const [upperCard, lowerCard] = [...document.querySelectorAll("#bracketWrap .box")].map(readBox);
    return {
      aboveLeague: line.top - banner.bottom,
      belowLine: upperCard.top - line.bottom,
      betweenRows: lowerCard.top - upperCard.bottom - 22,
    };
  });

test("on a phone too short for the bracket, its spaces are at their tightest", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 600 });
  await openApp(page);
  await expect(page.locator("#bracketWrap .league-head.al")).toBeVisible();

  expect(await readStackedSpaces(page)).toEqual({
    aboveLeague: 18,
    belowLine: 5,
    betweenRows: 6,
  });
});

test("on a taller phone, every space in the bracket grows by the same factor", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 960 });
  await openApp(page);
  await expect(page.locator("#bracketWrap .league-head.al")).toBeVisible();

  const { aboveLeague, belowLine, betweenRows } = await readStackedSpaces(page);
  const growth = betweenRows / 13;
  expect(growth).toBeGreaterThan(1.5);
  expect(belowLine / 11).toBeCloseTo(growth, 0);
  expect(aboveLeague / 18).toBeCloseTo(growth, 0);
});

const readCardTops = (page, round) =>
  page
    .locator("#bracketWrap .box")
    .filter({ hasText: round })
    .evaluateAll((boxes) => boxes.map((box) => box.getBoundingClientRect().top));

test("on a phone, each wild card card sits level with the division card it feeds", async ({
  page,
}) => {
  await page.setViewportSize(PHONE);
  await openApp(page);
  await expect(page.locator("#bracketWrap .bracket-stage")).toBeVisible();

  const wildCardTops = await readCardTops(page, "Wild Card");
  const divisionTops = await readCardTops(page, "Division Series");

  expect(wildCardTops).toHaveLength(4);
  expect(wildCardTops.toSorted()).toEqual(divisionTops.toSorted());
});

test("on a phone, a league's name stays at the left while its line scrolls sideways", async ({
  page,
}) => {
  await page.setViewportSize(PHONE);
  await openApp(page);
  const name = page.locator("#bracketWrap .league-head.al .league-name");
  await expect(name).toBeVisible();
  const restingLeft = (await name.boundingBox()).x;

  await page.locator(".tree-scroll").evaluate((scroller) => (scroller.scrollLeft = 300));

  await expect.poll(async () => (await name.boundingBox()).x).toBe(restingLeft);
});

test("on a wide screen, the Games pill and lists sit in the middle of the page", async ({
  page,
}) => {
  await page.setViewportSize(WIDE_SCREEN);
  await openApp(page);
  await page.getByRole("tab", { name: "Games" }).click();
  const pageMiddle = page.viewportSize().width / 2;
  for (const locator of [
    page.getByRole("tablist", { name: "Games" }),
    page.locator("#games-today .game-row").first(),
  ]) {
    const box = await locator.boundingBox();
    expect(Math.abs(box.x + box.width / 2 - pageMiddle)).toBeLessThanOrEqual(1);
  }
});

test("on a wide screen, the AL and NL face each other across the World Series", async ({
  page,
}) => {
  await page.setViewportSize(WIDE_SCREEN);
  await openApp(page);
  const bracket = page.locator("#bracketWrap");
  const championships = bracket.locator(".box").filter({ hasText: "Championship Series" });
  await expect(championships).toHaveCount(2);

  const alcs = await championships.nth(0).boundingBox();
  const nlcs = await championships.nth(1).boundingBox();
  const worldSeries = await bracket
    .locator(".box")
    .filter({ has: page.locator(".world") })
    .boundingBox();
  expect(alcs.x).toBeLessThan(worldSeries.x);
  expect(worldSeries.x).toBeLessThan(nlcs.x);
  expect(alcs.y).toBe(worldSeries.y);
  await expect(
    bracket.locator(".series.world .bestof span").filter({ hasText: "World Series" }),
  ).toHaveCSS("color", GOLD);

  const divisions = bracket.locator(".box").filter({ hasText: "Division Series" });
  const upperDivision = await divisions.nth(0).boundingBox();
  const lowerDivision = await divisions.nth(1).boundingBox();
  const noteAndGap = lowerDivision.y - (upperDivision.y + upperDivision.height);
  expect(noteAndGap).toBe(80);
});

test("on a wide screen, each league's seed labels sit on its outer side", async ({ page }) => {
  await page.setViewportSize(WIDE_SCREEN);
  await openApp(page);
  const bracket = page.locator("#bracketWrap");
  const findOuterGap = async (index) => {
    const wildCard = bracket.locator('.box[data-round="WC"]').nth(index);
    const card = await wildCard.locator(".series").boundingBox();
    const label = await wildCard.locator(".seed-label").first().boundingBox();
    return { before: card.x - (label.x + label.width), after: label.x - (card.x + card.width) };
  };

  expect((await findOuterGap(0)).before).toBeGreaterThan(0);
  expect((await findOuterGap(2)).after).toBeGreaterThan(0);
  const pageOverflow = await page.evaluate(
    () => document.scrollingElement.scrollWidth - document.scrollingElement.clientWidth,
  );
  expect(pageOverflow).toBe(0);
});

test("on a wide screen, a centered league bar spans each league's three columns and its seeds' labels", async ({
  page,
}) => {
  await page.setViewportSize(WIDE_SCREEN);
  await openApp(page);
  const bracket = page.locator("#bracketWrap");
  const findBox = (round, index) =>
    bracket.locator(".box").filter({ hasText: round }).nth(index).boundingBox();
  const al = bracket.locator(".league-head.al");
  const nl = bracket.locator(".league-head.nl");
  await expect(al).toHaveText("American League");
  await expect(nl).toHaveText("National League");
  await expect(al).toHaveCSS("text-align", "center");
  await expect(nl).toHaveCSS("text-align", "center");

  const alBar = await al.boundingBox();
  const nlBar = await nl.boundingBox();
  const stage = await bracket.locator(".bracket-stage").boundingBox();
  const alWildCard = await findBox("Wild Card", 0);
  const alcs = await findBox("Championship Series", 0);
  const nlcs = await findBox("Championship Series", 1);
  const alLabel = await bracket.locator(".seed-labels.left").first().boundingBox();
  const nlLabel = await bracket.locator(".seed-labels.right").last().boundingBox();
  expect(alBar.y).toBe(nlBar.y);
  expect(alBar.x).toBe(stage.x);
  expect(alBar.x).toBeLessThan(alLabel.x);
  expect(alBar.x + alBar.width).toBe(alcs.x + alcs.width);
  expect(nlBar.x).toBe(nlcs.x);
  expect(nlBar.x + nlBar.width).toBe(stage.x + stage.width);
  expect(nlBar.x + nlBar.width).toBeGreaterThan(nlLabel.x + nlLabel.width);
  expect(alWildCard.y - (alBar.y + alBar.height)).toBe(18);
});

test("narrowing the window until the whole bracket can't show switches to the stacked bracket", async ({
  page,
}) => {
  await page.setViewportSize(WIDE_SCREEN);
  await openApp(page);
  const al = page.locator("#bracketWrap .league-head.al");
  const nl = page.locator("#bracketWrap .league-head.nl");
  await expect(al).toHaveCSS("text-align", "center");
  expect((await al.boundingBox()).y).toBe((await nl.boundingBox()).y);

  await page.setViewportSize(LAPTOP);

  await expect(al).toHaveCSS("text-align", "left");
  expect((await al.boundingBox()).y).toBeLessThan((await nl.boundingBox()).y);
});

test("on a laptop too narrow for the whole bracket, the stacked bracket fills down to the page's bottom space", async ({
  page,
}) => {
  await page.setViewportSize(LAPTOP);
  await openApp(page);
  await expect(page.locator("#bracketWrap .league-head")).toHaveCount(2);

  const { stageBottom, spaceBottom } = await page.evaluate(() => ({
    stageBottom: document.querySelector(".bracket-stage").getBoundingClientRect().bottom + scrollY,
    spaceBottom: innerHeight - parseFloat(getComputedStyle(document.body).paddingBottom),
  }));
  expect(spaceBottom - stageBottom).toBeGreaterThanOrEqual(0);
  expect(spaceBottom - stageBottom).toBeLessThan(8);
  expect(await readCardTops(page, "Wild Card")).toEqual(
    await readCardTops(page, "Division Series"),
  );
});

test("on a phone, the banner's club reads as a name, without the tabs' outline and capitals", async ({
  page,
}) => {
  await page.setViewportSize(PHONE);
  await openApp(page);
  const club = page.locator("#banner .banner-team .club");
  await expect(club).toBeVisible();

  const look = await club.evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      border: style.borderTopWidth,
      padding: style.paddingLeft,
      textTransform: style.textTransform,
      color: style.color,
      bannerColor: getComputedStyle(document.getElementById("banner")).color,
    };
  });

  expect(look).toEqual({
    border: "0px",
    padding: "0px",
    textTransform: "none",
    color: look.bannerColor,
    bannerColor: look.bannerColor,
  });
});

for (const { layout, viewport } of [
  { layout: "a phone", viewport: PHONE },
  { layout: "a wide screen", viewport: { width: 1024, height: 800 } },
]) {
  test(`on ${layout}, the banner's club sits on the same baseline as its label`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    await openApp(page);
    const banner = page.locator("#banner");
    await expect(banner.locator(".banner-team .team-name")).toBeVisible();

    // A zero-height box set inline after a text has its top on the text's baseline.
    const baselines = await banner.evaluate((element) =>
      [".banner-label", ".team-name"].map((selector) => {
        const text = /** @type {HTMLElement} */ (element.querySelector(selector));
        const line = document.createElement("span");
        const probe = document.createElement("span");
        probe.style.cssText = "display: inline-block; width: 0; height: 0";
        line.append(...text.childNodes, probe);
        text.append(line);
        return probe.getBoundingClientRect().top;
      }),
    );

    expect(baselines[1]).toBe(baselines[0]);
  });
}

test("renders the bracket, standings and stamp from the live scores the Worker saved", async ({
  page,
}) => {
  const app = await openApp(page);

  await expect.poll(() => app.countLiveReads()).toBe(1);
  expect(app.countSnapshotRequests()).toBe(0);

  const bracket = page.locator("#bracketWrap");
  for (const club of PLAYOFF_FIELD_2026) await expect(bracket).toContainText(club);
  await expect(page.locator("#banner")).toContainText("Highest still in");
  const stampLines = page.locator("#stamp > span");
  await expect(stampLines.first()).toHaveText(/^NOW\s*Reds @ Braves 5-5 in the 5th/);
  await expect(stampLines.nth(1)).toHaveText(/^Next first pitch /);

  await page.getByRole("tab", { name: "Standings" }).click();
  await expect(page.locator("#standingsWrap .div-block")).toHaveCount(8);
  await expect(page.locator("#standingsWrap")).toContainText("AL East");
  expect(await app.readDocument("seasons/2026")).toBeNull();
});

test("standings open on each league's playoff field, and every table lines up", async ({
  page,
}) => {
  await openApp(page);
  await page.getByRole("tab", { name: "Standings" }).click();

  const fields = page.locator("#standingsWrap .field-grid .div-block");
  await expect(fields).toHaveCount(2);
  await expect(fields.first()).toContainText("AL Playoff Field");
  await expect(fields.first().locator(".wild-card-head")).toHaveText(/Wild cards/);

  const readHeights = (selector) =>
    page
      .locator(selector)
      .evaluateAll((elements) => elements.map((element) => element.getBoundingClientRect().height));
  const tableHeights = await readHeights("#standingsWrap .div-grid table.st");
  expect(tableHeights).toHaveLength(6);
  expect(new Set(tableHeights).size).toBe(1);
  expect(new Set(await readHeights("#standingsWrap .div-title")).size).toBe(1);
});

test("the standings show each club's game under way, and a delay in gold", async ({ page }) => {
  const snapshot = buildFixtureSnapshot(EVENING_FIXTURE);
  const delayedGame = snapshot.slate.today.games.find((game) => game.home === "BOS");
  delayedGame.delay = "Delayed: Rain";
  await openApp(page, { snapshots: { [EVENING_FIXTURE.season]: snapshot } });
  await page.getByRole("tab", { name: "Standings" }).click();
  const cells = page.locator("#standingsWrap td.next-cell");

  const leading = cells.filter({ hasText: /^Up 3 @ NYY in the 6th$/ });
  await expect(leading).not.toHaveCount(0);
  await expect(leading.first()).toHaveCSS("color", await readColor(page, "--copper-ink"));
  await expect(cells.filter({ hasText: /^Down 3 vs TB in the 6th$/ })).not.toHaveCount(0);
  const delayed = cells.filter({ hasText: /^Down 1 vs CLE \u2014 Delayed: Rain$/ });
  await expect(delayed).not.toHaveCount(0);
  await expect(delayed.first()).toHaveCSS("color", GOLD);
});

test("the leagues' standings sit side by side only when a game under way fits", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1400, height: 900 });
  await openApp(page);
  await page.getByRole("tab", { name: "Standings" }).click();
  const fields = page.locator("#standingsWrap .field-grid .div-block");
  const readTops = () =>
    fields.evaluateAll((blocks) => blocks.map((block) => block.getBoundingClientRect().top));

  await expect.poll(async () => new Set(await readTops()).size).toBe(1);
  const liveCells = page.locator("#standingsWrap td.next-cell.live");
  await expect(liveCells).not.toHaveCount(0);
  const clippedCount = await liveCells.evaluateAll(
    (cells) => cells.filter((cell) => cell.scrollWidth > cell.clientWidth).length,
  );
  expect(clippedCount).toBe(0);

  await page.setViewportSize({ width: 1399, height: 900 });
  await expect.poll(async () => new Set(await readTops()).size).toBe(2);
});

test("says when live scores can't be reached, and shows them once the Worker has them", async ({
  page,
}) => {
  const app = await openApp(page, { liveAvailable: false });

  await expect(page.locator("#stamp")).toContainText(
    "Couldn't reach live scores. Trying again shortly.",
  );

  await app.updateFromWorker();
  await expect(page.locator("#stamp > span").first()).toHaveText(/^NOW\s*Reds @ Braves 5-5/);
  await expect(page.locator("#stamp")).not.toContainText("Couldn't reach live scores");
});

test("while the Worker can't reach MLB, the page says so over the last scores it saved", async ({
  page,
}) => {
  const app = await openApp(page);
  await expect(page.locator("#stamp > span").first()).toHaveText(/^NOW\s*Reds @ Braves 5-5/);

  await app.writeFromAnotherDevice("live/status", {
    error: "upstream_error",
    detail: "MLB Stats API answered 503 for /api/v1/schedule",
    write: "",
    at: "2026-09-25T00:45:00.000Z",
  });

  await expect(page.locator("#stamp")).toContainText(
    "Couldn't reach live scores. Trying again shortly.",
  );
  await expect(page.locator("#stamp > span").first()).toHaveText(/^NOW\s*Reds @ Braves 5-5/);
});

test("rebuilds updates from the saved readings as the Worker adds to them", async ({ page }) => {
  const currentSnapshot = buildFixtureSnapshot(EVENING_FIXTURE);
  const earlier = createReading({ ...currentSnapshot, asOf: "2026-09-24T20:00:00Z" });
  [earlier.teams.NYY, earlier.teams.BOS] = [
    { ...earlier.teams.NYY, seed: earlier.teams.BOS.seed },
    { ...earlier.teams.BOS, seed: earlier.teams.NYY.seed },
  ];
  const part = `${currentSnapshot.slate.today.date}-01`;
  const app = await openApp(page, {
    store: {
      "seasons/2026": {
        year: 2026,
        teams: currentSnapshot.teams,
        series: currentSnapshot.series,
        projected: true,
        ranking: ["NYY", "LAD", "MIL"],
        log: [],
      },
      [`readings-2026/${part}`]: {
        id: part,
        day: currentSnapshot.slate.today.date,
        number: 1,
        start: earlier,
        changes: [],
      },
    },
  });

  const updates = page.locator("#updates");
  await expect.poll(() => app.countOpenSockets()).toBe(1);
  await expect(updates).toBeHidden();
  await app.updateFromWorker();
  await expect(updates).toContainText(/Yankees passed the .*Red Sox for the AL 4 seed/);

  app.changeSnapshots((snapshot) => {
    const { PHI, ...teams } = snapshot.teams;
    return { ...snapshot, teams: { ...teams, NYM: { ...PHI, w: 83, l: 76 } } };
  });
  await app.updateFromWorker();

  await expect(updates).toContainText(/Mets .*Phillies/);
  expect((await app.readDocument(`readings-2026/${part}`)).changes).toHaveLength(2);
  expect(await listOffScaleText(page)).toEqual([]);
  await expect(updates.locator(".what").first()).toHaveCSS("font-size", "14.5px");
});

test("a release note shows in the Updates box, headed New in the app, until it's dismissed", async ({
  page,
}) => {
  await page.route("**/js/release-notes.js", (route) =>
    route.fulfill({
      contentType: "text/javascript",
      body: 'export const RELEASE_NOTES = [{ at: "2026-09-24T23:00:00Z", text: "Something new." }];',
    }),
  );
  const app = await openApp(page);
  const updates = page.locator("#updates");

  await expect(updates.locator(".updates-count")).toHaveText("New in the app");
  await expect(updates.locator(".what")).toHaveText("Something new.");

  await page.getByRole("button", { name: "Dismiss updates" }).click();
  await expect(updates).toBeHidden();
  await expect
    .poll(async () => (await app.readDocument("seasons/2026"))?.seenAt)
    .toBe("2026-09-24T23:00:00.000Z");
  await page.reload();
  await expect(page.locator("#bracketWrap")).toBeVisible();
  await expect(updates).toBeHidden();
});

test("switching to 2025 shows the finished bracket and its champion, read from the Worker once", async ({
  page,
}) => {
  const app = await openApp(page, {
    store: { "seasons/2025": { year: 2025, teams: {}, series: {}, ranking: [], log: [] } },
  });
  await expect.poll(() => app.countLiveReads()).toBe(1);

  await chooseSeason(page, "2025");

  await expect(page.locator("#banner")).toContainText("World Series champions");
  await expect(page.locator("#banner")).toContainText("Dodgers");
  await expect(page.locator("#bracketWrap")).toContainText("Dodgers win the World Series");
  await expect(page.locator("#updates")).toBeHidden();

  await expect.poll(() => app.countSnapshotRequests()).toBe(1);
  await page.clock.fastForward("02:00:00");
  expect(app.countSnapshotRequests()).toBe(1);
});

test("warns under the title when MLB stops sending a field", async ({ page }) => {
  const app = await openApp(page);
  await expect.poll(() => app.countLiveReads()).toBe(1);

  app.changeSnapshots((snapshot) => ({ ...snapshot, missing: ["wildCardRank"] }));
  await app.updateFromWorker();

  await expect(page.locator("#stamp")).toContainText(
    "MLB stopped sending wildCardRank, so some details may be blank.",
  );
  await expect(page.locator("#bracketWrap")).toContainText("Dodgers");
});

test("a warning MLB's feed brings eases the header to its new height", async ({ page }) => {
  const readAnimations = await listAnimations(page);
  const app = await openApp(page);
  await expect.poll(() => app.countLiveReads()).toBe(1);

  app.changeSnapshots((snapshot) => ({ ...snapshot, missing: ["wildCardRank"] }));
  await app.updateFromWorker();

  await expect(page.locator("#stamp")).toContainText("MLB stopped sending wildCardRank");
  const growth = (await readAnimations()).find(({ element }) => element === "stamp");
  expect(parseFloat(String(growth.last.height))).toBeGreaterThan(
    parseFloat(String(growth.first.height)),
  );
});

test("with no field yet, the bracket says it fills in once MLB projects one", async ({ page }) => {
  await openApp(page, { liveAvailable: false });

  await expect(page.getByRole("heading", { name: "No playoff field yet" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Set the field" })).toHaveCount(0);
  await openSettings(page);
  await expect(page.locator("#rankList")).toHaveText(
    "The ranking fills in once there's a playoff field",
  );
});

test("the bracket and standings scroll from the keyboard, even in Safari", async ({ page }) => {
  await openApp(page);
  await expect(page.getByRole("region", { name: "Bracket" })).toHaveAttribute("tabindex", "0");

  await page.getByRole("tab", { name: "Standings" }).click();
  await expect(page.getByRole("region", { name: "AL East standings" })).toHaveAttribute(
    "tabindex",
    "0",
  );
});

test("the ranking can be reordered from the keyboard, and saves", async ({ page }) => {
  const app = await openApp(page);
  await expect.poll(() => app.countLiveReads()).toBe(1);
  await openSettings(page);
  await expect(page.locator("#rankList .rank-item")).toHaveCount(12);

  const firstItem = page.locator("#rankList .rank-item").first();
  const movedClubId = await firstItem.getAttribute("data-id");
  await firstItem.locator(".grip").focus();
  await page.keyboard.press("ArrowDown");

  await expect(page.locator("#rankList .rank-item").nth(1)).toHaveAttribute("data-id", movedClubId);
  await expect(page.locator("#rankList .rank-item").nth(1).locator(".grip")).toBeFocused();
  await expect
    .poll(async () => (await app.readDocument("seasons/2026"))?.ranking[1])
    .toBe(movedClubId);
});

test("a save that fails says so under the title", async ({ page }) => {
  const app = await openApp(page);
  await expect.poll(() => app.countLiveReads()).toBe(1);
  app.failWrites();
  await openSettings(page);
  await expect(page.locator("#rankList .rank-item")).toHaveCount(12);

  await page.locator("#rankList .grip").first().focus();
  await page.keyboard.press("ArrowDown");

  await expect(page.locator("#stamp")).toContainText("Couldn't save your last change.");
});

test("markup in the shared store is shown as text", async ({ page }) => {
  const markup = '<img id="injected" src="x">';
  await openApp(page, {
    liveAvailable: false,
    store: {
      "seasons/2026": {
        year: 2026,
        teams: {},
        series: {},
        ranking: [],
        log: [
          { kind: "berth", team: "NYY", what: "division", div: markup, at: "2026-09-24T20:00:00Z" },
        ],
      },
    },
  });

  await expect(page.locator("#updates")).toContainText(markup);
  await expect(page.locator("#injected")).toHaveCount(0);
});

test("a stored field short a league says there's no field instead of breaking the page", async ({
  page,
}) => {
  const clubs = ["NYY", "TOR", "SEA", "BOS", "DET", "CLE", "HOU", "LAD", "MIL", "PHI", "CHC", "SD"];
  const teams = Object.fromEntries(
    clubs.map((id, index) => [id, { league: index < 7 ? "AL" : "NL", seed: (index % 6) + 1 }]),
  );
  await openApp(page, {
    liveAvailable: false,
    store: { "seasons/2026": { year: 2026, teams, series: {}, ranking: [], log: [] } },
  });

  await expect(page.getByRole("heading", { name: "No playoff field yet" })).toBeVisible();
  await openSettings(page);
  await expect(page.locator("#rankList .rank-item")).toHaveCount(12);
});

const SEASON_WITH_TWO_UPDATES = {
  year: 2026,
  teams: {},
  series: {},
  ranking: [],
  seenAt: "2026-09-24T20:00:00Z",
  log: [
    {
      kind: "elim",
      team: "SEA",
      via: [{ team: "TEX", won: true, opp: "NYM", score: [3, 1] }],
      ended: "2026-09-24T00:55:00Z",
      at: "2026-09-25T00:40:00Z",
    },
    { kind: "lock", at: "2026-09-25T00:30:00Z" },
  ],
};

test("the update list shows when a change happened, not when the page noticed it", async ({
  page,
}) => {
  await openApp(page, { liveAvailable: false, store: { "seasons/2026": SEASON_WITH_TWO_UPDATES } });

  const updateTimes = page.locator("#updates .when");
  await expect(updateTimes).toHaveCount(2);
  await expect(updateTimes.nth(0)).toHaveText(/^8:30\sPM$/);
  await expect(updateTimes.nth(1)).toHaveText(/^Yesterday$/);
  await expect(page.locator("#updates .updates-count")).toHaveText("2 updates since yesterday");
});

test("the update list leaves 18px below it", async ({ page }) => {
  await openApp(page, { liveAvailable: false, store: { "seasons/2026": SEASON_WITH_TWO_UPDATES } });

  await expect(page.locator("#updates")).toHaveCSS("margin-bottom", "18px");
});

test("dismissing updates goes by the newest one's time, not this device's clock", async ({
  page,
}) => {
  const app = await openApp(page, {
    liveAvailable: false,
    now: "2026-09-25T03:00:00Z",
    store: { "seasons/2026": SEASON_WITH_TWO_UPDATES },
  });

  await page.getByRole("button", { name: "Dismiss updates" }).click();
  await expect(page.locator("#updates")).toBeHidden();
  await expect
    .poll(async () => (await app.readDocument("seasons/2026"))?.seenAt)
    .toBe("2026-09-25T00:40:00.000Z");
});

const ELIMINATED_AT_8_10 = (team, winner) => ({
  kind: "elim",
  team,
  via: [{ team: winner, won: true, opp: "NYM", score: [3, 1] }],
  ended: "2026-09-25T00:10:00Z",
  at: "2026-09-25T00:40:00Z",
});

test("updates that share a time show it once", async ({ page }) => {
  await openApp(page, {
    liveAvailable: false,
    store: {
      "seasons/2026": {
        ...SEASON_WITH_TWO_UPDATES,
        log: [
          ELIMINATED_AT_8_10("SEA", "TEX"),
          ELIMINATED_AT_8_10("HOU", "BOS"),
          { kind: "lock", at: "2026-09-25T00:30:00Z" },
        ],
      },
    },
  });

  await expect(page.locator("#updates .when")).toHaveText([/^8:30\sPM$/, /^8:10\sPM$/, ""]);
});

test("a clinch and the elimination it brought are one update, at the game's time", async ({
  page,
}) => {
  const rangersLoss = { team: "TEX", won: false, opp: "MIN", score: [4, 6] };
  const found = { ended: "2026-09-25T00:10:00Z", at: "2026-09-25T00:40:00Z" };
  await openApp(page, {
    liveAvailable: false,
    store: {
      "seasons/2026": {
        ...SEASON_WITH_TWO_UPDATES,
        log: [
          {
            kind: "berth",
            team: "HOU",
            what: "division",
            div: "AL West",
            via: [rangersLoss],
            ...found,
          },
          { kind: "elim", team: "TEX", via: [rangersLoss], ...found },
        ],
      },
    },
  });

  const updates = page.locator("#updates");
  await expect(updates.locator(".updates-count")).toHaveText("1 update since earlier today");
  await expect(updates.locator(".what")).toHaveText(
    "Astros clinch the AL West \u2014 Rangers eliminated with a 6-4 loss to the Twins",
  );
  await expect(updates.locator(".when")).toHaveText(/^8:10\sPM$/);
});

// The page's clock reads 8:44 PM Eastern, which is the next morning in London and Tokyo.
const LOCAL_TIMES_OF_THE_NEWER_UPDATE = {
  "Pacific/Honolulu": "2:30 PM",
  "Europe/London": "1:30 AM",
  "Asia/Tokyo": "9:30 AM",
};

for (const [timezoneId, localTime] of Object.entries(LOCAL_TIMES_OF_THE_NEWER_UPDATE)) {
  test.describe(`in ${timezoneId}`, () => {
    test.use({ timezoneId });

    test("the update list tells time and day by the viewer's own clock", async ({ page }) => {
      await openApp(page, {
        liveAvailable: false,
        store: { "seasons/2026": SEASON_WITH_TWO_UPDATES },
      });

      const updateTimes = page.locator("#updates .when");
      await expect(updateTimes).toHaveCount(2);
      await expect(updateTimes.nth(0)).toHaveText(localTime);
      await expect(updateTimes.nth(1)).toHaveText("Yesterday");
    });
  });
}

const buildEmptySeasonSnapshot = (season, springStart) => ({
  ...buildFixtureSnapshot(EVENING_FIXTURE),
  season,
  springStart,
  projected: true,
  teams: {},
  series: {},
  log: [],
  standings: { divisions: {} },
  slate: null,
});

test("the page shows the season the store says is current", async ({ page }) => {
  await openApp(page, {
    now: "2027-02-19T15:00:00Z",
    store: { "live/current": { season: 2027 } },
    snapshots: { 2027: buildEmptySeasonSnapshot(2027, "2027-02-19") },
  });

  await expect(page.locator("#yearSel")).toHaveValue("2027");
  await expect(page.getByRole("heading", { name: "No playoff field yet" })).toBeVisible();
});

test("a page left open turns over when the store moves on to a new season", async ({ page }) => {
  const app = await openApp(page, {
    now: "2027-02-19T15:00:00Z",
    store: { "live/current": { season: 2026 } },
    snapshots: { 2027: buildEmptySeasonSnapshot(2027, "2027-02-19") },
  });
  await expect.poll(() => app.countOpenSockets()).toBe(1);
  await expect(page.locator("#yearSel")).toHaveValue("2026");

  // What the Worker's update saves once spring training has started.
  await app.writeFromAnotherDevice("live/current", { season: 2027 });

  await expect(page.locator("#yearSel")).toHaveValue("2027");
  await expect(page.getByRole("heading", { name: "No playoff field yet" })).toBeVisible();
});

test("while the store says last year's season is current, the page shows it and asks about no other", async ({
  page,
}) => {
  const app = await openApp(page, {
    now: "2027-02-18T15:00:00Z",
    store: { "live/current": { season: 2026 } },
    snapshots: { 2027: buildEmptySeasonSnapshot(2027, "2027-02-19") },
  });
  await expect(page.locator("#yearSel")).toHaveValue("2026");

  await page.clock.fastForward("02:00:00");

  await expect(page.locator("#yearSel")).toHaveValue("2026");
  expect(app.countSnapshotRequests()).toBe(0);
});

test("on a phone, the tabs float at the bottom and stay there while the page scrolls", async ({
  page,
}) => {
  await page.setViewportSize(PHONE);
  await openApp(page);
  const bar = page.locator("#tabBar");
  const resting = await bar.boundingBox();
  const gapBelow = PHONE.height - (resting.y + resting.height);
  expect(gapBelow).toBeGreaterThanOrEqual(16);
  expect(gapBelow).toBeLessThan(32);

  await page.getByRole("tab", { name: "Standings" }).click();
  await expect(page.getByRole("tab", { name: "Standings" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(page.locator("#view-standings")).toBeVisible();

  await page.mouse.wheel(0, 800);
  await expect
    .poll(() => bar.boundingBox().then((box) => Math.round(box.y)))
    .toBe(Math.round(resting.y));
});

test("on a phone, dragging along the tab bar picks the tab it's released on", async ({ page }) => {
  await page.setViewportSize(PHONE);
  await openApp(page);
  const from = await page.getByRole("tab", { name: "Bracket" }).boundingBox();
  const to = await page.getByRole("tab", { name: "Standings" }).boundingBox();

  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 8 });
  await page.mouse.up();

  await expect(page.getByRole("tab", { name: "Standings" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(page.locator("#view-standings")).toBeVisible();
});

test("on a phone, a screen reader's bare click still switches tabs", async ({ page }) => {
  await page.setViewportSize(PHONE);
  await openApp(page);

  await page.getByRole("tab", { name: "Games" }).dispatchEvent("click", { detail: 1 });

  await expect(page.getByRole("tab", { name: "Games" })).toHaveAttribute("aria-selected", "true");
  await expect(page.locator("#view-games")).toBeVisible();
});

test("on a phone, even a page shorter than the screen can scroll", async ({ page }) => {
  await page.setViewportSize(PHONE);
  await openApp(page);
  await expect(page.locator("#view-bracket")).toBeVisible();

  const { scrollHeight, clientHeight } = await page.evaluate(() => ({
    scrollHeight: document.scrollingElement.scrollHeight,
    clientHeight: document.scrollingElement.clientHeight,
  }));
  expect(scrollHeight).toBeGreaterThan(clientHeight);
});

test("on a phone, tapping the tab that's showing scrolls back to the top", async ({ page }) => {
  await page.setViewportSize(PHONE);
  await openApp(page);
  await page.getByRole("tab", { name: "Standings" }).click();
  await page.mouse.wheel(0, 800);
  await expect.poll(() => page.evaluate(() => scrollY)).toBeGreaterThan(0);

  await page.getByRole("tab", { name: "Standings" }).click();

  await expect.poll(() => page.evaluate(() => scrollY)).toBe(0);
  await expect(page.locator("#view-standings")).toBeVisible();
});

test("on a phone, dragging back to the tab that's showing leaves the page where it is", async ({
  page,
}) => {
  await page.setViewportSize(PHONE);
  await openApp(page);
  await page.mouse.wheel(0, 800);
  await expect.poll(() => page.evaluate(() => scrollY)).toBeGreaterThan(0);
  const scrolled = await page.evaluate(() => scrollY);
  const from = await page.getByRole("tab", { name: "Bracket" }).boundingBox();
  const to = await page.getByRole("tab", { name: "Standings" }).boundingBox();

  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 8 });
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2, { steps: 8 });
  await page.mouse.up();
  await page.clock.runFor(700);

  expect(await page.evaluate(() => scrollY)).toBe(scrolled);
});

/** How far the tab bar's pill sits from resting on a tab: its center's offset and its extra height. */
const measurePillFromRest = (page, name) =>
  page.evaluate((name) => {
    const pill = document.querySelector(".tab-pill").getBoundingClientRect();
    const tab = [...document.querySelectorAll("[role=tab]")]
      .find((button) => button.textContent.trim() === name)
      .getBoundingClientRect();
    return {
      offset: Math.round(pill.left + pill.width / 2 - (tab.left + tab.width / 2)),
      extraHeight: Math.round(pill.height - tab.height),
    };
  }, name);

test("on a phone, leaving the page mid-press puts the tab bar's pill back at rest", async ({
  page,
}) => {
  await page.setViewportSize(PHONE);
  await openApp(page);
  const games = await page.getByRole("tab", { name: "Games" }).boundingBox();
  await page.mouse.move(games.x + games.width / 2, games.y + games.height / 2);
  await page.mouse.down();
  await page.clock.runFor(400);

  await setHidden(page, true);

  expect(await measurePillFromRest(page, "Bracket")).toEqual({ offset: 0, extraHeight: 0 });
});

test("on a phone, the tab bar's pill still moves after a motion's frame was lost while away", async ({
  page,
}) => {
  await page.setViewportSize(PHONE);
  await openApp(page);
  await page.getByRole("tab", { name: "Games" }).click();
  await page.evaluate(() => {
    const requestFrame = window.requestAnimationFrame;
    window.requestAnimationFrame = () => 1;
    document.addEventListener(
      "visibilitychange",
      () => {
        window.requestAnimationFrame = requestFrame;
      },
      { once: true },
    );
  });
  await page.clock.runFor(100);
  await setHidden(page, true);
  await setHidden(page, false);

  await page.getByRole("tab", { name: "Standings" }).click();
  await page.clock.runFor(2000);

  expect(await measurePillFromRest(page, "Standings")).toEqual({ offset: 0, extraHeight: 0 });
});

const readBracketFit = (page) =>
  page.evaluate(() => {
    const scroller = document.querySelector(".tree-scroll");
    const stage = document.querySelector(".bracket-stage").getBoundingClientRect();
    return {
      stageBottom: stage.bottom + scrollY,
      lowestNoteBottom: Math.max(
        ...[...document.querySelectorAll(".card-note")].map(
          (note) => note.getBoundingClientRect().bottom + scrollY,
        ),
      ),
      dotsTop: document.querySelector(".round-dots").getBoundingClientRect().top + scrollY,
      scrollLeft: scroller.scrollLeft,
      bracketOverflow: scroller.scrollWidth - scroller.clientWidth,
      pageOverflow: document.scrollingElement.scrollWidth - document.scrollingElement.clientWidth,
    };
  });

const expectBracketToFillHeight = async (page) => {
  await expect
    .poll(async () => {
      const { stageBottom, dotsTop } = await readBracketFit(page);
      return dotsTop - stageBottom;
    })
    .toBeGreaterThanOrEqual(8);
  const { stageBottom, lowestNoteBottom, dotsTop } = await readBracketFit(page);
  expect(dotsTop - stageBottom).toBeLessThan(18);
  expect(stageBottom - lowestNoteBottom).toBeLessThan(4);
};

test("on a phone, the bracket fills the height above the tab bar and swipes sideways", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 900 });
  await openApp(page);
  await expect(page.locator(".bracket-stage")).toBeVisible();
  await expectBracketToFillHeight(page);
  const { bracketOverflow, pageOverflow } = await readBracketFit(page);
  expect(bracketOverflow).toBeGreaterThan(0);
  expect(pageOverflow).toBe(0);
});

test("on a phone a little short of room, the bracket's spaces shrink so it fits above the round dots", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 820 });
  await openApp(page);
  await expect(page.locator(".bracket-stage")).toBeVisible();
  await expectBracketToFillHeight(page);
  const { belowLine, betweenRows } = await readStackedSpaces(page);
  expect(belowLine).toBeLessThan(11);
  expect(betweenRows).toBeLessThan(13);
  expect(
    await page.evaluate(() => document.scrollingElement.scrollHeight - innerHeight),
  ).toBeLessThanOrEqual(1);
});

test("on a phone, the bracket redraws for a new screen height and keeps its sideways scroll", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 960 });
  await openApp(page);
  await expect(page.locator(".bracket-stage")).toBeVisible();
  await page.locator(".tree-scroll").evaluate(
    (scroller) =>
      new Promise((resolve) => {
        scroller.addEventListener("scrollend", resolve, { once: true });
        scroller.scrollLeft = 300;
      }),
  );
  const { scrollLeft } = await readBracketFit(page);
  expect(scrollLeft).toBeGreaterThan(0);

  await page.setViewportSize({ width: 390, height: 900 });

  await expectBracketToFillHeight(page);
  expect((await readBracketFit(page)).scrollLeft).toBe(scrollLeft);
});

test("on a phone, a bracket drawn while another tab showed fills the height once shown", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 900 });
  await openApp(page);
  await page.getByRole("tab", { name: "Standings" }).click();
  await page.reload();
  await expect(page.locator("#view-standings")).toBeVisible();

  await page.getByRole("tab", { name: "Bracket" }).click();

  await expect(page.locator(".bracket-stage")).toBeVisible();
  await expectBracketToFillHeight(page);
});

test("clicking the tab that's showing scrolls back to the top", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 500 });
  await openApp(page);
  await expect(page.locator("#bracketWrap")).toContainText("Dodgers");
  await page.mouse.wheel(0, 800);
  await expect.poll(() => page.evaluate(() => scrollY)).toBeGreaterThan(0);

  await page.getByRole("tab", { name: "Bracket" }).dispatchEvent("click");

  await expect.poll(() => page.evaluate(() => scrollY)).toBe(0);
});

test("the page reopens on the tab it was last on", async ({ page }) => {
  await page.setViewportSize(PHONE);
  await openApp(page);
  await page.getByRole("tab", { name: "Standings" }).click();

  await page.reload();

  await expect(page.getByRole("tab", { name: "Standings" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(page.locator("#view-standings")).toHaveCSS("display", "block");
  await expect(page.locator("#view-bracket")).toHaveCSS("display", "none");
});

test("the page shows the tab it was last on before its modules have loaded", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("lastTab", "games"));
  await page.route(
    (url) => url.pathname === "/js/app.js",
    (route) => route.abort(),
  );

  await openApp(page);

  const tab = page.getByRole("tab", { name: "Games" });
  await expect(tab).toHaveAttribute("aria-selected", "true");
  await expect(tab).toHaveClass(/\bactive\b/);
  await expect(page.locator("#view-games")).toHaveCSS("display", "block");
  await expect(page.locator("#view-bracket")).toHaveCSS("display", "none");
});

test("a tap shows only the page's own states: no gray flash, and no hover left behind", async ({
  page,
}) => {
  await openApp(page);
  expect(await listTapFlashes(page)).toEqual([]);
  expect(await listTouchHoverRules(page)).toEqual([]);
});

for (const { screen, viewport } of [
  { screen: "a wide screen", viewport: { width: 1280, height: 900 } },
  { screen: "a phone", viewport: { width: 390, height: 844 } },
]) {
  test.describe(`on ${screen}`, () => {
    test.use({ viewport, contextOptions: { reducedMotion: "reduce" } });

    test("every piece of text keeps to the type scale, in every view", async ({ page }) => {
      await openApp(page, { snapshots: { 2026: buildSnapshotWithStarters() } });
      await expect(page.locator("#bracketWrap .card-note").first()).toBeVisible();
      expect(await listOffScaleText(page)).toEqual([]);
      await page.getByRole("tab", { name: "Games" }).click();
      for (const list of ["Previous", "Today", "Next"]) {
        await page.getByRole("tab", { name: list }).click();
        await expect(page.locator(`#games-${list.toLowerCase()} .game-row`).first()).toBeVisible();
        expect(await listOffScaleText(page)).toEqual([]);
      }
      await page.getByRole("tab", { name: "Standings" }).click();
      await expect(page.locator("table.st tbody tr").first()).toBeVisible();
      expect(await listOffScaleText(page)).toEqual([]);
      await page.locator('.div-grid tr[data-team="SEA"] .team-open').click();
      await expect(page.locator("#teamDialog .team-stats")).toBeVisible();
      expect(await listOffScaleText(page)).toEqual([]);
      await page.keyboard.press("Escape");
      await expect(page.locator("#teamDialog")).toBeHidden();
      await openSettings(page);
      await expect(page.locator("#settingsDialog")).toBeVisible();
      expect(await listOffScaleText(page)).toEqual([]);
    });
  });
}

test("Chivo Mono draws 6% smaller than its size, so it looks as big as Barlow", async ({
  page,
}) => {
  await openApp(page);
  await page.evaluate(() => document.fonts.ready);
  const sizeAdjusts = await page.evaluate(() =>
    [...document.fonts]
      .filter((font) => font.family.replaceAll('"', "") === "Chivo Mono")
      // TypeScript's DOM types don't list FontFace's sizeAdjust yet.
      .map((font) => /** @type {FontFace & { sizeAdjust: string }} */ (font).sizeAdjust),
  );
  expect(sizeAdjusts).toEqual(["94%", "94%"]);
});

test("Chivo Mono takes its own size at each step: sentences 14.5px, facts and labels 13px", async ({
  page,
}) => {
  await openApp(page);
  await expect(page.locator("#stamp")).toBeVisible();
  await expect(page.locator("#stamp")).toHaveCSS("font-size", "13px");
  await expect(page.locator("#stamp")).toHaveCSS("line-height", "18px");
  await expect(page.locator("#bracketWrap .card-note").first()).toHaveCSS("font-size", "13px");
});
