import { test, expect, openApp } from "./harness.mjs";

const PHONE = { width: 390, height: 844 };

/**
 * The afternoon's season with every first-round series over: the 8-seed Liberty win the upper
 * series and play the Semifinals under the 4-seed Dream, who host.
 * @param {any} season
 */
function finishFirstRound(season) {
  const findSeries = (id) => season.series.find((series) => series.id === id);
  const finish = (id, side) => {
    const series = findSeries(id);
    series.winner = series[side].team;
    series[side].wins = 2;
  };
  finish("1-1", "top");
  finish("1-2", "bottom");
  finish("1-3", "top");
  Object.assign(findSeries("2-0"), {
    top: { team: "ATL", seed: 4, wins: 0 },
    bottom: { team: "NYL", seed: 8, wins: 0 },
  });
  Object.assign(findSeries("2-1"), {
    top: { team: "GSV", seed: 2, wins: 0 },
    bottom: { team: "IND", seed: 6, wins: 0 },
  });
  return season;
}

/**
 * The season with both Semifinals over too, so the Finals are the round still playing.
 * @param {any} season
 */
function finishSemifinals(season) {
  finishFirstRound(season);
  const findSeries = (id) => season.series.find((series) => series.id === id);
  Object.assign(findSeries("2-0"), { winner: "NYL" });
  Object.assign(findSeries("2-0").bottom, { wins: 3 });
  Object.assign(findSeries("2-1"), { winner: "GSV" });
  Object.assign(findSeries("2-1").top, { wins: 3 });
  Object.assign(findSeries("3-0"), {
    top: { team: "GSV", seed: 2, wins: 0 },
    bottom: { team: "NYL", seed: 8, wins: 0 },
  });
  return season;
}

const readRoundName = (page, round) => page.locator(`.round-name[data-round="${round}"]`);

test.describe("on a phone, the bracket", () => {
  test.use({ viewport: PHONE, hasTouch: true, isMobile: true });

  test("opens on the earliest round still playing, and swipes either way", async ({ page }) => {
    const app = await openApp(page);
    await expect(readRoundName(page, 1)).toBeInViewport({ ratio: 1 });
    await expect(page.locator('[data-series="1-0"] .seed-label').first()).toBeInViewport({
      ratio: 1,
    });
    await expect(page.locator('.round-dots [data-round="1"]')).toHaveClass("on");

    await app.changeSeason(finishFirstRound);
    await expect(readRoundName(page, 2)).toBeInViewport({ ratio: 1 });
    await expect(readRoundName(page, 1)).not.toBeInViewport();
    await expect(page.locator('.round-dots [data-round="2"]')).toHaveClass("on");

    await page.locator(".bracket").evaluate((tree) => (tree.scrollLeft = 0));
    await expect(readRoundName(page, 1)).toBeInViewport({ ratio: 1 });
    await expect(page.locator('.round-dots [data-round="1"]')).toHaveClass("on");

    await page.getByRole("tab", { name: "Games" }).click();
    await page.getByRole("tab", { name: "Bracket" }).click();
    await expect(readRoundName(page, 2)).toBeInViewport({ ratio: 1 });
  });

  test("centers the Finals on the screen, opening on them or swiped to them", async ({ page }) => {
    const app = await openApp(page);
    const readFinalsOffCenter = () =>
      page.locator(".bracket").evaluate((tree) => {
        const middle = (/** @type {Element} */ element) => {
          const box = element.getBoundingClientRect();
          return box.left + box.width / 2;
        };
        const finals = /** @type {Element} */ (tree.querySelector('[data-series="3-0"]'));
        return Math.abs(middle(finals) - middle(tree));
      });

    await app.changeSeason(finishSemifinals);
    await expect(readRoundName(page, 3)).toBeInViewport({ ratio: 1 });
    await expect.poll(readFinalsOffCenter).toBeLessThan(1);
    await expect(page.locator('.round-dots [data-round="3"]')).toHaveClass("on");

    await page.locator(".bracket").evaluate((tree) => (tree.scrollLeft = 0));
    await page
      .locator(".bracket")
      .evaluate((tree) => tree.scrollTo({ left: tree.scrollWidth, behavior: "instant" }));
    await expect.poll(readFinalsOffCenter).toBeLessThan(1);
  });

  test("pins its round dots just above the tab bar, and lights the last round at the scroll's end", async ({
    page,
  }) => {
    await openApp(page);
    const dots = page.locator(".round-dots");
    await expect(dots.locator('[data-round="1"]')).toHaveClass("on");
    const dotsBox = await dots.boundingBox();
    const bar = await page.locator("#tabBar").boundingBox();
    expect(bar.y - (dotsBox.y + dotsBox.height)).toBeGreaterThan(0);
    expect(bar.y - (dotsBox.y + dotsBox.height)).toBeLessThanOrEqual(16);

    await page
      .locator(".bracket")
      .evaluate((tree) => tree.scrollTo({ left: tree.scrollWidth, behavior: "instant" }));
    await expect(dots.locator('[data-round="3"]')).toHaveClass("on");
  });

  test("shows the next round's edge beside the one it opens on", async ({ page }) => {
    await openApp(page);
    await expect(page.locator('[data-series="2-0"]')).toBeVisible();
    const next = await page.locator('[data-series="2-0"]').boundingBox();
    expect(next.x).toBeLessThan(PHONE.width);
    expect(next.x + next.width).toBeGreaterThan(PHONE.width);
    const pageOverflow = await page.evaluate(
      () => document.scrollingElement.scrollWidth - document.scrollingElement.clientWidth,
    );
    expect(pageOverflow).toBe(0);
  });
});

