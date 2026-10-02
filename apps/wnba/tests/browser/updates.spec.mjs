import { test, expect, openApp } from "./harness.mjs";

test.use({ contextOptions: { reducedMotion: "reduce" } });

/**
 * Dream at Mystics, Game 2, final as the Worker found it.
 * @param {any} season
 */
function finishDreamAtMystics(season) {
  const game = season.games.find((each) => each.id === "1042600132");
  Object.assign(game, { state: "final", status: "Final", end: "2026-10-01T01:10:00Z" });
  Object.assign(game.away, { score: 88 });
  Object.assign(game.home, { score: 80 });
  return season;
}

/**
 * Serves the page a release note in place of the app's own, out an hour before the harness's now.
 * @param {import("@playwright/test").Page} page
 */
const serveReleaseNote = (page) =>
  page.route("**/js/release-notes.js", (route) =>
    route.fulfill({
      contentType: "text/javascript",
      body: 'export const RELEASE_NOTES = [{ at: "2026-09-30T20:55:00Z", text: "Game details now include channels." }];',
    }),
  );

test.describe("on a phone", () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  test("the Updates box opens on the latest day's playoff finals, newest first, until it's dismissed, and then lists only what's new", async ({
    page,
  }) => {
    const app = await openApp(page, { isShowingUpdates: true });
    const updates = page.locator("#updates");

    await expect(updates.locator(".updates-count")).toHaveText("2 updates since yesterday");
    await expect(updates.locator(".what")).toHaveText([
      "Liberty beat the Lynx 87-71 to win the First Round 2\u20130",
      "Fever beat the Aces 99-89 in Game\u00a02\u00a0\u2014 tie the First Round 1\u20131",
    ]);

    await page.getByRole("button", { name: "Dismiss updates" }).click();
    await expect(updates).toBeHidden();
    await page.reload();
    await expect(page.locator(".series").first()).toBeVisible();
    await expect(updates).toBeHidden();

    await app.changeSeason(finishDreamAtMystics);

    await expect(updates.locator(".updates-count")).toHaveText("1 update since earlier today");
    await expect(updates.locator(".what")).toHaveText([
      "Dream beat the Mystics 88-80 to win the First Round 2\u20130",
    ]);
  });
});

test.describe("on a phone, with a release note out", () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  test("the note sits under the finals, headed New in the app, and closes with them", async ({
    page,
  }) => {
    await serveReleaseNote(page);
    await openApp(page, { isShowingUpdates: true });
    const updates = page.locator("#updates");

    await expect(updates.locator(".updates-count")).toHaveText([
      "2 updates since yesterday",
      "New in the app",
    ]);
    await expect(updates.locator(".updates-notes .what")).toHaveText(
      "Game details now include channels.",
    );
    const finals = await updates.locator(".updates-list").first().boundingBox();
    const notes = await updates.locator(".updates-notes").boundingBox();
    expect(notes.y).toBeGreaterThan(finals.y + finals.height);

    await page.getByRole("button", { name: "Dismiss updates" }).click();
    await expect(updates).toBeHidden();
    await page.reload();
    await expect(page.locator(".series").first()).toBeVisible();
    await expect(updates).toBeHidden();
  });
});

test("a computer shows no Updates box", async ({ page }) => {
  await openApp(page, { isShowingUpdates: true });
  await expect(page.locator(".series").first()).toBeVisible();

  await expect(page.locator("#updates")).toBeHidden();
});
