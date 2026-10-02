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

test("a computer shows no Updates box", async ({ page }) => {
  await openApp(page, { isShowingUpdates: true });
  await expect(page.locator(".series").first()).toBeVisible();

  await expect(page.locator("#updates")).toBeHidden();
});
