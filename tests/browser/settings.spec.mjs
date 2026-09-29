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

  await chooseSeason(page, "2026");
  await expect(yearTag).toBeHidden();
});

test("under the title, settings name the release and when it came out, in the viewer's time", async ({
  page,
}) => {
  await serveRelease(page, RELEASE);
  await openApp(page);
  await openSettings(page);

  const version = page.locator("#versionNote");
  await expect(version).toHaveText("v81\u2022Released Sep 27, 8:10 PM");
  await expect(version).toHaveAttribute("title", "Commit abc1234");
  const title = await page.locator("#settingsTitle").boundingBox();
  expect((await version.boundingBox()).y).toBeGreaterThan(title.y + title.height - 1);
});

test("a release from an earlier year names its year", async ({ page }) => {
  await serveRelease(page, { ...RELEASE, builtAt: "2025-10-02T15:00:00Z" });
  await openApp(page);
  await openSettings(page);

  await expect(page.locator("#versionNote")).toHaveText("v81\u2022Released Oct 2, 2025, 11:00 AM");
});

test("a release built outside a pull request names its commit", async ({ page }) => {
  await serveRelease(page, { ...RELEASE, pullRequest: null });
  await openApp(page);
  await openSettings(page);

  await expect(page.locator("#versionNote")).toHaveText(/^abc1234\u2022Released/);
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

const SMALL_PHONE = { width: 375, height: 667 };
const LAPTOP = { width: 1280, height: 800 };
const SEASON_2025 = { year: 2025, teams: {}, series: {}, ranking: [], log: [] };

/** @param {import("@playwright/test").Page} page */
const scrollSettingsToEnd = (page) =>
  page.locator("#settingsDialog").evaluate((dialog) => {
    dialog.scrollTop = dialog.scrollHeight;
  });

/** @param {import("@playwright/test").Page} page */
async function waitForSheetToRise(page) {
  await expect
    .poll(async () => Math.round((await page.locator("#settingsDialog").boundingBox()).y))
    .toBe(44);
}

/** @param {import("@playwright/test").Page} page */
async function expectWholeRankingInView(page) {
  const sheet = await page.locator("#settingsDialog").boundingBox();
  const header = await page.locator(".sheet-top").boundingBox();
  const first = await page.locator("#rankList .rank-item").first().boundingBox();
  const last = await page.locator("#rankList .rank-item").last().boundingBox();
  expect(first.y).toBeGreaterThanOrEqual(header.y + header.height - 1);
  expect(last.y + last.height).toBeLessThanOrEqual(sheet.y + sheet.height + 1);
}

/** @param {import("@playwright/test").Locator} locator */
const readCenters = (locator) =>
  locator.evaluateAll((elements) =>
    elements.map((element) => {
      const box = element.getBoundingClientRect();
      return box.top + box.height / 2;
    }),
  );

test("the ranking has no tab of its own; settings hold it, numbered 1 to 12", async ({ page }) => {
  await openApp(page);
  const tabs = page.getByRole("tablist", { name: "Views" }).getByRole("tab");
  await expect(tabs).toHaveText(["Bracket", "Games", "Standings", "Teams"]);

  await openSettings(page);
  const settings = page.getByRole("dialog", { name: "Settings" });
  await expect(settings.getByRole("heading", { name: "Ranking" })).toBeVisible();
  await expect(settings).toContainText("Who you want to win the World Series, first to last.");
  await expect(settings.locator("#rankList .rank-item")).toHaveCount(12);
  await expect(settings.locator("#rankNumbers li")).toHaveText(
    Array.from({ length: 12 }, (_, index) => String(index + 1)),
  );
  await expect(settings.locator("#rankList .status-chip").first()).toHaveText("Alive");
});

test("a page last left on the old Ranking tab opens on the bracket", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("lastTab", "ranking"));
  await openApp(page);

  await expect(page.getByRole("tab", { name: "Bracket" })).toHaveAttribute("aria-selected", "true");
  await expect(page.locator("#view-bracket")).toBeVisible();
});

test("on a phone, scrolling settings down shows the whole ranking under the pinned header", async ({
  page,
}) => {
  await page.setViewportSize(PHONE);
  await openApp(page);
  await openSettings(page);
  await waitForSheetToRise(page);
  const settings = page.getByRole("dialog", { name: "Settings" });
  await expect(settings.getByRole("combobox", { name: "Season" })).toBeInViewport();

  await scrollSettingsToEnd(page);

  await expectWholeRankingInView(page);
  await expect(settings.getByRole("button", { name: "Done" })).toBeInViewport();
  await expect(settings.locator(".ranking-note")).toBeVisible();
  await expect(settings.locator("#rankList .rank-ws").first()).toBeVisible();
});

test("on a short phone, the ranking's note gives way so each row keeps both lines", async ({
  page,
}) => {
  await page.setViewportSize(SMALL_PHONE);
  await openApp(page);
  await openSettings(page);
  await waitForSheetToRise(page);

  await scrollSettingsToEnd(page);

  await expectWholeRankingInView(page);
  await expect(page.locator(".ranking-note")).toBeHidden();
  await expect(page.locator("#rankList .rank-ws").first()).toBeVisible();
});

test("settings open at the top again after scrolling down to the ranking", async ({ page }) => {
  await page.setViewportSize(PHONE);
  await openApp(page);
  await openSettings(page);
  await scrollSettingsToEnd(page);
  await page.getByRole("button", { name: "Done" }).click();

  await openSettings(page);

  await expect
    .poll(() => page.locator("#settingsDialog").evaluate((dialog) => dialog.scrollTop))
    .toBe(0);
});

test("each rank number stays level with its row", async ({ page }) => {
  await page.setViewportSize(PHONE);
  await openApp(page);
  await openSettings(page);
  await waitForSheetToRise(page);
  await scrollSettingsToEnd(page);

  const numbers = await readCenters(page.locator("#rankNumbers li"));
  const rows = await readCenters(page.locator("#rankList .rank-item"));

  expect(numbers).toHaveLength(12);
  numbers.forEach((center, index) => expect(Math.abs(center - rows[index])).toBeLessThan(1));
});

test("on a wide screen, the settings and the whole ranking show side by side without scrolling", async ({
  page,
}) => {
  await page.setViewportSize(LAPTOP);
  await openApp(page);
  await openSettings(page);

  const dialog = page.locator("#settingsDialog");
  expect(await dialog.evaluate((element) => element.scrollHeight <= element.clientHeight)).toBe(
    true,
  );
  await expectWholeRankingInView(page);
  const controls = await page.locator(".settings-controls").boundingBox();
  const list = await page.locator("#rankList").boundingBox();
  expect(controls.x + controls.width).toBeLessThan(list.x);
  expect(Math.abs(controls.y - list.y)).toBeLessThan(1);
});

test("a club that's out looks like the rest, and its chip just says Out", async ({ page }) => {
  await openApp(page, { store: { "seasons/2025": SEASON_2025 } });
  await chooseSeason(page, "2025");
  await openSettings(page);

  const chips = await page.locator("#rankList .status-chip").allTextContents();
  expect(chips).toHaveLength(12);
  expect(chips.filter((chip) => chip === "Champs")).toHaveLength(1);
  expect(chips.filter((chip) => chip === "Out")).toHaveLength(11);
  const nameColors = await page
    .locator("#rankList .team-name")
    .evaluateAll((names) => names.map((name) => getComputedStyle(name).color));
  expect(new Set(nameColors).size).toBe(1);
});
