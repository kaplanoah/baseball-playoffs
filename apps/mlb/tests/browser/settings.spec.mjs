import { test, expect, openApp, openSettings, chooseSeason, swipeSheetDown } from "./harness.mjs";

const PHONE = { width: 390, height: 844 };
const RELEASE = { version: "2.13.0", commit: "abc1234", builtAt: "2026-09-28T00:10:41Z" };

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
  const timeColor = await page.locator("#stamp").evaluate((stamp) => {
    const time = document.createElement("b");
    stamp.append(time);
    const color = getComputedStyle(time).color;
    time.remove();
    return color;
  });

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

test("at their foot, settings name the release and when it came out, in the viewer's time, over the copyright", async ({
  page,
}) => {
  await serveRelease(page, RELEASE);
  await openApp(page);
  await openSettings(page);

  const version = page.locator("#versionNote");
  await expect(version).toHaveText("v2.13.0\u2022Released Sep 27, 8:10 PM");
  await expect(version).toHaveAttribute("title", "Commit abc1234");
  await expect(page.locator("#settingsDialog .settings-footer .settings-version")).toHaveText([
    "v2.13.0\u2022Released Sep 27, 8:10 PM",
    "\u00a9 2026 Noah Kaplan",
  ]);
  await expect(page.locator("#settingsDialog .sheet-top")).not.toContainText("Released");
});

test("a release from an earlier year names its year", async ({ page }) => {
  await serveRelease(page, { ...RELEASE, builtAt: "2025-10-02T15:00:00Z" });
  await openApp(page);
  await openSettings(page);

  await expect(page.locator("#versionNote")).toHaveText(
    "v2.13.0\u2022Released Oct 2, 2025, 11:00 AM",
  );
});

test("a release without a version names its commit", async ({ page }) => {
  await serveRelease(page, { ...RELEASE, version: null });
  await openApp(page);
  await openSettings(page);

  await expect(page.locator("#versionNote")).toHaveText(/^abc1234\u2022Released/);
});

test("on a wide screen, settings end at the bottom left, level with the ranking's end", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.setViewportSize({ width: 1280, height: 900 });
  await serveRelease(page, RELEASE);
  await openApp(page);
  await openSettings(page);

  const footer = page.locator("#settingsDialog .settings-footer");
  await expect(footer).toHaveCSS("text-align", "left");
  const [box, controls, ranking] = await Promise.all(
    [footer, page.locator(".settings-controls"), page.locator(".rank-frame")].map((each) =>
      each.boundingBox(),
    ),
  );
  expect(Math.abs(box.x - controls.x)).toBeLessThan(1);
  expect(box.x + box.width).toBeLessThanOrEqual(ranking.x);
  expect(Math.abs(box.y + box.height - (ranking.y + ranking.height))).toBeLessThan(1);
});

test("on a phone, settings end with the copyright, centered under the ranking", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.setViewportSize(PHONE);
  await openApp(page);
  await openSettings(page);

  const footer = page.locator("#settingsDialog .settings-body > :last-child");
  await expect(footer).toHaveText("\u00a9 2026 Noah Kaplan");
  await expect(footer).toHaveCSS("text-align", "center");
  const [ranking, copyright] = await Promise.all(
    [page.locator(".rank-frame"), footer].map((each) => each.boundingBox()),
  );
  expect(copyright.y).toBeGreaterThan(ranking.y + ranking.height);
});

test("a release the Worker no longer has, named only by its commit, leaves the version out", async ({
  page,
}) => {
  await serveRelease(page, { version: null, commit: "abc1234", builtAt: null });
  await openApp(page);
  await openSettings(page);

  await expect(page.getByRole("dialog", { name: "Settings" })).toBeVisible();
  await expect(page.locator("#versionNote")).toBeHidden();
});

test("without a version file, settings leave the version out", async ({ page }) => {
  await openApp(page);
  await openSettings(page);

  await expect(page.getByRole("dialog", { name: "Settings" })).toBeVisible();
  await expect(page.locator("#versionNote")).toBeHidden();
});

test("on a phone, settings rise from the bottom as a sheet with a wide grabber and no Done button", async ({
  page,
}) => {
  await page.setViewportSize(PHONE);
  await openApp(page);
  await openSettings(page);
  await waitForSheetToRise(page);

  const settings = page.getByRole("dialog", { name: "Settings" });
  const done = settings.getByRole("button", { name: "Done" });
  await expect(done).toHaveCount(1);
  expect((await done.boundingBox()).width).toBeLessThanOrEqual(1);
  const grabber = await settings.locator(".sheet-grabber").boundingBox();
  const title = await settings.getByRole("heading", { name: "Settings" }).boundingBox();
  expect(grabber.width).toBe(48);
  expect(title.y - (grabber.y + grabber.height)).toBe(12);
  await expect
    .poll(async () => {
      const box = await settings.boundingBox();
      return box && { left: box.x, width: box.width, bottom: Math.round(box.y + box.height) };
    })
    .toEqual({ left: 0, width: PHONE.width, bottom: PHONE.height });
});

const readSheetTop = (page) =>
  page.locator("#settingsDialog").evaluate((dialog) => dialog.getBoundingClientRect().top);

test("on a phone, settings rise only when the viewer allows motion", async ({ page }) => {
  await page.setViewportSize(PHONE);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await openApp(page);
  await openSettings(page);
  const settings = page.getByRole("dialog", { name: "Settings" });
  await expect(settings).toHaveCSS("animation-name", "none");

  await settings.press("Escape");
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await openSettings(page);
  await expect(settings).toHaveCSS("animation-name", "sheet-rise");
});

