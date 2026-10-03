import { test, expect, openApp } from "./harness.mjs";
import { holdRequests } from "../../../../tests/browser/hold-requests.mjs";

test.use({ contextOptions: { reducedMotion: "reduce" } });

const MINUTE_MS = 60 * 1000;

/** @param {import("@playwright/test").Page} page */
const findLiveLine = (page) => page.locator("#stamp").getByText("Reds @ Braves");

test("a reload keeps the live scores it last showed while the store sends them again", async ({
  page,
}) => {
  await openApp(page);
  await expect(findLiveLine(page)).toBeVisible();
  const release = await holdRequests(page, (url) => url.pathname.endsWith("/store/live/2026"));

  await page.reload();
  await expect(page.locator("#bracketWrap .matchup-row")).toHaveCount(22);
  await page.clock.runFor(MINUTE_MS);

  await expect(findLiveLine(page)).toBeVisible();
  release();
});
