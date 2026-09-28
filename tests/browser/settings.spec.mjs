import { test, expect, openApp, openSettings, chooseSeason } from "./harness.mjs";

const PHONE = { width: 390, height: 844 };
const RELEASE = { commit: "abc1234", pullRequest: 81, builtAt: "2026-09-28T00:10:41Z" };

/** @param {import("@playwright/test").Page} page */
const serveRelease = (page, release) =>
  page.route(
    (url) => url.pathname === "/version.json",
    (route) => route.fulfill({ json: release }),
  );

test("the sliders button opens settings, and Done, Escape, or the backdrop closes it", async ({
  page,
}) => {
  await openApp(page);
  const settings = page.getByRole("dialog", { name: "Settings" });
  await expect(settings).toBeHidden();

  await openSettings(page);
  await expect(settings).toBeVisible();
  await expect(settings.getByRole("combobox", { name: "Season" })).toHaveValue("2026");
  await expect(settings).toContainText("This season, updated live.");
  await settings.getByRole("button", { name: "Done" }).click();
  await expect(settings).toBeHidden();

  await openSettings(page);
  await page.keyboard.press("Escape");
  await expect(settings).toBeHidden();

  await openSettings(page);
  await page.mouse.click(5, 5);
  await expect(settings).toBeHidden();
});

test("the sliders icon takes the stamp's time color and brightens on hover", async ({ page }) => {
  await openApp(page);
  const button = page.getByRole("button", { name: "Settings", exact: true });
  const timeColor = await page
    .locator("#stamp b")
    .first()
    .evaluate((time) => getComputedStyle(time).color);

  await expect(button).toHaveCSS("color", timeColor);
  await button.hover();
  await expect(button).toHaveCSS("color", "rgb(241, 234, 212)");
});

test("the sliders icon sits close to the stamp", async ({ page }) => {
  await openApp(page);
  await expect(page.locator("#stamp")).toBeVisible();

  const stamp = await page.locator("#stamp").boundingBox();
  const icon = await page.locator("#settingsBtn svg").boundingBox();
  const gap = icon.x - (stamp.x + stamp.width);
  expect(gap).toBeGreaterThanOrEqual(12);
  expect(gap).toBeLessThanOrEqual(18);
});

test("on a narrow phone, the icon keeps its distance from the title's year", async ({ page }) => {
  await openApp(page, {
    store: { "seasons/2025": { year: 2025, teams: {}, series: {}, ranking: [], log: [] } },
  });
  await chooseSeason(page, "2025");

  for (const width of [320, 310, 300, 295]) {
    await page.setViewportSize({ width, height: PHONE.height });
    const tag = await page.locator("#yearTag").boundingBox();
    const icon = await page.locator("#settingsBtn svg").boundingBox();
    const isBesideTag = icon.y < tag.y + tag.height;
    if (isBesideTag) expect(icon.x - (tag.x + tag.width)).toBeGreaterThanOrEqual(20);
  }
});

test("a click inside settings leaves it open", async ({ page }) => {
  await openApp(page);
  await openSettings(page);
  const settings = page.getByRole("dialog", { name: "Settings" });

  await settings.getByRole("heading", { name: "Settings" }).click();

  await expect(settings).toBeVisible();
});

test("an earlier season shows its year by the title until the current one is back", async ({
  page,
}) => {
  await openApp(page, {
    store: { "seasons/2025": { year: 2025, teams: {}, series: {}, ranking: [], log: [] } },
  });
  const yearTag = page.locator("#yearTag");
  await expect(yearTag).toBeHidden();

  await chooseSeason(page, "2025");
  await expect(yearTag).toHaveText("2025");
  await expect(page.locator("#seasonNote")).toHaveText("A finished season.");

  await chooseSeason(page, "2026");
  await expect(yearTag).toBeHidden();
});

test("settings name the deployed version, in the viewer's time", async ({ page }) => {
  await serveRelease(page, RELEASE);
  await openApp(page);
  await openSettings(page);

  const version = page.locator("#versionNote");
  await expect(version).toContainText("Version #81 · abc1234");
  await expect(version).toContainText("Deployed Sep 27, 2026, 8:10 PM");
});

test("a version built outside a pull request names only its commit", async ({ page }) => {
  await serveRelease(page, { ...RELEASE, pullRequest: null });
  await openApp(page);
  await openSettings(page);

  await expect(page.locator("#versionNote")).toContainText(/^Version abc1234/);
});

test("without a version file, settings leave the version out", async ({ page }) => {
  await openApp(page);
  await openSettings(page);

  await expect(page.getByRole("dialog", { name: "Settings" })).toBeVisible();
  await expect(page.locator("#versionNote")).toBeHidden();
});

test("on a phone, settings rise from the bottom as a sheet", async ({ page }) => {
  await page.setViewportSize(PHONE);
  await openApp(page);
  await openSettings(page);

  const settings = page.getByRole("dialog", { name: "Settings" });
  await expect(settings.locator(".settings-done svg")).toBeHidden();
  expect((await page.getByText("Done", { exact: true }).boundingBox()).width).toBeGreaterThan(20);
  await expect
    .poll(async () => {
      const box = await settings.boundingBox();
      return box && { left: box.x, width: box.width, bottom: Math.round(box.y + box.height) };
    })
    .toEqual({ left: 0, width: PHONE.width, bottom: PHONE.height });
});

test("on a wide screen, settings open as a modal with a close button", async ({ page }) => {
  await openApp(page);
  await openSettings(page);

  const settings = page.getByRole("dialog", { name: "Settings" });
  await expect(settings.locator(".settings-done svg")).toBeVisible();
  expect((await page.getByText("Done", { exact: true }).boundingBox()).width).toBeLessThanOrEqual(
    1,
  );
  const box = await settings.boundingBox();
  const { width } = page.viewportSize();
  expect(Math.abs(box.x + box.width / 2 - width / 2)).toBeLessThan(2);
});
