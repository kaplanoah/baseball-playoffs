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

const readRoundName = (page, round) => page.locator(`.round-name[data-round="${round}"]`);

test.describe("on a phone, the bracket", () => {
  test.use({ viewport: PHONE, hasTouch: true, isMobile: true });

  test("opens on the earliest round still playing, and swipes either way", async ({ page }) => {
    const app = await openApp(page);
    await expect(readRoundName(page, 1)).toBeInViewport({ ratio: 1 });
    await expect(page.locator('.round-dots [data-round="1"]')).toHaveClass("on");

    await app.changeSeason(finishFirstRound);
    await expect(readRoundName(page, 2)).toBeInViewport({ ratio: 1 });
    await expect(readRoundName(page, 2)).toHaveClass(/\bnow\b/);
    await expect(readRoundName(page, 1)).not.toBeInViewport();
    await expect(page.locator('.round-dots [data-round="2"]')).toHaveClass("on");

    await page.locator(".bracket").evaluate((tree) => (tree.scrollLeft = 0));
    await expect(readRoundName(page, 1)).toBeInViewport({ ratio: 1 });
    await expect(page.locator('.round-dots [data-round="1"]')).toHaveClass("on");

    await page.getByRole("tab", { name: "Games" }).click();
    await page.getByRole("tab", { name: "Bracket" }).click();
    await expect(readRoundName(page, 2)).toBeInViewport({ ratio: 1 });
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

/** Each line's end, and the middle of each team row, in the page's coordinates. */
const readLines = (page) =>
  page.evaluate(() => {
    const svg = document.querySelector(".bracket-lines").getBoundingClientRect();
    const readEnd = (path) => {
      const end = path.getPointAtLength(path.getTotalLength());
      return { x: svg.left + end.x, y: svg.top + end.y };
    };
    const readRow = (id, index) => {
      const row = document.querySelectorAll(`[data-series="${id}"] .team-line`)[index];
      const box = row.getBoundingClientRect();
      return box.top + box.height / 2;
    };
    return {
      decided: [...document.querySelectorAll(".bracket-lines .decided")].map(readEnd),
      open: [...document.querySelectorAll(".bracket-lines .open")].map(readEnd),
      rows: {
        semifinalTop: readRow("2-0", 0),
        semifinalBottom: readRow("2-0", 1),
        finalsMiddle: (readRow("3-0", 0) + readRow("3-0", 1)) / 2,
      },
    };
  });

test("each winner's line runs to the row it holds next, crossing when the seeds flip", async ({
  page,
}) => {
  const app = await openApp(page);
  await expect(page.locator(".bracket-lines .decided")).toHaveCount(1);
  await expect
    .poll(async () => {
      const { decided, rows } = await readLines(page);
      return Math.round(decided[0].y - rows.semifinalTop);
    })
    .toBe(0);

  await app.changeSeason(finishFirstRound);
  await expect(page.locator(".bracket-lines .decided")).toHaveCount(4);
  const finished = await readLines(page);
  const countEndsAt = (y) => finished.decided.filter((end) => Math.abs(end.y - y) < 1).length;
  expect(countEndsAt(finished.rows.semifinalTop)).toBe(1);
  expect(countEndsAt(finished.rows.semifinalBottom)).toBe(1);
  expect(finished.open).toHaveLength(2);
  for (const end of finished.open) expect(end.y).toBeCloseTo(finished.rows.finalsMiddle, 0);
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
