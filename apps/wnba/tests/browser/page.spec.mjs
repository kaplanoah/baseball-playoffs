import { test, expect, openApp } from "./harness.mjs";
import { listTapFlashes, listTouchHoverRules } from "../../../../tests/browser/tap-states.mjs";
import { serveReleases } from "../../../../tests/browser/serve-releases.mjs";
import { listOffScaleText } from "../../../../tests/browser/type-scale.mjs";

test("the page opens on the bracket the Worker saved, and each tab shows its view", async ({
  page,
}) => {
  await openApp(page);
  await expect(page.locator('[data-series="1-0"] .team-line.won')).toContainText("Liberty");
  await expect(page.locator("header.top .title-row")).toHaveText("WNBA");
  const stampLines = page.locator("#stamp > span");
  await expect(stampLines.nth(0)).toHaveText(
    "No games since Liberty 87 Lynx 71 final last night \u2014 Liberty won series 2-0",
  );
  await expect(stampLines.nth(1)).toHaveText(/^Next tip-off 7:00\s?PM \u2014 Dream @ Mystics$/);
  const [last, next] = [
    await stampLines.nth(0).boundingBox(),
    await stampLines.nth(1).boundingBox(),
  ];
  expect(next.y - (last.y + last.height)).toBeGreaterThanOrEqual(3);
  const stampColors = await page.locator("#stamp").evaluate((stamp) => {
    const time = stamp.querySelector("b");
    return { line: getComputedStyle(stamp).color, time: getComputedStyle(time).color };
  });
  expect(stampColors.time).not.toBe(stampColors.line);

  await page.getByRole("tab", { name: "Games" }).click();
  await expect(page.locator("#games-today .game-row").first()).toContainText("7:00");
  await page.getByRole("tab", { name: "Standings" }).click();
  await expect(page.locator("#standings-league tr.playoff-line + tr")).toContainText("Fire");
  await expect(page.locator("nav.tabs").getByRole("tab")).toHaveText([
    "Bracket",
    "Games",
    "Standings",
  ]);
});

test("a losing score is lit at three quarters, without the winner's glow", async ({ page }) => {
  await openApp(page);
  await page.getByRole("tab", { name: "Games" }).click();
  await page.getByRole("tab", { name: "Previous" }).click();
  const loser = page.locator("#games-previous .scoreboard.lost rect.on").first();
  const winner = page.locator("#games-previous .scoreboard:not(.lost) rect.on").first();
  await expect(loser).toHaveCSS("opacity", "0.75");
  await expect(loser).toHaveCSS("filter", "none");
  await expect(winner).toHaveCSS("opacity", "1");
  await expect(winner).not.toHaveCSS("filter", "none");
});

test("every piece of text keeps to the type scale, in every view", async ({ page }) => {
  await openApp(page);
  expect(await listOffScaleText(page)).toEqual([]);
  await page.getByRole("tab", { name: "Games" }).click();
  for (const list of ["Previous", "Today", "Next"]) {
    await page.getByRole("tab", { name: list }).click();
    await expect(page.locator(`#games-${list.toLowerCase()} .game-row`).first()).toBeVisible();
    expect(await listOffScaleText(page)).toEqual([]);
  }
  await page.getByRole("tab", { name: "Standings" }).click();
  await expect(page.locator("#standings-league tr").nth(2)).toBeVisible();
  expect(await listOffScaleText(page)).toEqual([]);
  await page.getByRole("button", { name: "Team details: Minnesota Lynx" }).first().click();
  await expect(page.locator("#teamDialog table.players")).toBeVisible();
  expect(await listOffScaleText(page)).toEqual([]);
  await page.keyboard.press("Escape");
  await expect(page.locator("#teamDialog")).toBeHidden();
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await expect(page.locator("#settingsDialog")).toBeVisible();
  expect(await listOffScaleText(page)).toEqual([]);
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
  await expect(page.locator("#stamp > span").first()).toHaveText(
    /^NOW\s*Dream @ Mystics 30-27 with 5:10 in Q2$/,
  );
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
  await expect(page.locator("#games-previous .day-name").first()).toHaveText("Yest");
  await expect(page.locator("#games-previous")).toContainText("Final");

  await page.getByRole("tab", { name: "Next" }).click();
  await expect(page.getByRole("tab", { name: "Next" })).toHaveAttribute("aria-selected", "true");
  await expect(page.locator("#games-next")).toContainText("Semis");
  await expect(page.locator("#games-today")).toHaveJSProperty("inert", true);
});

test.describe("on a phone, the standings", () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  test("swipe sideways from the league to a conference, and the pill follows", async ({ page }) => {
    await openApp(page);
    await page.getByRole("tab", { name: "Standings" }).click();
    const pages = page.locator("#standings-pages");
    await expect(page.locator("#standings-league")).toContainText("Lynx");

    await pages.evaluate((element) =>
      element.scrollTo({ left: element.clientWidth, behavior: "instant" }),
    );

    await expect(page.getByRole("tab", { name: "East" })).toHaveAttribute("aria-selected", "true");
    await expect(page.locator("#standings-east")).toBeInViewport();
    const box = await pages.boundingBox();
    expect(box.x).toBe(0);
    expect(box.width).toBe(390);
  });
});