test("a first-round seed's label sits outside its card, beside its row", async ({ page }) => {
  await openApp(page);
  const card = page.locator('[data-series="1-0"]');
  const row = card.locator(".team-line").filter({ hasText: "Liberty" });
  await expect(row.locator(".seed-label")).toHaveText("8 seed");
  const label = await row.locator(".seed-label").boundingBox();
  const cardBox = await card.boundingBox();
  const rowBox = await row.boundingBox();
  expect(label.x).toBeGreaterThanOrEqual(0);
  expect(label.x + label.width).toBeLessThan(cardBox.x);
  expect(Math.abs(label.y + label.height / 2 - (rowBox.y + rowBox.height / 2))).toBeLessThan(1);
  await expect(page.locator('[data-series="2-0"] .seed-label')).toHaveCount(0);
});

test("a seed's number and Seed share a baseline, each trimmed to its letters", async ({ page }) => {
  await openApp(page);
  const label = page.locator('[data-series="1-0"] .seed-label').first();
  await expect(label).toBeVisible();
  const [number, word] = await label.evaluate((element) =>
    [".seed-number", ".seed-word"].map((selector) => {
      const part = /** @type {Element} */ (element.querySelector(selector));
      const box = part.getBoundingClientRect();
      return {
        bottom: box.bottom,
        height: box.height,
        fontSize: parseFloat(getComputedStyle(part).fontSize),
      };
    }),
  );
  expect(Math.abs(number.bottom - word.bottom)).toBeLessThan(0.3);
  for (const part of [number, word]) expect(part.height).toBeLessThan(part.fontSize * 0.8);
});

test("every round's cards are one width, and each round's name starts where its cards do", async ({
  page,
}) => {
  await openApp(page);
  await expect(page.locator('[data-series="3-0"]')).toBeVisible();
  const readBox = (selector) => page.locator(selector).boundingBox();
  const cards = await Promise.all(
    ["1-0", "2-0", "3-0"].map((id) => readBox(`[data-series="${id}"]`)),
  );
  for (const card of cards) expect(card.width).toBeCloseTo(cards[0].width, 0);
  for (const [index, card] of cards.entries()) {
    const name = await readRoundName(page, index + 1).boundingBox();
    expect(name.x).toBeCloseTo(card.x, 0);
    expect(name.width).toBeCloseTo(card.width, 0);
  }
});

test("every card's header is in one plain color and weight, whether its series is over, on today, or waiting", async ({
  page,
}) => {
  await openApp(page);
  const notes = page.locator(".series-note");
  await expect(notes.filter({ hasText: "Liberty win 2-0" })).toBeVisible();
  await expect(notes.filter({ hasText: "Today" }).first()).toBeVisible();
  const styles = await notes.evaluateAll((elements) =>
    elements.map((note) => {
      const { color, fontWeight } = getComputedStyle(note);
      return `${color} ${fontWeight}`;
    }),
  );
  expect(new Set(styles).size).toBe(1);
});

test("every round's name is one color, even the round the bracket opens on", async ({ page }) => {
  await openApp(page);
  const readColor = (round) =>
    readRoundName(page, round)
      .locator(":scope > span")
      .first()
      .evaluate((name) => {
        return getComputedStyle(name).color;
      });
  await expect(readRoundName(page, 1)).toBeVisible();
  expect(await readColor(1)).toBe(await readColor(2));
  expect(await readColor(1)).toBe(await readColor(3));
});

