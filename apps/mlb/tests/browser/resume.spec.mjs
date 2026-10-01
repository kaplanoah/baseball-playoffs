import { NEXT_RELEASE, serveReleases } from "../../../../tests/browser/serve-releases.mjs";
import { test, expect, openApp, openSettings, EVENING_FIXTURE } from "./harness.mjs";

const MINUTE_MS = 60 * 1000;

// A reload clears whatever the test left on the window.
/** @param {import("@playwright/test").Page} page */
const markPage = (page) => page.evaluate(() => Object.assign(window, { isSameLoad: true }));
/** @param {import("@playwright/test").Page} page */
const isSameLoad = (page) => page.evaluate(() => "isSameLoad" in window);

/**
 * @param {import("@playwright/test").Page} page
 * @param {() => Promise<unknown>} action
 */
async function expectReload(page, action) {
  const reloaded = page.waitForEvent("load");
  await action();
  await reloaded;
  expect(await isSameLoad(page)).toBe(false);
}

/** @param {import("@playwright/test").Page} page */
const comeBack = (page) => page.evaluate(() => dispatchEvent(new Event("focus")));

/**
 * The phone suspends the page without saying so, and it wakes up this much later.
 * @param {import("@playwright/test").Page} page
 * @param {number} minutes
 */
async function sleepUnannounced(page, minutes) {
  await page.clock.setSystemTime(Date.parse(EVENING_FIXTURE.now) + minutes * MINUTE_MS);
  await page.clock.runFor(15 * 1000);
}

test("a page coming back reloads itself once a deploy has replaced it", async ({ page }) => {
  const served = await serveReleases(page);
  await openApp(page);
  await expect.poll(() => served.requests).toBe(1);
  await markPage(page);

  served.release = NEXT_RELEASE;
  await expectReload(page, () => comeBack(page));
});

test("a page coming back stays as it is when nothing was deployed", async ({ page }) => {
  const served = await serveReleases(page);
  await openApp(page);
  await expect.poll(() => served.requests).toBe(1);
  await markPage(page);

  await comeBack(page);

  await expect.poll(() => served.requests).toBe(2);
  expect(await isSameLoad(page)).toBe(true);
});

test("a page whose first release check failed still reloads for a later deploy", async ({
  page,
}) => {
  const served = await serveReleases(page);
  served.failures = 1;
  await openApp(page);
  await expect.poll(() => served.requests).toBe(1);
  await comeBack(page);
  await expect.poll(() => served.requests).toBe(3);
  await markPage(page);

  served.release = NEXT_RELEASE;
  await expectReload(page, () => comeBack(page));
});

/** @param {import("@playwright/test").Page} page */
const readFirstRanked = (page) => page.locator("#rankList .rank-item").first();

/**
 * Saves a reversed ranking the page's socket never hears of.
 * @param {Awaited<ReturnType<typeof openApp>>} app
 */
async function reverseRankingWhileAway(app) {
  await app.updateFromWorker();
  await expect.poll(() => app.countOpenSockets()).toBeGreaterThan(0);
  const season = await app.readDocument("seasons/2026");
  const reversed = [...season.ranking].reverse();
  await app.writeWhileAway("seasons/2026", { ...season, ranking: reversed });
  return reversed;
}

/** @param {import("@playwright/test").Page} page */
const hideAndShow = (page) =>
  page.evaluate(() => {
    for (const hidden of [true, false]) {
      Object.defineProperty(document, "hidden", { configurable: true, get: () => hidden });
      document.dispatchEvent(new Event("visibilitychange"));
    }
  });

test("a page asleep half an hour reads what it missed when it wakes, without reloading", async ({
  page,
}) => {
  await serveReleases(page);
  const app = await openApp(page);
  const reversed = await reverseRankingWhileAway(app);
  await markPage(page);

  await sleepUnannounced(page, 31);

  await expect(readFirstRanked(page)).toHaveAttribute("data-id", reversed[0]);
  expect(await isSameLoad(page)).toBe(true);
});

test("a page hidden for a moment reads what it missed when it's shown again", async ({ page }) => {
  await serveReleases(page);
  const app = await openApp(page);
  const reversed = await reverseRankingWhileAway(app);
  await markPage(page);

  await hideAndShow(page);

  await expect(readFirstRanked(page)).toHaveAttribute("data-id", reversed[0]);
  expect(await isSameLoad(page)).toBe(true);
});

