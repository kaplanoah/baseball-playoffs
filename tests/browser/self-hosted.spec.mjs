import { test, expect, openSelfHostedApp } from "./harness.mjs";

test("the self-hosted page saves to the Worker's store, and loads from it", async ({ page }) => {
  const app = await openSelfHostedApp(page);
  await expect
    .poll(() => app.readDocument("live/status"))
    .toMatchObject({ source: "worker", error: "", write: "" });
  const season = await app.readDocument("seasons/2026");
  expect(Object.keys(season.teams)).toHaveLength(12);
  expect(await app.readDocument("standings/2026")).toHaveProperty("divisions");

  await page.getByRole("tab", { name: "Ranking" }).click();
  const firstItem = page.locator("#rankList .rank-item").first();
  const movedClubId = await firstItem.getAttribute("data-id");
  await firstItem.locator(".grip").focus();
  await page.keyboard.press("ArrowDown");

  await expect
    .poll(async () => (await app.readDocument("seasons/2026")).ranking[1])
    .toBe(movedClubId);

  await page.reload();
  await page.getByRole("tab", { name: "Ranking" }).click();
  await expect(page.locator("#rankList .rank-item").nth(1)).toHaveAttribute("data-id", movedClubId);
});

test("a change from another device shows up without a reload", async ({ page }) => {
  const app = await openSelfHostedApp(page);
  await expect.poll(() => app.readDocument("live/status")).toMatchObject({ error: "" });
  await expect.poll(() => app.countOpenSockets()).toBeGreaterThan(0);
  await page.getByRole("tab", { name: "Ranking" }).click();

  const season = await app.readDocument("seasons/2026");
  const reversed = [...season.ranking].reverse();
  await app.writeFromAnotherDevice("seasons/2026", { ...season, ranking: reversed });

  await expect(page.locator("#rankList .rank-item").first()).toHaveAttribute(
    "data-id",
    reversed[0],
  );
});

test("a page that loses its connection catches up when it reconnects", async ({ page }) => {
  const app = await openSelfHostedApp(page);
  await expect.poll(() => app.readDocument("live/status")).toMatchObject({ error: "" });
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