/**
 * Each bracket's corners, and the middle of each card's two rows, in the page's coordinates.
 * @param {import("@playwright/test").Page} page
 */
const readBrackets = (page) =>
  page.evaluate(() => {
    const svg = document.querySelector(".bracket-lines").getBoundingClientRect();
    const readMiddle = (id) => {
      const rows = [...document.querySelectorAll(`.series[data-series="${id}"] .team-line`)];
      const [top, bottom] = rows.map((row) => row.getBoundingClientRect());
      return (top.top + bottom.bottom) / 2;
    };
    const paths = /** @type {SVGPathElement[]} */ ([
      ...document.querySelectorAll(".bracket-lines path"),
    ]);
    return {
      brackets: paths.map((path) => {
        const length = path.getTotalLength();
        const start = path.getPointAtLength(0);
        const end = path.getPointAtLength(length);
        return {
          next: path.dataset.next,
          shape: path.getAttribute("d"),
          start: svg.top + start.y,
          end: svg.top + end.y,
        };
      }),
      middles: Object.fromEntries(
        ["1-0", "1-3", "1-1", "1-2", "2-0", "2-1", "3-0"].map((id) => [id, readMiddle(id)]),
      ),
    };
  });

test("square bracket lines join each pair of series into the middle of the one they feed", async ({
  page,
}) => {
  const app = await openApp(page);
  await expect(page.locator(".bracket-lines path")).toHaveCount(3);
  const expectJoins = async () => {
    const { brackets, middles } = await readBrackets(page);
    const feeders = { "2-0": "1-0", "2-1": "1-1", "3-0": "2-0" };
    expect(brackets.map((bracket) => bracket.next)).toEqual(["2-0", "2-1", "3-0"]);
    for (const bracket of brackets) {
      expect(bracket.shape).toMatch(/^M[\d. ]+( [HV][\d.]+| M[\d. ]+)+$/);
      expect(bracket.start).toBeCloseTo(middles[feeders[bracket.next]], 0);
      expect(bracket.end).toBeCloseTo(middles[bracket.next], 0);
    }
  };
  await expect.poll(async () => (await readBrackets(page)).brackets[0].end).toBeGreaterThan(0);
  await expectJoins();

  // The 8-seed Liberty win the upper series and play under the 4-seed Dream; the lines don't move.
  await app.changeSeason(finishFirstRound);
  await expect(page.locator('[data-series="2-1"] .team-line').first()).toContainText("Valkyries");
  await expectJoins();
});

test("a team's dot splits its colors top and bottom, with nothing between them", async ({
  page,
}) => {
  await openApp(page);
  const dot = page.locator('[data-series="1-0"] .dot').first();
  await expect(dot).toHaveCSS(
    "background-image",
    /^linear-gradient\(rgb\([^)]*\) 50%, rgb\([^)]*\) 50%\)$/,
  );
});

test("the Finals card has the same outline as every other series", async ({ page }) => {
  await openApp(page);
  const readOutline = (id) =>
    page.locator(`[data-series="${id}"]`).evaluate((card) => {
      const { borderTopColor, borderTopWidth, boxShadow } = getComputedStyle(card);
      return [borderTopColor, borderTopWidth, boxShadow];
    });
  await expect.poll(async () => (await readOutline("1-0"))[1]).toBe("1px");
  expect(await readOutline("3-0")).toEqual(await readOutline("1-0"));
});

test("a round's name and its Best of, in the text face, center on each other", async ({ page }) => {
  await openApp(page);
  const readParts = () =>
    readRoundName(page, 2)
      .locator(":scope > span")
      .evaluateAll((parts) =>
        parts.map((part) => {
          const box = part.getBoundingClientRect();
          const font = getComputedStyle(part).fontFamily.split(",")[0].replaceAll('"', "");
          return { middle: (box.top + box.bottom) / 2, font };
        }),
      );
  await expect.poll(async () => (await readParts())[1].font).toBe("Barlow");
  const [name, bestOf] = await readParts();
  expect(Math.abs(name.middle - bestOf.middle)).toBeLessThanOrEqual(0.5);
});

test("each team's wins sit on a block that casts a shadow on the card", async ({ page }) => {
  await openApp(page);
  const wins = page.locator('[data-series="1-0"] .wins').first();
  await expect(wins).toHaveText("0");
  await expect(wins).toHaveCSS("filter", /drop-shadow/);
  const box = await wins.boundingBox();
  expect([box.width, box.height]).toEqual([27, 28]);
});
