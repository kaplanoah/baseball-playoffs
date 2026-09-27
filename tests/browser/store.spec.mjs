import { test, expect, openApp, buildFixtureSnapshot, EVENING_FIXTURE } from "./harness.mjs";
import { createReading } from "../../page/js/readings.js";

test("the page saves to the Worker's store, and loads from it", async ({ page }) => {
  const app = await openApp(page);
  await expect.poll(() => app.readDocument("live/status")).toMatchObject({ error: "", write: "" });
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
  const app = await openApp(page);
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
  const app = await openApp(page);
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

test("readings older than two weeks go, and their updates stay in the saved log", async ({
  page,
}) => {
  const reading = createReading(buildFixtureSnapshot(EVENING_FIXTURE));
  const oldStart = {
    ...reading,
    at: "2026-09-01T20:00:00Z",
    rows: { ...reading.rows, BAL: { ...reading.rows.BAL, wce: "1" } },
    games: {},
  };
  const elimination = { at: "2026-09-01T23:00:00Z", rows: { BAL: { wce: reading.rows.BAL.wce } } };
  const lastStart = { ...reading, at: elimination.at, games: {} };
  const app = await openApp(page, {
    store: {
      "readings-2026/2026-09-01-01": {
        id: "2026-09-01-01",
        day: "2026-09-01",
        number: 1,
        start: oldStart,
        changes: [elimination],
      },
      "readings-2026/2026-09-20-01": {
        id: "2026-09-20-01",
        day: "2026-09-20",
        number: 1,
        start: lastStart,
        changes: [],
      },
    },
  });

  await expect.poll(() => app.readDocument("readings-2026/2026-09-01-01")).toBeNull();
  const season = await app.readDocument("seasons/2026");
  expect(season.log.map((entry) => [entry.kind, entry.team, entry.at])).toEqual([
    ["elim", "BAL", "2026-09-01T23:00:00Z"],
  ]);
  expect(await app.readDocument("readings-2026/2026-09-20-01")).not.toBeNull();
  await expect(page.locator("#updates")).toContainText("Orioles eliminated");
  expect(await app.readDocument("live/status")).toMatchObject({ error: "", write: "" });
});
