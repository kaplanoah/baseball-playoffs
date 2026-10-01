import { test, expect, openApp } from "./harness.mjs";

test("the page opens on the bracket the Worker saved, and each tab shows its view", async ({
  page,
}) => {
  await openApp(page);
  await expect(page.locator('[data-series="1-0"]')).toContainText("Liberty win 2-0");
  await expect(page.locator("header.top .title-row")).toHaveText("WNBA Playoffs");
  await expect(page.locator("#stamp")).toHaveText(/^Updated 5:55\sPM$/);

  await page.getByRole("tab", { name: "Games" }).click();
  await expect(page.locator("#games-today .game-row").first()).toContainText("7:00");
  await page.getByRole("tab", { name: "Standings" }).click();
  await expect(page.locator("#standingsWrap tr.playoff-line + tr")).toContainText("Fire");
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

test("the Games tab opens on today's games, and its pill moves to the results and the games ahead", async ({
  page,
}) => {
  await openApp(page);
  await page.getByRole("tab", { name: "Games" }).click();
  const today = page.getByRole("tab", { name: "Today" });
  await expect(today).toHaveAttribute("aria-selected", "true");
  await expect(page.locator("#games-today")).toContainText("Dream");

  await page.getByRole("tab", { name: "Previous" }).click();
  await expect(page.getByRole("tab", { name: "Previous" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(page.locator("#games-previous .day-name").first()).toHaveText("Yesterday");
  await expect(page.locator("#games-previous")).toContainText("Final");

  await page.getByRole("tab", { name: "Next" }).click();
  await expect(page.getByRole("tab", { name: "Next" })).toHaveAttribute("aria-selected", "true");
  await expect(page.locator("#games-next")).toContainText("Semis");
  await expect(page.locator("#games-today")).toHaveJSProperty("inert", true);
});

test.describe("on a phone, the Games lists", () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  test("swipe sideways from today's to the results, and the pill follows", async ({ page }) => {
    await openApp(page);
    await page.getByRole("tab", { name: "Games" }).click();
    const pages = page.locator("#gamePages");
    await expect(page.locator("#games-today")).toContainText("Dream");

    await pages.evaluate((element) => element.scrollTo({ left: 0, behavior: "instant" }));

    await expect(page.getByRole("tab", { name: "Previous" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await expect(page.locator("#games-previous")).toBeInViewport();
  });

  test("reach the screen's edges, so a swiped list slides off the screen", async ({ page }) => {
    await openApp(page);
    await page.getByRole("tab", { name: "Games" }).click();
    const box = await page.locator("#gamePages").boundingBox();
    expect(box.x).toBe(0);
    expect(box.width).toBe(390);
  });
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

const readBackground = (page) =>
  page.evaluate(() => getComputedStyle(document.body).backgroundColor);
const MAPLE = "rgb(234, 213, 178)";
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
    isDark ? "#1d1511" : "#ead5b2",
  );
}

/**
 * @param {import("@playwright/test").Page} page
 * @param {string} choice
 */
async function chooseAppearance(page, choice) {
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page
    .getByRole("radiogroup", { name: "Appearance" })
    .getByRole("radio", { name: choice })
    .check();
  await page.keyboard.press("Escape");
}

test("on System, the page and its icons follow the phone's dark or light setting", async ({
  page,
}) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await openApp(page);
  await expect(page.locator('input[name="appearance"][value="auto"]')).toBeChecked();
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
  await chooseAppearance(page, "System");
  await expectTheme(page, "dark");
});

test("each appearance choice shows the home-screen icon it offers", async ({ page }) => {
  await openApp(page);
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  const choices = page.locator(".appearance-choice");
  const icons = {
    System: ["icon-light-180.png", "icon-180.png"],
    Maple: ["icon-light-180.png"],
    Walnut: ["icon-180.png"],
  };
  for (const [name, sources] of Object.entries(icons)) {
    const images = choices.filter({ hasText: name }).locator("img");
    await expect(images).toHaveCount(sources.length);
    for (const [index, source] of sources.entries()) {
      await expect(images.nth(index)).toHaveAttribute("src", source);
      expect(
        await images
          .nth(index)
          .evaluate((image) => /** @type {HTMLImageElement} */ (image).naturalWidth),
      ).toBeGreaterThan(0);
    }
  }
});

test("changing the appearance says how to match the home-screen icon", async ({ page }) => {
  await openApp(page);
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  const note = page.locator("#appearanceNote");
  await expect(note).toBeHidden();
  await page.getByRole("radio", { name: "Walnut" }).check();
  await expect(note).toBeVisible();
  await expect(note).toHaveText(/Apple sets a home-screen icon only when the page is added/);
});

test("settings credit NBA.com for the data", async ({ page }) => {
  await openApp(page);
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await expect(page.locator("#settingsDialog")).toContainText("Data from NBA.com");
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

test("the Games lists' days and series labels stand apart from the team names in Barlow", async ({
  page,
}) => {
  await openApp(page);
  await page.getByRole("tab", { name: "Games" }).click();
  const readFirstFont = (locator) =>
    locator
      .first()
      .evaluate((element) =>
        getComputedStyle(element).fontFamily.split(",")[0].replaceAll('"', ""),
      );
  expect(await readFirstFont(page.locator("#gamePager .day-name"))).toBe("Barlow");
  expect(await readFirstFont(page.locator("#gamePager .series-label"))).toBe("Barlow");
  expect(await readFirstFont(page.locator("#gamePager .game-side .club"))).toBe("Saira Condensed");
});

test("each day's games sit in a box of their own, apart from the next day's", async ({ page }) => {
  await openApp(page);
  await page.getByRole("tab", { name: "Games" }).click();
  await page.getByRole("tab", { name: "Previous" }).click();
  const [first, second] = await page
    .locator("#games-previous .game-day")
    .evaluateAll((days) => days.map((day) => day.getBoundingClientRect()));
  expect(second.top - first.bottom).toBe(12);
  const box = await page
    .locator("#games-previous .game-day")
    .first()
    .evaluate((day) => getComputedStyle(day).borderTopStyle);
  expect(box).toBe("solid");
});

for (const width of [375, 360]) {
  test.describe(`on a ${width}px phone`, () => {
    test.use({ viewport: { width, height: 844 }, hasTouch: true, isMobile: true });

    test("every team's whole name fits in its game row", async ({ page }) => {
      await openApp(page);
      await page.getByRole("tab", { name: "Games" }).click();
      const cutNames = await page
        .locator("#gamePager .game-side .team-name")
        .evaluateAll((names) =>
          names
            .filter((name) => name.scrollWidth > name.getBoundingClientRect().width + 0.5)
            .map((name) => name.textContent),
        );
      expect(cutNames).toEqual([]);
    });
  });
}

/**
 * How light a computed color is, as the sum of its red, green, and blue.
 * @param {string} color
 */
const sumChannels = (color) =>
  color
    .match(/[\d.]+/g)
    .slice(0, 3)
    .map(Number)
    .reduce((sum, channel) => sum + channel);

/**
 * The color a page token resolves to.
 * @param {import("@playwright/test").Page} page
 * @param {string} token
 */
const readTokenColor = (page, token) =>
  page.evaluate((name) => {
    const probe = document.body.appendChild(document.createElement("div"));
    probe.style.color = `var(${name})`;
    const color = getComputedStyle(probe).color;
    probe.remove();
    return color;
  }, token);

test("on a wide screen, the tabs that aren't open are darker than the dim text and outlines", async ({
  page,
}) => {
  await openApp(page);
  const [text, outline] = await page
    .getByRole("tab", { name: "Games" })
    .evaluate((button) => [
      getComputedStyle(button).color,
      getComputedStyle(button).borderTopColor,
    ]);
  expect(sumChannels(text)).toBeLessThan(sumChannels(await readTokenColor(page, "--ink-dim")));
  expect(sumChannels(outline)).toBeLessThan(
    sumChannels(await readTokenColor(page, "--card-border")),
  );
});

test("a day of games and a series in the bracket share one thin outline, lighter than the bracket's lines", async ({
  page,
}) => {
  await openApp(page);
  const readOutline = (locator) =>
    locator
      .first()
      .evaluate((card) => [
        getComputedStyle(card).borderTopWidth,
        getComputedStyle(card).borderTopColor,
      ]);
  const seriesCard = page.locator('[data-series="1-0"]');
  await expect.poll(async () => (await readOutline(seriesCard))[0]).toBe("1px");
  const series = await readOutline(seriesCard);
  expect(sumChannels(series[1])).toBeGreaterThan(sumChannels(await readTokenColor(page, "--line")));
  await page.getByRole("tab", { name: "Games" }).click();
  expect(await readOutline(page.locator("#games-today .game-day"))).toEqual(series);
});

test("on a wide screen, the game and team rows keep to a phone's width", async ({ page }) => {
  await openApp(page);
  for (const [tab, row] of [
    ["Games", "#games-today .game-row"],
    ["Standings", "#standingsWrap table.standings"],
    ["Teams", "#teamsWrap .team-row"],
  ]) {
    await page.getByRole("tab", { name: tab }).click();
    const box = await page.locator(row).first().boundingBox();
    expect(box.width, tab).toBeLessThanOrEqual(560);
  }
});

test("on a wide screen, the Games pill and lists sit in the middle of the page", async ({
  page,
}) => {
  await openApp(page);
  await page.getByRole("tab", { name: "Games" }).click();
  const pageMiddle = page.viewportSize().width / 2;
  for (const locator of [
    page.getByRole("tablist", { name: "Games" }),
    page.locator("#games-today .game-row").first(),
  ]) {
    const box = await locator.boundingBox();
    expect(Math.abs(box.x + box.width / 2 - pageMiddle)).toBeLessThanOrEqual(1);
  }
});

test("the Standings pill switches between the league and each conference, through the season's updates", async ({
  page,
}) => {
  const app = await openApp(page);
  await page.getByRole("tab", { name: "Standings" }).click();
  const pill = page.getByRole("group", { name: "Standings" });
  const firstTeam = page.locator("#standingsWrap tbody tr").first();
  await expect(page.getByRole("table", { name: "League standings" })).toBeVisible();
  await expect(firstTeam).toContainText("Lynx");

  await pill.getByRole("button", { name: "East" }).click();

  await expect(page.getByRole("table", { name: "East standings" })).toBeVisible();
  await expect(firstTeam).toContainText("Dream");
  await expect(pill.getByRole("button", { name: "East" })).toHaveAttribute("aria-pressed", "true");
  await expect(pill.getByRole("button", { name: "East" })).toBeFocused();

  await app.changeSeason((season) => {
    season.standings.find((row) => row.team === "ATL").wins += 1;
    return season;
  });

  await expect(firstTeam).toContainText("31-14");
  await expect(page.getByRole("table", { name: "East standings" })).toBeVisible();
});

test("the playoff line is one dashed strip across the whole table", async ({ page }) => {
  await openApp(page);
  await page.getByRole("tab", { name: "Standings" }).click();
  const table = await page.locator("#standingsWrap table.standings").boundingBox();
  const line = await page.locator("#standingsWrap tr.playoff-line td").boundingBox();
  expect(line.x).toBeCloseTo(table.x, 0);
  expect(line.width).toBeCloseTo(table.width, 0);
});

test("clicking the tab that's showing scrolls back to the top", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 400 });
  await openApp(page);
  await page.getByRole("tab", { name: "Teams" }).click();
  await expect(page.locator("#teamsWrap .team-row").first()).toBeVisible();
  await page.mouse.wheel(0, 800);
  await expect.poll(() => page.evaluate(() => scrollY)).toBeGreaterThan(0);

  await page.getByRole("tab", { name: "Teams" }).dispatchEvent("click");

  await expect.poll(() => page.evaluate(() => scrollY)).toBe(0);
});

test("the page reopens on the tab it was last on", async ({ page }) => {
  await openApp(page);
  await page.getByRole("tab", { name: "Standings" }).click();

  await page.reload();

  await expect(page.getByRole("tab", { name: "Standings" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(page.locator("#view-standings")).toHaveCSS("display", "block");
  await expect(page.locator("#view-bracket")).toHaveCSS("display", "none");
});

test("a page last left on a tab it no longer has opens on the bracket", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("lastTab", "schedule"));
  await openApp(page);

  await expect(page.getByRole("tab", { name: "Bracket" })).toHaveAttribute("aria-selected", "true");
  await expect(page.locator("#view-bracket")).toBeVisible();
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

  test("the standings show every column, with a winning streak below the line paler than one above it", async ({
    page,
  }) => {
    await openApp(page);
    await page.getByRole("tab", { name: "Standings" }).click();
    for (const heading of ["W-L", "GB", "L10", "Strk"]) {
      await expect(page.getByRole("columnheader", { name: heading, exact: true })).toBeVisible();
    }
    const readStreakColor = (team) =>
      page
        .locator("#standingsWrap tbody tr", { hasText: team })
        .locator(".streak-won")
        .evaluate((streak) => getComputedStyle(streak).color);
    expect(await readStreakColor("Fire")).not.toBe(await readStreakColor("Lynx"));
  });
});

test("the page shows the tab it was last on before its modules have loaded", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("lastTab", "standings"));
  await page.route(
    (url) => url.pathname === "/js/app.js",
    (route) => route.abort(),
  );

  await openApp(page);

  const tab = page.getByRole("tab", { name: "Standings" });
  await expect(tab).toHaveAttribute("aria-selected", "true");
  await expect(tab).toHaveClass(/\bactive\b/);
  await expect(page.locator("#view-standings")).toHaveCSS("display", "block");
  await expect(page.locator("#view-bracket")).toHaveCSS("display", "none");
});
