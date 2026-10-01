import { NEXT_RELEASE, serveReleases } from "../../../../tests/browser/serve-releases.mjs";
import { test, expect, openApp } from "./harness.mjs";

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

/** @param {import("@playwright/test").Page} page */
const waitForTick = (page) => page.clock.runFor(15 * 1000);

/**
 * The phone suspends the page without saying so, and it wakes up this much later.
 * @param {import("@playwright/test").Page} page
 * @param {number} minutes
 */
async function sleepUnannounced(page, minutes) {
  const now = await page.evaluate(() => Date.now());
  await page.clock.setSystemTime(now + minutes * MINUTE_MS);
  await page.clock.runFor(15 * 1000);
}

/** @param {import("@playwright/test").Page} page */
const findFinal = (page) => page.locator('[data-series="1-0"]');

test("a reload shows the bracket the page last showed while the store is still answering", async ({
  page,
}) => {
  const app = await openApp(page);
  await expect(findFinal(page)).toContainText("Liberty win 2-0");
  const release = await app.holdStore();

  await page.reload();

  await expect(findFinal(page)).toContainText("Liberty win 2-0");
  release();
});

test("a last-shown season the page can't draw is skipped", async ({ page }) => {
  await page.addInitScript(() =>
    localStorage.setItem("lastSeen", JSON.stringify({ year: 2026, season: { series: 5 } })),
  );

  await openApp(page);

  await expect(findFinal(page)).toContainText("Liberty win 2-0");
});

test("a page asleep half an hour reads what it missed when it wakes, without reloading", async ({
  page,
}) => {
  const app = await openApp(page);
  await page.getByRole("tab", { name: "Games" }).click();
  const row = page.locator('[data-game="1042600132"]');
  await expect(row).toBeVisible();
  await app.changeSeasonWhileAway((season) => {
    const game = season.games.find((each) => each.id === "1042600132");
    Object.assign(game, { state: "live", status: "Q2 5:10", period: 2, clock: "5:10" });
    return season;
  });
  await markPage(page);

  await sleepUnannounced(page, 31);

  await expect(row.locator(".game-status .clock")).toHaveText("Q2 5:10");
  expect(await isSameLoad(page)).toBe(true);
});

test("a page whose first load failed loads the last season once the store answers", async ({
  page,
}) => {
  const app = await openApp(page);
  await app.moveSeasonTo(2025);
  await page.addInitScript(() => localStorage.removeItem("lastSeen"));
  const isStoreRead = (/** @type {URL} */ url) => url.pathname.startsWith("/store/");
  await page.route(isStoreRead, (route) => route.fulfill({ status: 503, body: "" }));
  await page.reload();
  await expect(page.locator("#stamp")).toContainText("Can't reach the page's server");
  await page.unroute(isStoreRead);

  await sleepUnannounced(page, 5);

  await expect(findFinal(page)).toContainText("Liberty win 2-0");
  await expect(page.locator("#stamp")).not.toContainText("Can't reach the page's server");
});

test("a page coming back reloads itself once a deploy has replaced it", async ({ page }) => {
  const served = await serveReleases(page);
  await openApp(page);
  await expect.poll(() => served.requests).toBe(1);
  await markPage(page);

  served.release = NEXT_RELEASE;
  await expectReload(page, () => comeBack(page));
});

test("a page coming back whose release check fails tries again until it finds the deploy", async ({
  page,
}) => {
  const served = await serveReleases(page);
  await openApp(page);
  await expect.poll(() => served.requests).toBe(1);
  await markPage(page);

  served.release = NEXT_RELEASE;
  served.failures = 2;
  await comeBack(page);
  await expect.poll(() => served.requests).toBe(2);
  await waitForTick(page);
  await expect.poll(() => served.requests).toBe(3);
  expect(await isSameLoad(page)).toBe(true);

  await expectReload(page, () => waitForTick(page));
});

test("a release check that never answers gives up, and the next tick tries again", async ({
  page,
}) => {
  const served = await serveReleases(page);
  await openApp(page);
  await expect.poll(() => served.requests).toBe(1);
  await markPage(page);

  served.release = NEXT_RELEASE;
  served.isHanging = true;
  await comeBack(page);
  await expect.poll(() => served.requests).toBe(2);
  served.isHanging = false;

  await expectReload(page, () => page.clock.runFor(30 * 1000));
});

test("a page whose first release check failed still reloads for a later deploy", async ({
  page,
}) => {
  const served = await serveReleases(page);
  served.failures = 1;
  await openApp(page);
  await expect.poll(() => served.requests).toBe(1);
  await waitForTick(page);
  await expect.poll(() => served.requests).toBe(3);
  await markPage(page);

  served.release = NEXT_RELEASE;
  await expectReload(page, () => comeBack(page));
});
