import { buildReleaseServer, servePageFiles } from "../../../../tests/browser/release-worker.mjs";
import { NEXT_RELEASE, serveReleases } from "../../../../tests/browser/serve-releases.mjs";
import { test, expect, openApp } from "./harness.mjs";

const MINUTE_MS = 60 * 1000;
const LAST_RELEASE = { version: "1.4.0", commit: "abc1234", builtAt: "2026-10-01T22:00:00Z" };
const NEW_RELEASE = { version: "1.4.1", commit: "def5678", builtAt: "2026-10-01T23:00:00Z" };

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

test("a page that asks a server still on the last release for one of its files reloads until they match", async ({
  page,
}) => {
  const serveRelease = buildReleaseServer("wnba", LAST_RELEASE);
  const serveNextRelease = buildReleaseServer("wnba", NEW_RELEASE);
  const loads = { page: 0, skewed: 0 };
  await servePageFiles(page, (url) => {
    if (url.pathname === "/") loads.page++;
    const isSkewed = url.pathname === `/release/${NEW_RELEASE.commit}/styles.css` && !loads.skewed;
    if (isSkewed) loads.skewed++;
    return (isSkewed ? serveRelease : serveNextRelease)(url);
  });
  await openApp(page);
  expect(loads).toEqual({ page: 1, skewed: 1 });

  await page.clock.runFor(2000);

  await expect.poll(() => loads.page).toBe(2);
  await expect(findFinal(page)).toContainText("Liberty win 2-0");
  await expect(page.locator(".view.active")).toBeVisible();
  expect(await page.evaluate(() => sessionStorage.getItem("releaseReloads"))).toBe(null);
  await page.clock.runFor(2000);
  expect(loads.page).toBe(2);
});

test("a page from the last release reloads when it comes back, though the Worker already served the next one's version", async ({
  page,
}) => {
  const serveRelease = buildReleaseServer("wnba", LAST_RELEASE);
  const serveNextRelease = buildReleaseServer("wnba", NEW_RELEASE);
  await servePageFiles(page, (url) =>
    (url.pathname === "/version.json" ? serveNextRelease : serveRelease)(url),
  );
  await openApp(page);
  await expect(findFinal(page)).toContainText("Liberty win 2-0");
  await markPage(page);

  const reloaded = page.waitForEvent("load");
  await sleepUnannounced(page, 5);
  await reloaded;

  expect(await isSameLoad(page)).toBe(false);
});

/** @param {import("@playwright/test").Page} page */
const readReleaseReloads = (page) => page.evaluate(() => sessionStorage.getItem("releaseReloads"));

test("a page that has reloaded as often as it may for a missing file stays as it is", async ({
  page,
}) => {
  const serveRelease = buildReleaseServer("wnba", LAST_RELEASE);
  const serveNextRelease = buildReleaseServer("wnba", NEW_RELEASE);
  await servePageFiles(page, (url) => {
    const isSkewed = url.pathname === `/release/${NEW_RELEASE.commit}/styles.css`;
    return (isSkewed ? serveRelease : serveNextRelease)(url);
  });
  await page.addInitScript(() => sessionStorage.setItem("releaseReloads", "15"));
  await openApp(page);
  await markPage(page);

  await page.clock.runFor(10_000);

  expect(await readReleaseReloads(page)).toBe("15");
  expect(await isSameLoad(page)).toBe(true);
  await expect(findFinal(page)).toContainText("Liberty win 2-0");
});

test("a file outside the release's folder that fails to load leaves the page as it is", async ({
  page,
}) => {
  await servePageFiles(page, buildReleaseServer("wnba", LAST_RELEASE));
  await openApp(page);
  await markPage(page);

  await page.evaluate(
    () =>
      new Promise((resolve) => {
        const link = Object.assign(document.createElement("link"), {
          rel: "stylesheet",
          href: "missing.css",
          onerror: resolve,
        });
        document.head.append(link);
      }),
  );
  await page.clock.runFor(10_000);

  expect(await readReleaseReloads(page)).toBe(null);
  expect(await isSameLoad(page)).toBe(true);
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