test("on a phone, a slow swipe down far enough closes settings, and a short one springs back", async ({
  page,
}) => {
  await page.setViewportSize(PHONE);
  await openApp(page);
  await openSettings(page);
  await waitForSheetToRise(page);
  const settings = page.getByRole("dialog", { name: "Settings" });

  await swipeSheetDown(page, { target: ".sheet-top", distance: 60, steps: 6, stepMs: 60 });
  await expect(settings).toBeVisible();
  await expect.poll(() => readSheetTop(page)).toBe(44);

  await swipeSheetDown(page, {
    target: ".settings-controls",
    distance: 200,
    steps: 10,
    stepMs: 60,
  });
  await expect(settings).toBeHidden();

  await openSettings(page);
  await expect.poll(() => readSheetTop(page)).toBe(44);
});

test("on a phone, a quick flick down closes settings, and a cancelled swipe springs back", async ({
  page,
}) => {
  await page.setViewportSize(PHONE);
  await openApp(page);
  await openSettings(page);
  await waitForSheetToRise(page);
  const settings = page.getByRole("dialog", { name: "Settings" });

  await swipeSheetDown(page, {
    target: ".sheet-top",
    distance: 200,
    steps: 10,
    stepMs: 20,
    isCancelled: true,
  });
  await expect(settings).toBeVisible();
  await expect.poll(() => readSheetTop(page)).toBe(44);

  await swipeSheetDown(page, { target: ".sheet-top", distance: 70, steps: 2, stepMs: 20 });
  await expect(settings).toBeHidden();
});

test("on a phone, a swipe down scrolled into the ranking or on a grip leaves settings open", async ({
  page,
}) => {
  await page.setViewportSize(PHONE);
  await openApp(page);
  await openSettings(page);
  await waitForSheetToRise(page);
  const settings = page.getByRole("dialog", { name: "Settings" });

  await swipeSheetDown(page, { target: "#rankList .grip", distance: 200, steps: 10, stepMs: 30 });
  await expect(settings).toBeVisible();
  expect(await readSheetTop(page)).toBe(44);

  await scrollSettingsToEnd(page);
  await swipeSheetDown(page, { target: ".sheet-top", distance: 200, steps: 10, stepMs: 30 });
  await expect(settings).toBeVisible();
  expect(await readSheetTop(page)).toBe(44);
});

test("on a wide screen, settings open as a modal with a close button", async ({ page }) => {
  await openApp(page);
  await openSettings(page);

  const settings = page.getByRole("dialog", { name: "Settings" });
  await expect(settings.locator(".sheet-done svg")).toBeVisible();
  expect(
    (await settings.getByText("Done", { exact: true }).boundingBox()).width,
  ).toBeLessThanOrEqual(1);
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
  const header = await page.locator("#settingsDialog .sheet-top").boundingBox();
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
  await expect(tabs).toHaveText(["Bracket", "Games", "Standings"]);

  await openSettings(page);
  const settings = page.getByRole("dialog", { name: "Settings" });
  await expect(settings.getByRole("heading", { name: "Ranking" })).toBeVisible();
  await expect(settings.locator(".ranking-note")).toHaveText(
    "Who you want to win the World Series.",
  );
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
  await expect(settings.getByRole("heading", { name: "Settings" })).toBeInViewport();
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
  await page.keyboard.press("Escape");

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
});

test("on a wide screen, settings run the screen's height, short of its top and bottom", async ({
  page,
}) => {
  await page.setViewportSize(LAPTOP);
  await openApp(page);
  await openSettings(page);

  const box = await page.locator("#settingsDialog").boundingBox();
  expect(box.y).toBe(24);
  expect(box.y + box.height).toBe(LAPTOP.height - 24);
});

test("on a wide screen, the settings start right under the header, level with the ranking's heading", async ({
  page,
}) => {
  await page.setViewportSize(LAPTOP);
  await openApp(page);
  await openSettings(page);

  const header = await page.locator("#settingsDialog .sheet-top").boundingBox();
  const controls = await page.locator(".settings-controls").boundingBox();
  const [season] = await readCenters(page.locator(".control-row > span").first());
  const [ranking] = await readCenters(page.locator("#rankingTitle"));
  expect(Math.abs(controls.y - (header.y + header.height))).toBeLessThan(1);
  expect(Math.abs(season - ranking)).toBeLessThan(2);
});

test("each ranked club shows its league at the start of its second line", async ({ page }) => {
  await page.setViewportSize(PHONE);
  await openApp(page);
  await openSettings(page);
  await waitForSheetToRise(page);
  await scrollSettingsToEnd(page);

  const rows = page.locator("#rankList .rank-item");
  const leagues = await rows.evaluateAll((items) =>
    items.map((item) => item.querySelector(".league-tag").textContent),
  );
  expect(leagues).toHaveLength(12);
  expect(new Set(leagues)).toEqual(new Set(["AL", "NL"]));

  const first = rows.first();
  const dot = await first.locator(".dot").boundingBox();
  const league = await first.locator(".league-tag").boundingBox();
  const history = await first.locator(".rank-ws").boundingBox();
  expect(league.y).toBeGreaterThan(dot.y + dot.height);
  expect(Math.abs(league.x - dot.x)).toBeLessThan(1);
  expect(history.x).toBeGreaterThan(league.x + league.width);
});

test("a row too short for two lines keeps its league beside the club", async ({ page }) => {
  await page.setViewportSize({ width: 844, height: 390 });
  await openApp(page);
  await openSettings(page);
  await scrollSettingsToEnd(page);

  const first = page.locator("#rankList .rank-item").first();
  await expect(first.locator(".rank-ws")).toBeHidden();
  await expect(first.locator(".rank-drought")).toBeVisible();
  const [name] = await readCenters(first.locator(".team-name"));
  const [league] = await readCenters(first.locator(".league-tag"));
  expect(Math.abs(name - league)).toBeLessThan(2);
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