test("a page whose saved data couldn't load loads again when it comes back", async ({ page }) => {
  await serveReleases(page);
  await openApp(page, { portalReadsDocuments: true });
  await expect(page.locator("#stamp")).toContainText("Couldn't load your saved data");
  await markPage(page);

  await expectReload(page, () => sleepUnannounced(page, 5));
});

test("a reload shows what the page last showed while the store is still answering", async ({
  page,
}) => {
  const app = await openApp(page);
  await page.getByRole("tab", { name: "Games" }).click();
  await expect(page.locator("#games-today .game-row")).toHaveCount(12);
  await expect(page.locator("#bracketWrap .matchup-row")).toHaveCount(22);
  const release = await app.holdStore();

  await page.reload();

  await expect(page.locator("#bracketWrap .matchup-row")).toHaveCount(22);
  await expect(page.locator("#games-today .game-row")).toHaveCount(12);
  release();
});

test("a reload leaves out live scores it last showed that it can no longer read", async ({
  page,
}) => {
  const app = await openApp(page);
  await app.updateFromWorker();
  await page.getByRole("tab", { name: "Games" }).click();
  await expect(page.locator("#games-today .game-row")).toHaveCount(12);
  await page.addInitScript(() => {
    const lastSeen = JSON.parse(localStorage.getItem("lastSeen") ?? "null");
    if (!lastSeen?.live) return;
    lastSeen.live.version = 2;
    localStorage.setItem("lastSeen", JSON.stringify(lastSeen));
  });
  const release = await app.holdStore();

  await page.reload();

  await expect(page.locator("#bracketWrap .matchup-row")).toHaveCount(22);
  await expect(page.locator("#games-today .game-row")).toHaveCount(0);
  release();
  await expect(page.locator("#games-today .game-row")).toHaveCount(12);
});

test("a page asleep a few minutes checks for a deploy instead of reloading", async ({ page }) => {
  const served = await serveReleases(page);
  await openApp(page);
  await expect.poll(() => served.requests).toBe(1);
  await markPage(page);

  await sleepUnannounced(page, 5);

  await expect.poll(() => served.requests).toBe(2);
  expect(await isSameLoad(page)).toBe(true);
});

test("live scores the page can't read reload it once a newer release is out", async ({ page }) => {
  const served = await serveReleases(page);
  const app = await openApp(page);
  await expect.poll(() => served.requests).toBe(1);
  const requestsBefore = app.countSnapshotRequests();
  await markPage(page);

  served.release = NEXT_RELEASE;
  app.changeSnapshots((snapshot) => ({ ...snapshot, version: 2 }));

  // The page schedules its next read only once the last one answers, which on a slow machine can
  // come after a single jump of the clock, so the clock moves until the next read goes out.
  await expectReload(page, () =>
    expect
      .poll(async () => {
        await page.clock.runFor(30 * 1000);
        return app.countSnapshotRequests();
      })
      .toBeGreaterThan(requestsBefore),
  );
});

/**
 * Picks up the first ranking card and holds it partway down the list.
 * @param {import("@playwright/test").Page} page
 */
async function startDrag(page) {
  await openSettings(page);
  const box = await page.locator("#rankList .grip").first().boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height * 3, { steps: 5 });
}

test("a page that wakes mid-drag after half an hour keeps the drag and doesn't reload", async ({
  page,
}) => {
  await serveReleases(page);
  const app = await openApp(page);
  await expect.poll(() => app.countSnapshotRequests()).toBe(1);
  await startDrag(page);
  await markPage(page);

  await sleepUnannounced(page, 31);
  await expect(page.locator("#rankList .dragging")).toHaveCount(1);
  await page.mouse.up();
  await page.clock.runFor(15 * 1000);

  expect(await isSameLoad(page)).toBe(true);
});

test("a deploy found mid-drag reloads the page once the drag ends", async ({ page }) => {
  const served = await serveReleases(page);
  const app = await openApp(page);
  await expect.poll(() => app.countSnapshotRequests()).toBe(1);
  await expect.poll(() => served.requests).toBe(1);
  await startDrag(page);
  await markPage(page);

  served.release = NEXT_RELEASE;
  await comeBack(page);
  await expect.poll(() => served.requests).toBe(2);
  expect(await isSameLoad(page)).toBe(true);

  await expectReload(page, async () => {
    await page.mouse.up();
    await page.clock.runFor(15 * 1000);
  });
});