test.describe("on a phone, the Games lists", () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  test("swipe sideways from today's to the results, and the pill follows", async ({ page }) => {
    await openApp(page);
    await page.getByRole("tab", { name: "Games" }).click();
    const pages = page.locator("#games-pages");
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
    const box = await page.locator("#games-pages").boundingBox();
    expect(box.x).toBe(0);
    expect(box.width).toBe(390);
  });
});

test("a standings conference tag's letter is trimmed to its capital, with even room around it", async ({
  page,
}) => {
  await openApp(page);
  await page.getByRole("tab", { name: "Standings" }).click();
  const tag = page.locator("#standings-league .conference-tag").first();
  await expect(tag).toHaveText(/^[EW]$/);
  const room = await tag.evaluate((element) => {
    const style = getComputedStyle(element);
    const content =
      element.getBoundingClientRect().height -
      ["borderTopWidth", "borderBottomWidth", "paddingTop", "paddingBottom"]
        .map((side) => parseFloat(style[side]))
        .reduce((sum, value) => sum + value);
    return {
      content,
      fontSize: parseFloat(style.fontSize),
      above: style.paddingTop,
      below: style.paddingBottom,
    };
  });
  expect(room.content).toBeLessThan(room.fontSize * 0.8);
  expect(room.above).toBe(room.below);
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

test("settings list Notifications above Appearance, with one line between them", async ({
  page,
}) => {
  await openApp(page);
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  const rows = page.locator("#settingsDialog .control-row");
  await expect(rows.locator(".control-label > span:first-child")).toHaveText([
    "Notifications",
    "Appearance",
  ]);
  await expect(rows.first()).toBeVisible();
  const readTopBorders = () =>
    rows.evaluateAll((each) => each.map((row) => getComputedStyle(row).borderTopStyle));
  expect(await readTopBorders()).toEqual(["none", "solid"]);

  await rows.first().evaluate((row) => row.setAttribute("hidden", ""));
  expect((await readTopBorders())[1]).toBe("none");
});

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

/**
 * Opens settings with the release named under the title, and waits for the sheet to settle.
 * @param {import("@playwright/test").Page} page
 */
async function openSettingsWithRelease(page) {
  await serveReleases(page);
  await openApp(page);
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await expect(page.locator("#versionNote")).toBeVisible();
  await page.waitForFunction(() => document.getAnimations().length === 0);
}

/** @param {import("@playwright/test").Page} page */
const readSettingsBoxes = (page) =>
  page.locator("#settingsDialog").evaluate((dialog) => {
    const readBox = (selector) => dialog.querySelector(selector).getBoundingClientRect().toJSON();
    return {
      sheet: dialog.getBoundingClientRect().toJSON(),
      body: readBox(".settings-body"),
      top: readBox(".sheet-top"),
      head: readBox(".sheet-head"),
      grabber: readBox(".sheet-grabber"),
      title: readBox("h2"),
    };
  });

test.describe("on a phone, settings", () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  test("rise only as tall as what they hold, from the bottom of the screen", async ({ page }) => {
    await openSettingsWithRelease(page);
    const { sheet, body } = await readSettingsBoxes(page);
    expect(Math.round(sheet.bottom)).toBe(844);
    expect(Math.abs(sheet.bottom - body.bottom)).toBeLessThan(1);
    expect(sheet.height).toBeLessThan(844 * 0.6);
  });

  test("set their title 12px under the grabber, with the release and NBA.com inside the header", async ({
    page,
  }) => {
    await openSettingsWithRelease(page);
    const { top, head, grabber, title } = await readSettingsBoxes(page);
    expect(grabber.height).toBe(5);
    expect(title.top - grabber.bottom).toBe(12);
    expect(head.bottom).toBeLessThanOrEqual(top.bottom);
  });
});

test.describe("on a wide screen, settings", () => {
  test.use({ viewport: { width: 1280, height: 900 } });

  test("open only as tall as what they hold, in the middle of the screen", async ({ page }) => {
    await openSettingsWithRelease(page);
    const { sheet, body } = await readSettingsBoxes(page);
    expect(sheet.bottom - body.bottom).toBeLessThanOrEqual(1);
    expect(sheet.height).toBeLessThan(900 * 0.6);
    expect(Math.abs(sheet.top + sheet.height / 2 - 450)).toBeLessThan(1);
  });

  test("leave 10px above their title, with the release and NBA.com inside the header", async ({
    page,
  }) => {
    await openSettingsWithRelease(page);
    const { top, head, title } = await readSettingsBoxes(page);
    expect(title.top - top.top).toBe(10);
    expect(head.bottom).toBeLessThanOrEqual(top.bottom);
  });
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

test("Barlow Condensed draws 8% larger than its size, so it looks as big as Barlow", async ({
  page,
}) => {
  await openApp(page);
  await page.evaluate(() => document.fonts.ready);
  const faces = await page.evaluate(() =>
    [...document.fonts].map((font) => ({
      family: font.family,
      weight: font.weight,
      // TypeScript's DOM types don't list FontFace's sizeAdjust yet.
      sizeAdjust: /** @type {FontFace & { sizeAdjust: string }} */ (font).sizeAdjust,
    })),
  );
  const listFaces = (/** @type {string} */ family) =>
    faces
      .filter((face) => face.family === family)
      .map((face) => `${face.weight} ${face.sizeAdjust}`)
      .sort();
  expect(listFaces("Barlow Condensed")).toEqual(["300 108%", "400 108%", "500 108%", "600 108%"]);
  expect(listFaces("Barlow").every((face) => face.endsWith(" 100%"))).toBe(true);
});

test("the page uses its own fonts, served with it", async ({ page }) => {
  await openApp(page);
  // The bracket's wins are the first text in Barlow Condensed, so its font loads once they show.
  await expect(page.locator('[data-series="1-0"] .wins').first()).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  const loaded = await page.evaluate(() =>
    [...document.fonts].filter((font) => font.status === "loaded").map((font) => font.family),
  );
  expect(new Set(loaded)).toEqual(new Set(["Barlow Condensed", "Barlow"]));
  const italics = await page.evaluate(() =>
    [...document.fonts]
      .filter((font) => font.status === "loaded" && font.style === "italic")
      .map((font) => font.family),
  );
  expect(italics).toEqual(["Barlow"]);
});

test("the Games lists' days, series labels, and statuses are in Barlow, apart from the team names", async ({
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
  expect(await readFirstFont(page.locator("#gamePager .game-status"))).toBe("Barlow");
  expect(await readFirstFont(page.locator("#gamePager .game-side .club"))).toBe("Barlow Condensed");
});

test("a break between periods reads in the status's capitals, in the live game's orange", async ({
  page,
}) => {
  const app = await openApp(page);
  await page.getByRole("tab", { name: "Games" }).click();
  await app.changeSeason((season) => {
    const game = season.games.find((each) => each.id === "1042600132");
    Object.assign(game, { state: "live", status: "Half", period: 2, clock: "0.0" });
    Object.assign(game.away, { score: 48 });
    Object.assign(game.home, { score: 54 });
    return season;
  });
  const word = page.locator('[data-game="1042600132"] .game-status .break');
  await expect(word).toHaveText("Half");
  const style = await word.evaluate((element) => {
    const orange = document.createElement("span");
    orange.style.color = "var(--orange)";
    document.body.append(orange);
    const { fontFamily, textTransform, color } = getComputedStyle(element);
    const style = {
      font: fontFamily.split(",")[0].replaceAll('"', ""),
      textTransform,
      isOrange: color === getComputedStyle(orange).color,
    };
    orange.remove();
    return style;
  });
  expect(style).toEqual({ font: "Barlow", textTransform: "uppercase", isOrange: true });
});

test("every score panel is one size, a game past 100 like any other", async ({ page }) => {
  await openApp(page);
  await page.getByRole("tab", { name: "Games" }).click();
  await page.getByRole("tab", { name: "Previous" }).click();
  const sizes = await page.locator("#games-previous .scoreboard").evaluateAll((panels) =>
    panels.map((panel) => {
      const box = panel.getBoundingClientRect();
      return `${Math.round(box.width * 10) / 10}x${Math.round(box.height * 10) / 10}`;
    }),
  );
  expect(sizes.length).toBeGreaterThan(4);
  expect(new Set(sizes).size).toBe(1);
  const texts = await page.locator("#games-previous .scoreboard-text").allTextContents();
  expect(texts.some((text) => Number(text) >= 100)).toBe(true);
});

test("a seed sits a little lighter than its team's name, and a pixel lower", async ({ page }) => {
  await openApp(page);
  await page.getByRole("tab", { name: "Games" }).click();
  const club = page.locator("#gamePager .game-side .club").first();
  const { nameWeight, seedWeight, offset } = await club.evaluate((element) => {
    const seed = /** @type {Element} */ (element.querySelector(".seed"));
    const name = /** @type {Element} */ (element.querySelector(".team-name"));
    const middle = (box) => box.top + box.height / 2;
    return {
      nameWeight: getComputedStyle(name).fontWeight,
      seedWeight: getComputedStyle(seed).fontWeight,
      offset: middle(seed.getBoundingClientRect()) - middle(element.getBoundingClientRect()),
    };
  });
  expect([seedWeight, nameWeight]).toEqual(["400", "600"]);
  expect(offset).toBeCloseTo(1, 0);
  const isLoaded = await page.evaluate(() => document.fonts.check('400 12px "Barlow Condensed"'));
  expect(isLoaded).toBe(true);
});

test("every team name is in Barlow Condensed", async ({ page }) => {
  await openApp(page);
  const readFonts = (selector) =>
    page
      .locator(selector)
      .evaluateAll((elements) =>
        elements.map((element) =>
          getComputedStyle(element).fontFamily.split(",")[0].replaceAll('"', ""),
        ),
      );
  await expect(page.locator(".team-line .club").first()).toBeVisible();
  expect(new Set(await readFonts(".club"))).toEqual(new Set(["Barlow Condensed"]));
});

test("the title and the round names are in Barlow Condensed, and each card's note in Barlow's italic", async ({
  page,
}) => {
  await openApp(page);
  const readFirstFont = (selector) =>
    page
      .locator(selector)
      .first()
      .evaluate((element) =>
        getComputedStyle(element).fontFamily.split(",")[0].replaceAll('"', ""),
      );
  await expect(page.locator(".card-note").first()).toBeVisible();
  for (const selector of ["header.top h1", ".round-name"])
    expect(await readFirstFont(selector)).toBe("Barlow Condensed");
  expect(await readFirstFont(".card-note")).toBe("Barlow");
  await expect(page.locator(".card-note").first()).toHaveCSS("font-style", "italic");
  await expect(page.locator(".card-note").first()).toHaveCSS("font-size", "14px");
  await page.getByRole("tab", { name: "Games" }).click();
  expect(await readFirstFont("#gamePager .day-month")).toBe("Barlow Condensed");
});

test("the sliders icon keeps the same room from the stamp as MLB's", async ({ page }) => {
  await openApp(page);
  await expect(page.locator("#stamp")).toBeVisible();
  const stamp = await page.locator("#stamp").boundingBox();
  const icon = await page.locator("#settingsBtn svg").boundingBox();
  const gap = icon.x - (stamp.x + stamp.width);
  expect(gap).toBeGreaterThanOrEqual(12);
  expect(gap).toBeLessThanOrEqual(18);
});

test("a tap shows only the page's own states: no gray flash, and no hover left behind", async ({
  page,
}) => {
  await openApp(page);
  await page.getByRole("tab", { name: "Standings" }).click();
  expect(await listTapFlashes(page)).toEqual([]);
  expect(await listTouchHoverRules(page)).toEqual([]);
});

test("hovering the settings button shades a rounded square around its icon", async ({ page }) => {
  await openApp(page);
  const button = page.locator("#settingsBtn");
  await button.hover();
  await expect(button).toHaveCSS("border-radius", "9px");
  await expect(button).not.toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
});

test.describe("on a phone, the text", () => {
  test.use({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
    contextOptions: { reducedMotion: "reduce" },
  });

  test("keeps to the type scale in the header, the Updates box, the games, the standings, a team's sheet, and settings, with the ranks in a narrow column", async ({
    page,
  }) => {
    await openApp(page, { isShowingUpdates: true });
    await expect(page.locator("#updates .what").first()).toBeVisible();
    expect(await listOffScaleText(page)).toEqual([]);

    await page.getByRole("tab", { name: "Games" }).click();
    for (const list of ["Previous", "Today", "Next"]) {
      await page.getByRole("tab", { name: list }).click();
      await expect(page.locator(`#games-${list.toLowerCase()} .game-row`).first()).toBeVisible();
      expect(await listOffScaleText(page)).toEqual([]);
    }

    await page.getByRole("tab", { name: "Standings" }).click();
    const standings = page.locator("#standings-league");
    await expect(standings.locator("tbody tr").first()).toBeVisible();
    expect(await listOffScaleText(page)).toEqual([]);
    await expect(standings.locator("td.place").first()).toHaveCSS("width", "28px");

    await standings.locator('tr[data-team="NYL"] td.season').first().click();
    const sheet = page.locator("#teamDialog");
    await expect(sheet.locator(".team-game")).toHaveCount(3);
    expect(await listOffScaleText(page)).toEqual([]);
    await page.keyboard.press("Escape");
    await expect(sheet).toBeHidden();

    await page.getByRole("button", { name: "Settings", exact: true }).click();
    await expect(page.locator("#settingsDialog")).toBeVisible();
    expect(await listOffScaleText(page)).toEqual([]);
  });

  test("of the Updates box reads at 16px with its team names at Condensed's 16.5px, its days at 14px, and its count at 13px, and a series' standing stays on one line", async ({
    page,
  }) => {
    await openApp(page, { isShowingUpdates: true });
    const updates = page.locator("#updates");
    await expect(updates.locator(".what").first()).toBeVisible();
    await expect(updates.locator(".what").first()).toHaveCSS("font-size", "16px");
    await expect(updates.locator(".what b").first()).toHaveCSS("font-size", "16.5px");
    await expect(updates.locator(".when").first()).toHaveCSS("font-size", "14px");
    await expect(updates.locator(".updates-count")).toHaveCSS("font-size", "13px");
    const lineCounts = await updates
      .locator(".series-score")
      .evaluateAll((scores) => scores.map((score) => score.getClientRects().length));
    expect(lineCounts.length).toBeGreaterThan(0);
    expect(lineCounts.every((count) => count === 1)).toBe(true);
  });
});

test.describe("on a phone, a team's sheet", () => {
  test.use({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
    contextOptions: { reducedMotion: "reduce" },
  });

  test("sets its name like every team's at 20px, its stats in the wider Barlow, its text in medium, and its first part 8px under the record", async ({
    page,
  }) => {
    await openApp(page);
    await page.getByRole("tab", { name: "Standings" }).click();
    await page.locator('#standings-league tr[data-team="ATL"] td.season').first().click();
    const sheet = page.locator("#teamDialog");
    await expect(sheet.locator("table.players")).toBeVisible();

    await expect(sheet.locator("#teamTitle")).toHaveCSS("font-weight", "600");
    await expect(sheet.locator("#teamTitle")).toHaveCSS("font-size", "20px");
    await expect(sheet.locator("#teamNote")).toHaveCSS("font-weight", "500");
    await expect(sheet.locator(".team-stat b").first()).toHaveCSS("font-family", /^"?Barlow"?,/);
    await expect(sheet.locator(".team-detail").first()).toHaveCSS("font-weight", "500");
    await expect(sheet.locator(".team-game").first()).toHaveCSS("font-weight", "500");

    const colors = await sheet.evaluate((dialog) => {
      const readColor = (selector) => getComputedStyle(dialog.querySelector(selector)).color;
      return {
        title: readColor("#teamTitle"),
        detail: readColor(".team-detail"),
        note: readColor("#teamNote"),
        label: readColor(".team-label"),
        round: readColor(".team-round"),
      };
    });
    expect(colors.detail).toBe(colors.title);
    expect(colors.label).toBe(colors.note);
    expect(colors.label).not.toBe(colors.round);

    const note = await sheet.locator("#teamNote").boundingBox();
    const firstPart = await sheet.locator(".sheet-part h3").first().boundingBox();
    expect(Math.round(firstPart.y - (note.y + note.height))).toBe(8);
  });
});

test.describe("a team's sheet", () => {
  test.use({ contextOptions: { reducedMotion: "reduce" } });

  test("a team in the standings opens its sheet, which follows the season as it changes, and Done closes it", async ({
    page,
  }) => {
    const app = await openApp(page);
    await page.getByRole("tab", { name: "Standings" }).click();
    await page.locator('#standings-league tr[data-team="LVA"] td.recent').first().click();
    const sheet = page.locator("#teamDialog");

    await expect(sheet.locator("#teamTitle")).toHaveText("Las Vegas Aces");
    await expect(sheet.locator("#teamNote")).toHaveText("West\u20223 seed\u202231-13");
    await expect(sheet).toContainText("Leading scorers");
    await app.changeSeason((season) => {
      season.standings.find((row) => row.team === "LVA").lastTen = "9-1";
      return season;
    });
    await expect(sheet).toContainText(/Last 10\s*9-1/);

    await sheet.getByRole("button", { name: "Done" }).click();
    await expect(sheet).toBeHidden();
  });

  test("a team's sheet is titled with its name, set like every other team's", async ({ page }) => {
    await openApp(page);
    await page.locator('#bracketWrap .team-line[data-team="NYL"]').first().click();
    const title = page.locator("#teamDialog #teamTitle");

    await expect(title).toHaveText("New York Liberty");
    await expect(title).toHaveCSS("font-family", /^"Barlow Condensed"/);
    await expect(title).toHaveCSS("font-weight", "600");
    await expect(title).toHaveCSS("text-transform", "none");
    await expect(title).toHaveCSS("font-size", "20px");
  });

  test("a team's name under the pointer shifts its color a little toward the accent, with no underline", async ({
    page,
  }) => {
    await openApp(page);
    await page.getByRole("tab", { name: "Standings" }).click();
    const name = page
      .locator('#standings-league tr[data-team="LVA"] .team-open')
      .locator(".team-name");
    const readColor = () => name.evaluate((element) => getComputedStyle(element).color);
    const before = await readColor();
    await name.hover();

    await expect.poll(readColor).not.toBe(before);
    await expect(name).toHaveCSS("text-decoration-line", "none");
  });

  test("a team in the bracket opens its sheet", async ({ page }) => {
    await openApp(page);
    await page.locator('#bracketWrap .team-line[data-team="NYL"]').first().click();
    const sheet = page.locator("#teamDialog");

    await expect(sheet.locator("#teamTitle")).toHaveText("New York Liberty");
    await expect(sheet.locator(".team-game")).toHaveCount(3);
  });

  test("an opponent's name in a team's sheet opens that team's sheet in its place", async ({
    page,
  }) => {
    await openApp(page);
    await page.locator('#bracketWrap .team-line[data-team="NYL"]').first().click();
    const sheet = page.locator("#teamDialog");
    await expect(sheet.locator("#teamTitle")).toHaveText("New York Liberty");
    const opponent = sheet.locator(".team-matchup").first().getByRole("button");
    const label = await opponent.getAttribute("aria-label");

    await opponent.click();
    await expect(sheet.locator("#teamTitle")).toHaveText(label.replace("Team details: ", ""));
    await expect(sheet.locator("#teamTitle")).not.toHaveText("New York Liberty");
  });

  test("a team's name in the standings opens its sheet from the keyboard", async ({ page }) => {
    await openApp(page);
    await page.getByRole("tab", { name: "Standings" }).click();
    const fever = page.locator("#standings-league").getByRole("button", {
      name: "Team details: Indiana Fever",
    });
    await fever.focus();
    await page.keyboard.press("Enter");

    await expect(page.locator("#teamDialog #teamTitle")).toHaveText("Indiana Fever");
  });

  test("redrawing the standings each minute keeps keyboard focus on the team it was on", async ({
    page,
  }) => {
    await openApp(page);
    await page.getByRole("tab", { name: "Standings" }).click();
    const aces = page.locator("#standings-league").getByRole("button", {
      name: "Team details: Las Vegas Aces",
    });
    await aces.focus();

    await page.clock.runFor(60 * 1000);
    await expect(aces).toBeFocused();
  });
});

test.describe("on a phone", () => {
  test.use({ viewport: { width: 360, height: 780 }, contextOptions: { reducedMotion: "reduce" } });

  test("a team's leading scorers keep their names on one line, and its averages fit their tiles", async ({
    page,
  }) => {
    await openApp(page);
    await page.getByRole("tab", { name: "Standings" }).click();
    const sheet = page.locator("#teamDialog");
    for (const code of ["LVA", "LAS", "CON"]) {
      await page.locator(`#standings-league tr[data-team="${code}"] td.season`).first().click();
      const names = sheet.locator("table.players tbody th");
      await expect(names).toHaveCount(3);
      const lineCounts = await names.evaluateAll((cells) =>
        cells.map((cell) => {
          const range = document.createRange();
          range.selectNodeContents(cell);
          return new Set([...range.getClientRects()].map((rect) => Math.round(rect.bottom))).size;
        }),
      );
      expect(lineCounts, code).toEqual([1, 1, 1]);
      const overflowing = await sheet
        .locator(".team-stat")
        .evaluateAll((stats) =>
          stats
            .filter((stat) => stat.scrollWidth > stat.clientWidth)
            .map((stat) => stat.textContent),
        );
      expect(overflowing, code).toEqual([]);
      await page.keyboard.press("Escape");
      await expect(sheet).toBeHidden();
    }
  });
});

test("redrawing the games each minute keeps keyboard focus on the game it was on", async ({
  page,
}) => {
  await openApp(page);
  await page.getByRole("tab", { name: "Games" }).click();
  const game = page.locator('[data-game="1042600132"] .game-open');
  await game.focus();

  await page.clock.runFor(60 * 1000);
  await expect(game).toBeFocused();
});

test("each day's games sit in a box of their own, apart from the next day's", async ({ page }) => {
  await openApp(page);
  await page.getByRole("tab", { name: "Games" }).click();
  await page.getByRole("tab", { name: "Previous" }).click();
  const [first, second] = await page
    .locator("#games-previous .game-day")
    .evaluateAll((days) => days.map((day) => day.getBoundingClientRect()));
  expect(second.top - first.bottom).toBe(8);
  const box = await page
    .locator("#games-previous .game-day .game-list")
    .first()
    .evaluate((list) => getComputedStyle(list).borderTopStyle);
  expect(box).toBe("solid");
});

test("each day's date sits to the left of its games, level with the first", async ({ page }) => {
  await openApp(page);
  await page.getByRole("tab", { name: "Games" }).click();
  const day = page.locator("#games-today .game-day").first();
  const date = await day.locator(".day-label").boundingBox();
  const list = await day.locator(".game-list").boundingBox();
  const firstGame = await day.locator(".game-row").first().boundingBox();
  expect(date.x + date.width).toBeLessThan(list.x);
  expect(
    Math.abs(date.y + date.height / 2 - (firstGame.y + firstGame.height / 2)),
  ).toBeLessThanOrEqual(1);
});

test("a game's series line, score, and status each have room in its row", async ({ page }) => {
  await openApp(page);
  await page.getByRole("tab", { name: "Games" }).click();
  await page.getByRole("tab", { name: "Previous" }).click();
  const row = page.locator("#games-previous .game-row:has(.score)").first();
  const [box, label, score, status] = await Promise.all(
    [
      row,
      ...[".game-label", ".game-headline", ".game-status"].map((part) => row.locator(part)),
    ].map((part) => part.evaluate((element) => element.getBoundingClientRect().toJSON())),
  );
  expect(label.top - box.top).toBeGreaterThanOrEqual(6);
  expect(score.top - label.bottom).toBeGreaterThanOrEqual(5);
  expect(status.top - score.bottom).toBeGreaterThanOrEqual(4);
  expect(box.bottom - status.bottom).toBeGreaterThanOrEqual(4);
  const corners = await row
    .locator(".scoreboard")
    .first()
    .evaluate((panel) => getComputedStyle(panel).borderRadius);
  expect(corners).toBe("1px");
});

const DAY_ROOM_BY_WIDTH = [
  { width: 402, edge: 10, gap: 10, inset: 14 },
  { width: 390, edge: 8, gap: 10, inset: 10 },
];

for (const { width, edge, gap, inset } of DAY_ROOM_BY_WIDTH) {
  test.describe(`on a ${width}px phone`, () => {
    test.use({ viewport: { width, height: 844 }, hasTouch: true, isMobile: true });

    test("each day's date has room on both sides, and its card's games room inside it", async ({
      page,
    }) => {
      await openApp(page);
      await page.getByRole("tab", { name: "Games" }).click();
      const day = page.locator("#games-today .game-day").first();
      const date = await day.locator(".day-label").boundingBox();
      const list = await day.locator(".game-list").boundingBox();
      const firstDot = await day.locator(".game-side.away .dot").first().boundingBox();
      expect(date.x).toBeGreaterThanOrEqual(edge);
      expect(list.x - (date.x + date.width)).toBeGreaterThanOrEqual(gap);
      expect(firstDot.x - list.x).toBeGreaterThanOrEqual(inset);
    });
  });
}

for (const width of [440, 430, 402, 390, 375, 360]) {
  test.describe(`on a ${width}px phone`, () => {
    test.use({ viewport: { width, height: 844 }, hasTouch: true, isMobile: true });

    test("every team's whole name fits in its game row", async ({ page }) => {
      await openApp(page);
      await page.getByRole("tab", { name: "Games" }).click();
      await expect(page.locator("#gamePager .game-side .team-name").first()).toBeVisible();
      await page.evaluate(() => document.fonts.ready);
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

/**
 * The sum of a CSS color's red, green, and blue, whatever space the browser gives it in.
 * @param {import("@playwright/test").Page} page
 * @param {string} color
 */
const readBrightness = (page, color) =>
  page.evaluate((css) => {
    const context = document.createElement("canvas").getContext("2d");
    context.fillStyle = css;
    context.fillRect(0, 0, 1, 1);
    const [red, green, blue] = context.getImageData(0, 0, 1, 1).data;
    return red + green + blue;
  }, color);

for (const theme of ["Maple", "Walnut"])
  test(`in ${theme}, the bracket's and the games' cards sit most of the way from the floor to a sheet`, async ({
    page,
  }) => {
    await openApp(page);
    await page.evaluate((name) => {
      document.documentElement.dataset.theme = name === "Walnut" ? "dark" : "light";
    }, theme);
    const series = page.locator('.series[data-series="1-0"]');
    await expect(series).toBeVisible();
    const face = await series.evaluate((card) => getComputedStyle(card).backgroundColor);
    const floor = await readBrightness(page, await readTokenColor(page, "--bg"));
    const sheet = await readBrightness(page, await readTokenColor(page, "--card"));
    const card = await readBrightness(page, face);
    expect(Math.abs(card - floor)).toBeGreaterThan(Math.abs(sheet - floor) * 0.6);
    expect(Math.abs(card - floor)).toBeLessThan(Math.abs(sheet - floor) * 0.9);
    await page.getByRole("tab", { name: "Games" }).click();
    const day = page.locator("#games-today .game-day .game-list");
    expect(await day.evaluate((card) => getComputedStyle(card).backgroundColor)).toBe(face);
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
  expect(await readOutline(page.locator("#games-today .game-day .game-list"))).toEqual(series);
});

test("on a wide screen, the Games and Standings lists keep to one phone's width, in the middle of the page", async ({
  page,
}) => {
  await openApp(page);
  const pageMiddle = page.viewportSize().width / 2;
  for (const { tab, pill, list } of [
    { tab: "Games", pill: "#gamePager .pager-tabs", list: "#games-today .game-day" },
    {
      tab: "Standings",
      pill: "#standingsPager .pager-tabs",
      list: "#standings-league table.standings",
    },
  ]) {
    await page.getByRole("tab", { name: tab }).click();
    for (const selector of [pill, list].filter(Boolean)) {
      const box = await page.locator(selector).first().boundingBox();
      expect(Math.abs(box.x + box.width / 2 - pageMiddle), selector).toBeLessThanOrEqual(1);
    }
    const listBox = await page.locator(list).first().boundingBox();
    expect(listBox.width, tab).toBe(560);
  }
});

test("the Standings pill switches between the league and each conference, through the season's updates and back from another tab", async ({
  page,
}) => {
  const app = await openApp(page);
  await page.getByRole("tab", { name: "Standings" }).click();
  const pill = page.getByRole("tablist", { name: "Standings" });
  const shownFirstTeam = page.locator(".pager-page:not([inert]) tbody tr").first();
  await expect(page.getByRole("table", { name: "League standings" })).toBeInViewport();
  await expect(shownFirstTeam).toContainText("Lynx");

  await pill.getByRole("tab", { name: "East" }).click();

  await expect(page.getByRole("table", { name: "East standings" })).toBeInViewport();
  await expect(shownFirstTeam).toContainText("Dream");
  await expect(pill.getByRole("tab", { name: "East" })).toHaveAttribute("aria-selected", "true");

  await app.changeSeason((season) => {
    season.standings.find((row) => row.team === "ATL").wins += 1;
    return season;
  });
  await expect(shownFirstTeam).toContainText("31-14");
  await expect(page.getByRole("table", { name: "East standings" })).toBeInViewport();

  await page.getByRole("tab", { name: "Games" }).click();
  await page.getByRole("tab", { name: "Standings" }).click();
  await expect(page.getByRole("table", { name: "East standings" })).toBeInViewport();
  await expect(pill.getByRole("tab", { name: "East" })).toHaveAttribute("aria-selected", "true");
});

test("the standings' recent form reads a step below the season, in the mid ink, and the pill's other lists' names too", async ({
  page,
}) => {
  await openApp(page);
  await page.getByRole("tab", { name: "Standings" }).click();
  const lynx = page.locator('#standings-league tr[data-team="MIN"]');
  await expect(lynx).toBeVisible();
  const readType = (cell) =>
    cell.evaluate((element) => {
      const { fontSize, fontWeight, color } = getComputedStyle(element);
      return { size: parseFloat(fontSize), weight: fontWeight, color };
    });
  const season = await readType(lynx.locator("td.season").first());
  const recent = await readType(lynx.locator("td.recent").first());
  const middle = await readTokenColor(page, "--ink-mid");

  expect(recent.size).toBeLessThan(season.size);
  expect(recent.size).toBeGreaterThanOrEqual(12.8);
  expect([recent.weight, recent.color]).toEqual(["500", middle]);
  const east = page.getByRole("tablist", { name: "Standings" }).getByRole("tab", { name: "East" });
  await expect(east).toHaveCSS("color", middle);
  await expect(east).toHaveCSS("font-weight", "500");
});

test("the playoff line is one dashed strip across the whole table", async ({ page }) => {
  await openApp(page);
  await page.getByRole("tab", { name: "Standings" }).click();
  const table = await page.locator("#standings-league table.standings").boundingBox();
  const line = await page.locator("#standings-league tr.playoff-line td").boundingBox();
  expect(line.x).toBeCloseTo(table.x, 0);
  expect(line.width).toBeCloseTo(table.width, 0);
});

test("the standings draw lines only between rows, none under the playoff line or the last team", async ({
  page,
}) => {
  await openApp(page);
  await page.getByRole("tab", { name: "Standings" }).click();
  const bottomBorders = await page
    .locator("#standings-league table.standings td")
    .evaluateAll((cells) =>
      cells
        .filter((cell) => getComputedStyle(cell).borderBottomStyle !== "none")
        .map((cell) => cell.textContent),
    );
  expect(bottomBorders).toEqual([]);
});

test("clicking the tab that's showing scrolls back to the top", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 400 });
  await openApp(page);
  await page.getByRole("tab", { name: "Standings" }).click();
  await expect(page.locator("#standings-league tbody tr").first()).toBeVisible();
  await page.mouse.wheel(0, 800);
  await expect.poll(() => page.evaluate(() => scrollY)).toBeGreaterThan(0);

  await page.getByRole("tab", { name: "Standings" }).dispatchEvent("click");

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

test("a page last left on a tab it no longer has, like Teams, opens on the bracket", async ({
  page,
}) => {
  await page.addInitScript(() => localStorage.setItem("lastTab", "teams"));
  await openApp(page);

  await expect(page.getByRole("tab", { name: "Bracket" })).toHaveAttribute("aria-selected", "true");
  await expect(page.locator("#view-bracket")).toBeVisible();
});

test.describe("on a phone", () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  test("the tab bar floats at the bottom, each view starts just under the header, and the page neither scrolls sideways nor shows a scrollbar", async ({
    page,
  }) => {
    // The tab bar's pill would ease to each tab, which this test doesn't need to wait out.
    await page.emulateMedia({ reducedMotion: "reduce" });
    await openApp(page);
    const bar = await page.locator("#tabBar").boundingBox();
    expect(bar.y + bar.height).toBeGreaterThan(844 - 40);
    const headerBottom = await page
      .locator("header.top")
      .evaluate((header) => header.getBoundingClientRect().bottom);
    for (const tab of ["Bracket", "Games", "Standings"]) {
      await page.getByRole("tab", { name: tab }).click();
      const width = await page.evaluate(() => document.documentElement.scrollWidth);
      expect(width, tab).toBeLessThanOrEqual(390);
      const view = await page.locator(".view.active").boundingBox();
      expect(view.y - headerBottom, tab).toBeLessThanOrEqual(14);
    }
    const scrollbars = await page.evaluate(() =>
      [document.documentElement, ...document.querySelectorAll("body *")]
        .filter((element) => getComputedStyle(element).scrollbarWidth !== "none")
        .map((element) => element.id || element.className),
    );
    expect(scrollbars).toEqual([]);
  });

  test("the tab bar's glass keeps Maple's colors, and boosts Walnut's", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await openApp(page);
    const readGlass = (selector) =>
      page.locator(selector).evaluate((glass) => getComputedStyle(glass).backdropFilter);
    await chooseAppearance(page, "Maple");
    expect(await readGlass(".tab-glass")).toContain("saturate(1)");
    expect(await readGlass(".tab-pill")).toContain("saturate(1)");
    await chooseAppearance(page, "Walnut");
    expect(await readGlass(".tab-glass")).toContain("saturate(1.6)");
    expect(await readGlass(".tab-pill")).toContain("saturate(1.6)");
  });

  test("the standings show every column, with a winning streak below the line paler than one above it", async ({
    page,
  }) => {
    await openApp(page);
    await page.getByRole("tab", { name: "Standings" }).click();
    const table = page.getByRole("table", { name: "League standings" });
    for (const heading of ["W-L", "GB", "L10", "Strk"]) {
      await expect(table.getByRole("columnheader", { name: heading, exact: true })).toBeVisible();
    }
    const readStreakColor = (team) =>
      page
        .locator("#standings-league tbody tr", { hasText: team })
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
