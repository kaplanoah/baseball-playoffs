import { test, expect, openApp } from "./harness.mjs";

test("the page opens on the bracket the Worker saved, and each tab shows its view", async ({
  page,
}) => {
  await openApp(page);
  await expect(page.locator('[data-series="1-0"]')).toContainText("Liberty win 2-0");
  await expect(page.locator("#yearTag")).toHaveText("2026");
  await expect(page.locator("#stamp")).toHaveText(/^Updated 5:55\sPM$/);

  await page.getByRole("tab", { name: "Games" }).click();
  await expect(page.locator("#gamesWrap .game-row").first()).toContainText("7:00");
  await page.getByRole("tab", { name: "Standings" }).click();
  await expect(page.locator("#standingsWrap tr.cut")).toContainText("Fire");
  await page.getByRole("tab", { name: "Teams" }).click();
  await expect(page.locator("#teamsWrap .team-row").first()).toContainText("Minnesota Lynx");
});

test("a score the Worker saves shows up without a reload", async ({ page }) => {
  const app = await openApp(page);
  await page.getByRole("tab", { name: "Games" }).click();
  await app.changeSeason((season) => {
    const game = season.games.find((each) => each.id === "1042600132");
    Object.assign(game, { state: "live", status: "Q2 5:10", period: 2, clock: "5:10" });
    Object.assign(game.away, { score: 30 });
    Object.assign(game.home, { score: 27, isInBonus: true });
    return season;
  });
  const row = page.locator('[data-game="1042600132"]');
  await expect(row.locator(".game-status .clock")).toHaveText("Q2 5:10");
  await expect(row.locator(".game-headline .score")).toHaveText(/30\s*27/);
  await expect(row.locator(".game-extra.home .bonus")).toHaveText("Bonus");
  await expect(row.locator(".game-extra.away")).toBeEmpty();
});

test("a team stays put as Bonus comes and goes, level with the score", async ({ page }) => {
  const app = await openApp(page);
  await page.getByRole("tab", { name: "Games" }).click();
  const row = page.locator('[data-game="1042600132"]');
  const findCenter = async (locator) => {
    const box = await locator.boundingBox();
    return box.y + box.height / 2;
  };
  const readTeamCenters = () =>
    Promise.all(
      [".game-side.away", ".game-side.home"].map((side) => findCenter(row.locator(side))),
    );
  const goLive = (isInBonus) =>
    app.changeSeason((season) => {
      const game = season.games.find((each) => each.id === "1042600132");
      Object.assign(game, { state: "live", status: "Q2 5:10", period: 2, clock: "5:10" });
      Object.assign(game.away, { score: 30 });
      Object.assign(game.home, { score: 27, isInBonus });
      return season;
    });

  const before = await readTeamCenters();
  await goLive(true);
  await expect(row.locator(".bonus")).toHaveText("Bonus");
  expect(await readTeamCenters()).toEqual(before);
  await goLive(false);
  await expect(row.locator(".bonus")).toHaveCount(0);
  expect(await readTeamCenters()).toEqual(before);
  expect(Math.abs(before[0] - (await findCenter(row.locator(".score"))))).toBeLessThan(1);
});

test("the page follows the phone's dark or light setting", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await openApp(page);
  const readBackground = () => page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  expect(await readBackground()).toBe("rgb(29, 21, 17)");
  await page.emulateMedia({ colorScheme: "light" });
  expect(await readBackground()).toBe("rgb(233, 212, 176)");
});

test("the page offers a maple icon in light mode and a walnut one in dark mode", async ({
  page,
}) => {
  await page.emulateMedia({ colorScheme: "light" });
  await openApp(page);
  const homeScreenIcon = page.locator("#homeScreenIcon");
  await expect(homeScreenIcon).toHaveAttribute("href", "icon-light-180.png");
  await page.emulateMedia({ colorScheme: "dark" });
  await expect(homeScreenIcon).toHaveAttribute("href", "icon-180.png");
  for (const href of ["icon-180.png", "icon-light-180.png", "icon.svg", "icon-light.svg"]) {
    const answer = await page.request.get(href);
    expect(answer.ok(), href).toBe(true);
  }
});

test("the home screen names the app WNBA", async ({ page }) => {
  await openApp(page);
  await expect(page.locator('meta[name="apple-mobile-web-app-title"]')).toHaveAttribute(
    "content",
    "WNBA",
  );
  const manifest = await (await page.request.get("manifest.webmanifest")).json();
  expect(manifest.short_name).toBe("WNBA");
});

test("the page uses its own fonts, served with it", async ({ page }) => {
  await openApp(page);
  // The bracket's wins are the first text in Barlow Condensed, so its font loads once they show.
  await expect(page.locator('[data-series="1-0"] .wins').first()).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  const loaded = await page.evaluate(() =>
    [...document.fonts].filter((font) => font.status === "loaded").map((font) => font.family),
  );
  expect(loaded).toEqual(expect.arrayContaining(["Saira Condensed", "Barlow Condensed", "Barlow"]));
});

test.describe("on a phone", () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  test("the tab bar floats at the bottom, and the page doesn't scroll sideways", async ({
    page,
  }) => {
    await openApp(page);
    const bar = await page.locator("#tabBar").boundingBox();
    expect(bar.y + bar.height).toBeGreaterThan(844 - 40);
    for (const tab of ["Bracket", "Games", "Standings", "Teams"]) {
      await page.getByRole("tab", { name: tab }).click();
      const width = await page.evaluate(() => document.documentElement.scrollWidth);
      expect(width, tab).toBeLessThanOrEqual(390);
    }
  });
});
