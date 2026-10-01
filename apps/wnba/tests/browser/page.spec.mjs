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
  await expect(row.locator(".clock")).toHaveText("Q2 5:10");
  await expect(row.locator(".score")).toHaveText(/30\s*27/);
  await expect(row.locator(".side.home .bonus")).toHaveText("Bonus");
});

const readBackground = (page) =>
  page.evaluate(() => getComputedStyle(document.body).backgroundColor);
const MAPLE = "rgb(233, 212, 176)";
const WALNUT = "rgb(29, 21, 17)";

/**
 * @param {import("@playwright/test").Page} page
 * @param {"light" | "dark"} theme
 */
async function expectTheme(page, theme) {
  const isDark = theme === "dark";
  await expect.poll(() => readBackground(page)).toBe(isDark ? WALNUT : MAPLE);
  await expect(page.locator("#homeScreenIcon")).toHaveAttribute(
    "href",
    isDark ? "icon-180.png" : "icon-light-180.png",
  );
  await expect(page.locator("#tabIcon")).toHaveAttribute(
    "href",
    isDark ? "icon.svg" : "icon-light.svg",
  );
  await expect(page.locator("#themeColor")).toHaveAttribute(
    "content",
    isDark ? "#1d1511" : "#e9d4b0",
  );
  // The select's down arrow is drawn in the theme's dim ink.
  const arrow = await page
    .locator("#appearanceSel")
    .evaluate((select) => getComputedStyle(select).backgroundImage);
  expect(arrow).toContain(isDark ? "b19a86" : "6f563c");
}

/**
 * @param {import("@playwright/test").Page} page
 * @param {string} choice
 */
async function chooseAppearance(page, choice) {
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByRole("combobox", { name: "Appearance" }).selectOption({ label: choice });
  await page.keyboard.press("Escape");
}

test("on Automatic, the page and its icons follow the phone's dark or light setting", async ({
  page,
}) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await openApp(page);
  await expect(page.locator("#appearanceSel")).toHaveValue("auto");
  await expectTheme(page, "dark");
  await page.emulateMedia({ colorScheme: "light" });
  await expectTheme(page, "light");
});

test("choosing Walnut or Maple overrides the phone, and the choice stays after a reload", async ({
  page,
}) => {
  await page.emulateMedia({ colorScheme: "light" });
  await openApp(page);
  await chooseAppearance(page, "Walnut");
  await expectTheme(page, "dark");
  await page.reload();
  expect(await page.evaluate(() => document.documentElement.dataset.theme)).toBe("dark");
  await expectTheme(page, "dark");

  await page.emulateMedia({ colorScheme: "dark" });
  await chooseAppearance(page, "Maple");
  await expectTheme(page, "light");
  await chooseAppearance(page, "Automatic");
  await expectTheme(page, "dark");
});

test("changing the appearance says how to match the home-screen icon", async ({ page }) => {
  await openApp(page);
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  const note = page.locator("#appearanceNote");
  await expect(note).toBeHidden();
  await page.getByRole("combobox", { name: "Appearance" }).selectOption({ label: "Walnut" });
  await expect(note).toBeVisible();
  await expect(note).toHaveText(/Apple sets a home-screen icon only when the page is added/);
});

test("the page serves both themes' icons", async ({ page }) => {
  await openApp(page);
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
