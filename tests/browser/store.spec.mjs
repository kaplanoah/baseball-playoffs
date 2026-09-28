import { test, expect, openApp } from "./harness.mjs";

test("the page saves to the Worker's store, and loads from it", async ({ page }) => {
  const app = await openApp(page);
  await page.getByRole("tab", { name: "Ranking" }).click();
  await expect(page.locator("#rankList .rank-item")).toHaveCount(12);
  const firstItem = page.locator("#rankList .rank-item").first();
  const movedClubId = await firstItem.getAttribute("data-id");
  await firstItem.locator(".grip").focus();
  await page.keyboard.press("ArrowDown");

  await expect
    .poll(async () => (await app.readDocument("seasons/2026"))?.ranking[1])
    .toBe(movedClubId);

  await page.reload();
  await page.getByRole("tab", { name: "Ranking" }).click();
  await expect(page.locator("#rankList .rank-item").nth(1)).toHaveAttribute("data-id", movedClubId);
});

const listShownRanking = (page) =>
  page
    .locator("#rankList .rank-item")
    .evaluateAll((items) => items.map((item) => /** @type {HTMLElement} */ (item).dataset.id));

test("a change from another device shows up without a reload", async ({ page }) => {
  const app = await openApp(page);
  await app.updateFromWorker();
  await expect.poll(() => app.countOpenSockets()).toBeGreaterThan(0);
  await page.getByRole("tab", { name: "Ranking" }).click();

  const season = await app.readDocument("seasons/2026");
  const reversed = (await listShownRanking(page)).reverse();
  await app.writeFromAnotherDevice("seasons/2026", { ...season, ranking: reversed });

  await expect(page.locator("#rankList .rank-item").first()).toHaveAttribute(
    "data-id",
    reversed[0],
  );
});

test("a change from another device leaves keyboard focus on the club it was on", async ({
  page,
}) => {
  const app = await openApp(page);
  await app.updateFromWorker();
  await expect.poll(() => app.countOpenSockets()).toBeGreaterThan(0);
  await page.getByRole("tab", { name: "Ranking" }).click();
  const grip = page.locator("#rankList .rank-item").nth(2).locator(".grip");
  await grip.focus();

  const season = await app.readDocument("seasons/2026");
  const shown = await listShownRanking(page);
  const reversed = [...shown].reverse();
  const focusedId = shown[2];
  await app.writeFromAnotherDevice("seasons/2026", { ...season, ranking: reversed });

  await expect(page.locator("#rankList .rank-item").first()).toHaveAttribute(
    "data-id",
    reversed[0],
  );
  await expect(page.locator(`#rankList .rank-item[data-id="${focusedId}"] .grip`)).toBeFocused();
});

test("a page that loses its connection catches up when it reconnects", async ({ page }) => {
  const app = await openApp(page);
  await app.updateFromWorker();
  await expect.poll(() => app.countOpenSockets()).toBe(1);
  await page.getByRole("tab", { name: "Ranking" }).click();

  await app.dropConnections();
  const season = await app.readDocument("seasons/2026");
  const reversed = [...season.ranking].reverse();
  await app.writeFromAnotherDevice("seasons/2026", { ...season, ranking: reversed });
  await page.clock.runFor(2000);
  await expect(page.locator("#rankList .rank-item").first()).toHaveAttribute(
    "data-id",
    reversed[0],
  );
  await expect.poll(() => app.countOpenSockets()).toBe(1);
});

test("a store answer the page can't read stops saving instead of showing an empty season", async ({
  page,
}) => {
  await openApp(page, { portalReadsDocuments: true });
  await expect(page.locator("#stamp")).toContainText("Couldn't load your saved data");
});
