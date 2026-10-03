import { test, expect, openApp } from "./harness.mjs";
import { holdRequests } from "../../../../tests/browser/hold-requests.mjs";

test.use({ contextOptions: { reducedMotion: "reduce" } });

const holdPageCode = (page) => holdRequests(page, (url) => url.pathname.endsWith("/js/app.js"));

/** @param {import("@playwright/test").Page} page */
const findFinalWinner = (page) => page.locator('[data-series="1-0"] .team-line.won');

/**
 * @param {import("@playwright/test").Page} page
 * @param {Record<string, string>} items what the page's storage holds before it loads
 */
const storeBeforeLoad = (page, items) =>
  page.addInitScript((stored) => {
    for (const [key, value] of Object.entries(stored)) localStorage.setItem(key, value);
  }, items);

test("a reload shows what the page last drew before its code arrives", async ({ page }) => {
  await openApp(page);
  await expect(findFinalWinner(page)).toContainText("Liberty");
  const stamp = await page.locator("#stamp").textContent();
  const release = await holdPageCode(page);

  await page.reload({ waitUntil: "commit" });

  await expect(findFinalWinner(page)).toContainText("Liberty");
  await expect(page.locator("#stamp")).toBeVisible();
  await expect(page.locator("#stamp")).toHaveText(stamp);
  await page.clock.runFor(4000);
  await expect(page.locator("#loadNote")).toHaveCount(0);
  release();
});

test("a saved part the page doesn't draw whole keeps the markup the page has", async ({ page }) => {
  await storeBeforeLoad(page, {
    lastDrawn: JSON.stringify({ "view-bracket": { markup: "<p>Old</p>", hidden: false } }),
  });

  await openApp(page);

  await expect(findFinalWinner(page)).toContainText("Liberty");
  await expect(page.locator("#view-bracket")).not.toContainText("Old");
});

test("saved markup that can't be read leaves the page to open as it would", async ({ page }) => {
  await storeBeforeLoad(page, { lastDrawn: "{not json", lastTab: "games" });

  await openApp(page);

  await expect(page.locator("#view-games")).toBeVisible();
});
