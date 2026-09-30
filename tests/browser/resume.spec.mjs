import { test, expect, openApp, openSettings, EVENING_FIXTURE } from "./harness.mjs";

const RELEASE = { version: "2.13.0", commit: "abc1234", builtAt: "2026-09-28T00:10:41Z" };
const NEXT_RELEASE = { version: "2.13.1", commit: "def5678", builtAt: "2026-09-28T02:00:00Z" };
const MINUTE_MS = 60 * 1000;

/**
 * Serves version.json, and lets a test deploy a newer release.
 * @param {import("@playwright/test").Page} page
 */
async function serveReleases(page) {
  const served = { release: RELEASE, requests: 0 };
  await page.route(
    (url) => url.pathname === "/version.json",
    (route) => {
      served.requests++;
      return route.fulfill({ json: served.release });
    },
  );
  return served;
}

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

test("a page asleep half an hour reloads when it wakes, even unannounced", async ({ page }) => {
  await serveReleases(page);
  await openApp(page);
  await markPage(page);

  await expectReload(page, () => sleepUnannounced(page, 31));
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

  await expectReload(page, () => page.clock.runFor(2 * MINUTE_MS));
  expect(app.countSnapshotRequests()).toBeGreaterThan(requestsBefore);
});

test("a page that wakes mid-drag after half an hour reloads once the drag ends", async ({
  page,
}) => {
  await serveReleases(page);
  const app = await openApp(page);
  await expect.poll(() => app.countSnapshotRequests()).toBe(1);
  await openSettings(page);
  const grip = page.locator("#rankList .grip").first();
  const box = await grip.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height * 3, { steps: 5 });
  await markPage(page);

  await sleepUnannounced(page, 31);
  expect(await isSameLoad(page)).toBe(true);

  await expectReload(page, async () => {
    await page.mouse.up();
    await page.clock.runFor(15 * 1000);
  });
});
