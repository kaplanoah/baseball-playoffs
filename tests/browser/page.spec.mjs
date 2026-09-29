import {
  test,
  expect,
  openApp,
  buildFixtureSnapshot,
  chooseSeason,
  EVENING_FIXTURE,
} from "./harness.mjs";
import { createReading } from "../../page/js/readings.js";

const PLAYOFF_FIELD_2026 = [
  "Rays",
  "Guardians",
  "Rangers",
  "Yankees",
  "Red Sox",
  "White Sox",
  "Brewers",
  "Dodgers",
  "Braves",
  "Padres",
  "Cubs",
  "Phillies",
];

test("the Games tab lists today's games and each club's previous and next game", async ({
  page,
}) => {
  await openApp(page);
  await page.getByRole("tab", { name: "Games" }).click();
  const games = page.locator("#gamesList");
  await expect(games.locator(".game-row")).toHaveCount(12);
  await expect(games.locator(".game-row.live").first()).toContainText("Top 9th");

  await page.getByRole("tab", { name: "Previous" }).click();
  await expect(games.locator(".game-row")).toHaveCount(15);
  await expect(games).toContainText("Game 2");

  await page.getByRole("tab", { name: "Previous" }).press("End");
  await expect(page.getByRole("tab", { name: "Next" })).toBeFocused();
  await expect(page.getByRole("tab", { name: "Next" })).toHaveAttribute("aria-selected", "true");
  await expect(games.locator(".game-row")).toHaveCount(15);
  await expect(games.locator(".game-row").first()).toContainText("Game 1");
});

const PHONE = { width: 390, height: 844 };
const WIDE_SCREEN = { width: 1700, height: 900 };
const LAPTOP = { width: 1280, height: 800 };

const CREAM = "rgb(241, 234, 212)";
const GREEN = "rgb(127, 168, 143)";
const TAUPE = "rgb(138, 122, 106)";
const GOLD = "rgb(244, 193, 92)";

test("the Games tab bolds each winner and dims only the clubs that are out", async ({ page }) => {
  await openApp(page);
  await page.getByRole("tab", { name: "Games" }).click();
  await page.getByRole("tab", { name: "Previous" }).click();
  const findSide = (away, home, side) =>
    page
      .locator("#gamesList .game-row")
      .filter({ hasText: away })
      .filter({ hasText: home })
      .locator(`.game-side.${side}`);

  const winnerStillIn = findSide("Brewers", "Phillies", "away").locator(".team-name");
  const loserStillIn = findSide("Brewers", "Phillies", "home").locator(".team-name");
  const winnerOut = findSide("Nationals", "Tigers", "away").locator(".team-name");
  const loserOut = findSide("Nationals", "Tigers", "home");

  await expect(winnerStillIn).toHaveCSS("font-weight", "700");
  await expect(winnerStillIn).toHaveCSS("color", CREAM);
  await expect(loserStillIn).toHaveCSS("font-weight", "500");
  await expect(loserStillIn).toHaveCSS("color", CREAM);
  await expect(winnerOut).toHaveCSS("font-weight", "700");
  await expect(winnerOut).toHaveCSS("color", GREEN);
  await expect(loserOut.locator(".team-name")).toHaveCSS("color", GREEN);
  await expect(loserOut.locator(".dot")).toHaveCSS("opacity", "0.55");
});

test("the bracket shows an eliminated club in taupe, without a line through its name", async ({
  page,
}) => {
  await openApp(page, {
    store: { "seasons/2025": { year: 2025, teams: {}, series: {}, ranking: [], log: [] } },
  });
  await chooseSeason(page, "2025");

  const eliminated = page
    .locator(".matchup-row.eliminated .team-name")
    .filter({ hasText: "Mariners" })
    .first();
  await expect(eliminated).toHaveCSS("color", TAUPE);
  await expect(eliminated).toHaveCSS("text-decoration-line", "none");
});

test("on a phone, the bracket stacks the AL above the NL, each running left to right into the World Series", async ({
  page,
}) => {
  await page.setViewportSize(PHONE);
  await openApp(page);
  const bracket = page.locator("#bracketWrap");
  const findCard = (round) => bracket.locator(".box").filter({ hasText: round });
  const readLeft = async (round) => (await findCard(round).first().boundingBox()).x;

  const al = bracket.locator(".league-head.al");
  const nl = bracket.locator(".league-head.nl");
  await expect(al).toHaveText("American League");
  await expect(nl).toHaveText("National League");
  await expect(al).toHaveCSS("text-align", "left");
  const alTop = (await al.boundingBox()).y;
  const nlTop = (await nl.boundingBox()).y;
  expect(alTop).toBeLessThan(nlTop);

  const worldSeries = await bracket
    .locator(".box")
    .filter({ has: page.locator(".world") })
    .boundingBox();
  expect(await readLeft("Wild Card")).toBeLessThan(await readLeft("Division Series"));
  expect(await readLeft("Division Series")).toBeLessThan(await readLeft("Championship Series"));
  expect(await readLeft("Championship Series")).toBeLessThan(worldSeries.x);

  const alcs = await findCard("Championship Series").nth(0).boundingBox();
  const nlcs = await findCard("Championship Series").nth(1).boundingBox();
  expect(alcs.y).toBeGreaterThan(alTop);
  expect(alcs.y).toBeLessThan(nlTop);
  expect(nlcs.y).toBeGreaterThan(nlTop);
  expect(worldSeries.y).toBeGreaterThan(alcs.y);
  expect(worldSeries.y).toBeLessThan(nlcs.y);
});

test("under each card, the next game shows as just its day and date", async ({ page }) => {
  const snapshot = buildFixtureSnapshot(EVENING_FIXTURE);
  snapshot.series.AL_WC1.next = {
    at: "2026-09-25T23:08:00Z",
    date: "2026-09-25",
    tbd: false,
    game: 1,
  };
  await openApp(page, { snapshots: { [EVENING_FIXTURE.season]: snapshot } });
  const notes = page.locator("#bracketWrap .card-note");

  await expect(notes.filter({ hasText: /^Next game Fri Sep 25$/ })).toHaveCount(1);
  await expect(notes.filter({ hasText: /^Next game Tue Sep 29$/ })).toHaveCount(3);
});

const readStackedSpaces = (page) =>
  page.evaluate(() => {
    const readBox = (element) => element.getBoundingClientRect();
    const banner = readBox(document.getElementById("banner"));
    const line = readBox(document.querySelector("#bracketWrap .league-head.al"));
    const [upperCard, lowerCard] = [...document.querySelectorAll("#bracketWrap .box")].map(readBox);
    return {
      aboveLeague: line.top - banner.bottom,
      belowLine: upperCard.top - line.bottom,
      betweenRows: lowerCard.top - upperCard.bottom - 20,
    };
  });

test("on a phone too short for the bracket, its spaces are at their tightest", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 600 });
  await openApp(page);
  await expect(page.locator("#bracketWrap .league-head.al")).toBeVisible();

  expect(await readStackedSpaces(page)).toEqual({
    aboveLeague: 18,
    belowLine: 11,
    betweenRows: 13,
  });
});

test("on a taller phone, every space in the bracket grows by the same factor", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 960 });
  await openApp(page);
  await expect(page.locator("#bracketWrap .league-head.al")).toBeVisible();

  const { aboveLeague, belowLine, betweenRows } = await readStackedSpaces(page);
  const growth = betweenRows / 13;
  expect(growth).toBeGreaterThan(1.5);
  expect(belowLine / 11).toBeCloseTo(growth, 0);
  expect(aboveLeague / 18).toBeCloseTo(growth, 0);
});

const readCardTops = (page, round) =>
  page
    .locator("#bracketWrap .box")
    .filter({ hasText: round })
    .evaluateAll((boxes) => boxes.map((box) => box.getBoundingClientRect().top));

test("on a phone, each wild card card sits level with the division card it feeds", async ({
  page,
}) => {
  await page.setViewportSize(PHONE);
  await openApp(page);
  await expect(page.locator("#bracketWrap .bracket-stage")).toBeVisible();

  const wildCardTops = await readCardTops(page, "Wild Card");
  const divisionTops = await readCardTops(page, "Division Series");

  expect(wildCardTops).toHaveLength(4);
  expect(wildCardTops.toSorted()).toEqual(divisionTops.toSorted());
});

test("on a phone, a league's name stays at the left while its line scrolls sideways", async ({
  page,
}) => {
  await page.setViewportSize(PHONE);
  await openApp(page);
  const name = page.locator("#bracketWrap .league-head.al .league-name");
  await expect(name).toBeVisible();
  const restingLeft = (await name.boundingBox()).x;

  await page.locator(".tree-scroll").evaluate((scroller) => (scroller.scrollLeft = 300));

  await expect.poll(async () => (await name.boundingBox()).x).toBe(restingLeft);
});

test("on a wide screen, the AL and NL face each other across the World Series", async ({
  page,
}) => {
  await page.setViewportSize(WIDE_SCREEN);
  await openApp(page);
  const bracket = page.locator("#bracketWrap");
  const championships = bracket.locator(".box").filter({ hasText: "Championship Series" });
  await expect(championships).toHaveCount(2);

  const alcs = await championships.nth(0).boundingBox();
  const nlcs = await championships.nth(1).boundingBox();
  const worldSeries = await bracket
    .locator(".box")
    .filter({ has: page.locator(".world") })
    .boundingBox();
  expect(alcs.x).toBeLessThan(worldSeries.x);
  expect(worldSeries.x).toBeLessThan(nlcs.x);
  expect(alcs.y).toBe(worldSeries.y);
  await expect(
    bracket.locator(".series.world .bestof span").filter({ hasText: "World Series" }),
  ).toHaveCSS("color", GOLD);

  const divisions = bracket.locator(".box").filter({ hasText: "Division Series" });
  const upperDivision = await divisions.nth(0).boundingBox();
  const lowerDivision = await divisions.nth(1).boundingBox();
  const noteAndGap = lowerDivision.y - (upperDivision.y + upperDivision.height);
  expect(noteAndGap).toBe(80);
});

test("on a wide screen, a centered league bar spans each league's three columns", async ({
  page,
}) => {
  await page.setViewportSize(WIDE_SCREEN);
  await openApp(page);
  const bracket = page.locator("#bracketWrap");
  const findBox = (round, index) =>
    bracket.locator(".box").filter({ hasText: round }).nth(index).boundingBox();
  const al = bracket.locator(".league-head.al");
  const nl = bracket.locator(".league-head.nl");
  await expect(al).toHaveText("American League");
  await expect(nl).toHaveText("National League");
  await expect(al).toHaveCSS("text-align", "center");
  await expect(nl).toHaveCSS("text-align", "center");

  const alBar = await al.boundingBox();
  const nlBar = await nl.boundingBox();
  const alWildCard = await findBox("Wild Card", 0);
  const alcs = await findBox("Championship Series", 0);
  const nlcs = await findBox("Championship Series", 1);
  const nlWildCard = await findBox("Wild Card", 2);
  expect(alBar.y).toBe(nlBar.y);
  expect(alBar.x).toBe(alWildCard.x);
  expect(alBar.x + alBar.width).toBe(alcs.x + alcs.width);
  expect(nlBar.x).toBe(nlcs.x);
  expect(nlBar.x + nlBar.width).toBe(nlWildCard.x + nlWildCard.width);
  expect(alWildCard.y - (alBar.y + alBar.height)).toBe(18);
});

test("narrowing the window until the whole bracket can't show switches to the stacked bracket", async ({
  page,
}) => {
  await page.setViewportSize(WIDE_SCREEN);
  await openApp(page);
  const al = page.locator("#bracketWrap .league-head.al");
  const nl = page.locator("#bracketWrap .league-head.nl");
  await expect(al).toHaveCSS("text-align", "center");
  expect((await al.boundingBox()).y).toBe((await nl.boundingBox()).y);

  await page.setViewportSize(LAPTOP);

  await expect(al).toHaveCSS("text-align", "left");
  expect((await al.boundingBox()).y).toBeLessThan((await nl.boundingBox()).y);
});

test("on a laptop too narrow for the whole bracket, the stacked bracket fills down to the page's bottom space", async ({
  page,
}) => {
  await page.setViewportSize(LAPTOP);
  await openApp(page);
  await expect(page.locator("#bracketWrap .league-head")).toHaveCount(2);

  const { stageBottom, spaceBottom } = await page.evaluate(() => ({
    stageBottom: document.querySelector(".bracket-stage").getBoundingClientRect().bottom + scrollY,
    spaceBottom: innerHeight - parseFloat(getComputedStyle(document.body).paddingBottom),
  }));
  expect(spaceBottom - stageBottom).toBeGreaterThanOrEqual(0);
  expect(spaceBottom - stageBottom).toBeLessThan(8);
  expect(await readCardTops(page, "Wild Card")).toEqual(
    await readCardTops(page, "Division Series"),
  );
});

test("renders the bracket, standings and stamp from the Worker's snapshot", async ({ page }) => {
  const app = await openApp(page);

  await expect.poll(() => app.countSnapshotRequests()).toBe(1);

  const bracket = page.locator("#bracketWrap");
  for (const club of PLAYOFF_FIELD_2026) await expect(bracket).toContainText(club);
  await expect(page.locator("#banner")).toContainText("Highest still in");
  await expect(page.locator("#stamp")).toContainText("Reds @ Braves 5-5 in the 5th");

  await page.getByRole("tab", { name: "Standings" }).click();
  await expect(page.locator("#standingsWrap .div-block")).toHaveCount(8);
  await expect(page.locator("#standingsWrap")).toContainText("AL East");
  expect(await app.readDocument("seasons/2026")).toBeNull();
});

test("says when live scores can't be reached, and tries again", async ({ page }) => {
  const app = await openApp(page, { liveAvailable: false });

  await expect(page.locator("#stamp")).toContainText(
    "Couldn't reach live scores. Trying again shortly.",
  );

  await page.clock.fastForward("00:30");
  await expect.poll(() => app.countSnapshotRequests()).toBe(2);
});

test("rebuilds updates from the saved readings as the Worker adds to them", async ({ page }) => {
  const currentSnapshot = buildFixtureSnapshot(EVENING_FIXTURE);
  const earlier = createReading({ ...currentSnapshot, asOf: "2026-09-24T20:00:00Z" });
  [earlier.teams.NYY, earlier.teams.BOS] = [
    { ...earlier.teams.NYY, seed: earlier.teams.BOS.seed },
    { ...earlier.teams.BOS, seed: earlier.teams.NYY.seed },
  ];
  const part = `${currentSnapshot.slate.today.date}-01`;
  const app = await openApp(page, {
    store: {
      "seasons/2026": {
        year: 2026,
        teams: currentSnapshot.teams,
        series: currentSnapshot.series,
        projected: true,
        ranking: ["NYY", "LAD", "MIL"],
        log: [],
      },
      [`readings-2026/${part}`]: {
        id: part,
        day: currentSnapshot.slate.today.date,
        number: 1,
        start: earlier,
        changes: [],
      },
    },
  });

  const updates = page.locator("#updates");
  await expect.poll(() => app.countOpenSockets()).toBe(1);
  await expect(updates).toBeHidden();
  await app.updateFromWorker();
  await expect(updates).toContainText(/Yankees passed the .*Red Sox for the AL 4 seed/);

  app.changeSnapshots((snapshot) => {
    const { PHI, ...teams } = snapshot.teams;
    return { ...snapshot, teams: { ...teams, NYM: { ...PHI, w: 83, l: 76 } } };
  });
  await app.updateFromWorker();

  await expect(updates).toContainText(/Mets .*Phillies/);
  expect((await app.readDocument(`readings-2026/${part}`)).changes).toHaveLength(2);
});

test("switching to 2025 shows the finished bracket and its champion, and stops polling", async ({
  page,
}) => {
  const app = await openApp(page, {
    store: { "seasons/2025": { year: 2025, teams: {}, series: {}, ranking: [], log: [] } },
  });
  await expect.poll(() => app.countSnapshotRequests()).toBe(1);

  await chooseSeason(page, "2025");

  await expect(page.locator("#banner")).toContainText("World Series champions");
  await expect(page.locator("#banner")).toContainText("Dodgers");
  await expect(page.locator("#bracketWrap")).toContainText("Dodgers win the World Series");
  await expect(page.locator("#updates")).toBeHidden();

  const requestCount = app.countSnapshotRequests();
  await page.clock.fastForward("02:00:00");
  expect(app.countSnapshotRequests()).toBe(requestCount);
});

test("warns under the title when MLB stops sending a field", async ({ page }) => {
  const app = await openApp(page);
  await expect.poll(() => app.countSnapshotRequests()).toBe(1);

  app.changeSnapshots((snapshot) => ({ ...snapshot, missing: ["wildCardRank"] }));
  await page.clock.fastForward("00:30");

  await expect(page.locator("#stamp")).toContainText(
    "MLB stopped sending wildCardRank, so some details may be blank.",
  );
  await expect(page.locator("#bracketWrap")).toContainText("Dodgers");
});

test("with no field yet, the bracket says it fills in once MLB projects one", async ({ page }) => {
  await openApp(page, { liveAvailable: false });

  await expect(page.getByRole("heading", { name: "No playoff field yet" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Set the field" })).toHaveCount(0);
  await page.getByRole("tab", { name: "Ranking" }).click();
  await expect(page.locator("#rankList")).toHaveText(
    "The ranking fills in once there's a playoff field.",
  );
});

test("the bracket and standings scroll from the keyboard, even in Safari", async ({ page }) => {
  await openApp(page);
  await expect(page.getByRole("region", { name: "Bracket" })).toHaveAttribute("tabindex", "0");

  await page.getByRole("tab", { name: "Standings" }).click();
  await expect(page.getByRole("region", { name: "AL East standings" })).toHaveAttribute(
    "tabindex",
    "0",
  );
});

test("the ranking can be reordered from the keyboard, and saves", async ({ page }) => {
  const app = await openApp(page);
  await expect.poll(() => app.countSnapshotRequests()).toBe(1);
  await page.getByRole("tab", { name: "Ranking" }).click();
  await expect(page.locator("#rankList .rank-item")).toHaveCount(12);

  const firstItem = page.locator("#rankList .rank-item").first();
  const movedClubId = await firstItem.getAttribute("data-id");
  await firstItem.locator(".grip").focus();
  await page.keyboard.press("ArrowDown");

  await expect(page.locator("#rankList .rank-item").nth(1)).toHaveAttribute("data-id", movedClubId);
  await expect(page.locator("#rankList .rank-item").nth(1).locator(".grip")).toBeFocused();
  await expect
    .poll(async () => (await app.readDocument("seasons/2026"))?.ranking[1])
    .toBe(movedClubId);
});

test("a save that fails says so under the title", async ({ page }) => {
  const app = await openApp(page);
  await expect.poll(() => app.countSnapshotRequests()).toBe(1);
  app.failWrites();
  await page.getByRole("tab", { name: "Ranking" }).click();
  await expect(page.locator("#rankList .rank-item")).toHaveCount(12);

  await page.locator("#rankList .grip").first().focus();
  await page.keyboard.press("ArrowDown");

  await expect(page.locator("#stamp")).toContainText("Couldn't save your last change.");
});

test("markup in the shared store is shown as text", async ({ page }) => {
  const markup = '<img id="injected" src="x">';
  await openApp(page, {
    liveAvailable: false,
    store: {
      "seasons/2026": {
        year: 2026,
        teams: {},
        series: {},
        ranking: [],
        log: [
          { kind: "berth", team: "NYY", what: "division", div: markup, at: "2026-09-24T20:00:00Z" },
        ],
      },
    },
  });

  await expect(page.locator("#updates")).toContainText(markup);
  await expect(page.locator("#injected")).toHaveCount(0);
});

test("a stored field short a league says there's no field instead of breaking the page", async ({
  page,
}) => {
  const clubs = ["NYY", "TOR", "SEA", "BOS", "DET", "CLE", "HOU", "LAD", "MIL", "PHI", "CHC", "SD"];
  const teams = Object.fromEntries(
    clubs.map((id, index) => [id, { league: index < 7 ? "AL" : "NL", seed: (index % 6) + 1 }]),
  );
  await openApp(page, {
    liveAvailable: false,
    store: { "seasons/2026": { year: 2026, teams, series: {}, ranking: [], log: [] } },
  });

  await expect(page.getByRole("heading", { name: "No playoff field yet" })).toBeVisible();
  await page.getByRole("tab", { name: "Ranking" }).click();
  await expect(page.locator("#rankList .rank-item")).toHaveCount(12);
});

const SEASON_WITH_TWO_UPDATES = {
  year: 2026,
  teams: {},
  series: {},
  ranking: [],
  seenAt: "2026-09-24T20:00:00Z",
  log: [
    {
      kind: "elim",
      team: "SEA",
      via: [{ team: "TEX", won: true, opp: "NYM", score: [3, 1] }],
      ended: "2026-09-24T00:55:00Z",
      at: "2026-09-25T00:40:00Z",
    },
    { kind: "lock", at: "2026-09-25T00:30:00Z" },
  ],
};

test("the update list shows when a change happened, not when the page noticed it", async ({
  page,
}) => {
  await openApp(page, { liveAvailable: false, store: { "seasons/2026": SEASON_WITH_TWO_UPDATES } });

  const updateTimes = page.locator("#updates .when");
  await expect(updateTimes).toHaveCount(2);
  await expect(updateTimes.nth(0)).toHaveText(/^8:30\sPM$/);
  await expect(updateTimes.nth(1)).toHaveText(/^Yesterday$/);
  await expect(page.locator("#updates .updates-count")).toHaveText("2 updates since yesterday");
});

test("dismissing updates goes by the newest one's time, not this device's clock", async ({
  page,
}) => {
  const app = await openApp(page, {
    liveAvailable: false,
    now: "2026-09-25T03:00:00Z",
    store: { "seasons/2026": SEASON_WITH_TWO_UPDATES },
  });

  await page.getByRole("button", { name: "Dismiss updates" }).click();
  await expect(page.locator("#updates")).toBeHidden();
  await expect
    .poll(async () => (await app.readDocument("seasons/2026"))?.seenAt)
    .toBe("2026-09-25T00:40:00.000Z");
});

const ELIMINATED_AT_8_10 = (team, winner) => ({
  kind: "elim",
  team,
  via: [{ team: winner, won: true, opp: "NYM", score: [3, 1] }],
  ended: "2026-09-25T00:10:00Z",
  at: "2026-09-25T00:40:00Z",
});

test("updates that share a time show it once", async ({ page }) => {
  await openApp(page, {
    liveAvailable: false,
    store: {
      "seasons/2026": {
        ...SEASON_WITH_TWO_UPDATES,
        log: [
          ELIMINATED_AT_8_10("SEA", "TEX"),
          ELIMINATED_AT_8_10("HOU", "BOS"),
          { kind: "lock", at: "2026-09-25T00:30:00Z" },
        ],
      },
    },
  });

  await expect(page.locator("#updates .when")).toHaveText([/^8:30\sPM$/, /^8:10\sPM$/, ""]);
});

test("a clinch and the elimination it brought are one update, at the game's time", async ({
  page,
}) => {
  const rangersLoss = { team: "TEX", won: false, opp: "MIN", score: [4, 6] };
  const found = { ended: "2026-09-25T00:10:00Z", at: "2026-09-25T00:40:00Z" };
  await openApp(page, {
    liveAvailable: false,
    store: {
      "seasons/2026": {
        ...SEASON_WITH_TWO_UPDATES,
        log: [
          {
            kind: "berth",
            team: "HOU",
            what: "division",
            div: "AL West",
            via: [rangersLoss],
            ...found,
          },
          { kind: "elim", team: "TEX", via: [rangersLoss], ...found },
        ],
      },
    },
  });

  const updates = page.locator("#updates");
  await expect(updates.locator(".updates-count")).toHaveText("1 update since earlier today");
  await expect(updates.locator(".what")).toHaveText(
    "Astros clinch the AL West \u2014 Rangers eliminated with a 6-4 loss to the Twins",
  );
  await expect(updates.locator(".when")).toHaveText(/^8:10\sPM$/);
});

// The page's clock reads 8:44 PM Eastern, which is the next morning in London and Tokyo.
const LOCAL_TIMES_OF_THE_NEWER_UPDATE = {
  "Pacific/Honolulu": "2:30 PM",
  "Europe/London": "1:30 AM",
  "Asia/Tokyo": "9:30 AM",
};

for (const [timezoneId, localTime] of Object.entries(LOCAL_TIMES_OF_THE_NEWER_UPDATE)) {
  test.describe(`in ${timezoneId}`, () => {
    test.use({ timezoneId });

    test("the update list tells time and day by the viewer's own clock", async ({ page }) => {
      await openApp(page, {
        liveAvailable: false,
        store: { "seasons/2026": SEASON_WITH_TWO_UPDATES },
      });

      const updateTimes = page.locator("#updates .when");
      await expect(updateTimes).toHaveCount(2);
      await expect(updateTimes.nth(0)).toHaveText(localTime);
      await expect(updateTimes.nth(1)).toHaveText("Yesterday");
    });
  });
}

const buildEmptySeasonSnapshot = (season, springStart) => ({
  ...buildFixtureSnapshot(EVENING_FIXTURE),
  season,
  springStart,
  projected: true,
  teams: {},
  series: {},
  log: [],
  standings: { divisions: {} },
  slate: null,
});

test("the new season starts on the day spring training does", async ({ page }) => {
  await openApp(page, {
    now: "2027-02-19T15:00:00Z",
    snapshots: { 2027: buildEmptySeasonSnapshot(2027, "2027-02-19") },
  });

  await expect(page.locator("#yearSel")).toHaveValue("2027");
  await expect(page.getByRole("heading", { name: "No playoff field yet" })).toBeVisible();
});

test("a page left open turns over when spring training starts", async ({ page }) => {
  const app = await openApp(page, {
    now: "2027-02-19T04:30:00Z",
    snapshots: { 2027: buildEmptySeasonSnapshot(2027, "2027-02-19") },
  });
  // Startup's own spring check requests a snapshot after setting the hourly timer, so the clock
  // can't jump ahead before the timer exists.
  await expect.poll(() => app.countSnapshotRequests()).toBeGreaterThanOrEqual(2);
  await expect(page.locator("#yearSel")).toHaveValue("2026");

  // 11:30 PM Eastern the night before; the hourly check runs after midnight.
  await page.clock.fastForward("01:00:00");

  await expect(page.locator("#yearSel")).toHaveValue("2027");
});

test("until spring training starts, the latest season is last year's", async ({ page }) => {
  const app = await openApp(page, {
    now: "2027-02-18T15:00:00Z",
    snapshots: { 2027: buildEmptySeasonSnapshot(2027, "2027-02-19") },
  });

  await expect.poll(() => app.countSnapshotRequests()).toBeGreaterThanOrEqual(2);
  await expect(page.locator("#yearSel")).toHaveValue("2026");
});

test("on a phone, the tabs float at the bottom and stay there while the page scrolls", async ({
  page,
}) => {
  await page.setViewportSize(PHONE);
  await openApp(page);
  const bar = page.locator("#tabBar");
  const resting = await bar.boundingBox();
  const gapBelow = PHONE.height - (resting.y + resting.height);
  expect(gapBelow).toBeGreaterThanOrEqual(16);
  expect(gapBelow).toBeLessThan(32);

  await page.getByRole("tab", { name: "Standings" }).click();
  await expect(page.getByRole("tab", { name: "Standings" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(page.locator("#view-standings")).toBeVisible();

  await page.mouse.wheel(0, 800);
  await expect
    .poll(() => bar.boundingBox().then((box) => Math.round(box.y)))
    .toBe(Math.round(resting.y));
});

test("on a phone, dragging along the tab bar picks the tab it's released on", async ({ page }) => {
  await page.setViewportSize(PHONE);
  await openApp(page);
  const from = await page.getByRole("tab", { name: "Bracket" }).boundingBox();
  const to = await page.getByRole("tab", { name: "Ranking" }).boundingBox();

  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 8 });
  await page.mouse.up();

  await expect(page.getByRole("tab", { name: "Ranking" })).toHaveAttribute("aria-selected", "true");
  await expect(page.locator("#view-ranking")).toBeVisible();
});

test("on a phone, a screen reader's bare click still switches tabs", async ({ page }) => {
  await page.setViewportSize(PHONE);
  await openApp(page);

  await page.getByRole("tab", { name: "Games" }).dispatchEvent("click", { detail: 1 });

  await expect(page.getByRole("tab", { name: "Games" })).toHaveAttribute("aria-selected", "true");
  await expect(page.locator("#view-games")).toBeVisible();
});

test("on a phone, even a page shorter than the screen can scroll", async ({ page }) => {
  await page.setViewportSize(PHONE);
  await openApp(page);
  await expect(page.locator("#view-bracket")).toBeVisible();

  const { scrollHeight, clientHeight } = await page.evaluate(() => ({
    scrollHeight: document.scrollingElement.scrollHeight,
    clientHeight: document.scrollingElement.clientHeight,
  }));
  expect(scrollHeight).toBeGreaterThan(clientHeight);
});

test("on a phone, tapping the tab that's showing scrolls back to the top", async ({ page }) => {
  await page.setViewportSize(PHONE);
  await openApp(page);
  await page.getByRole("tab", { name: "Standings" }).click();
  await page.mouse.wheel(0, 800);
  await expect.poll(() => page.evaluate(() => scrollY)).toBeGreaterThan(0);

  await page.getByRole("tab", { name: "Standings" }).click();

  await expect.poll(() => page.evaluate(() => scrollY)).toBe(0);
  await expect(page.locator("#view-standings")).toBeVisible();
});

test("on a phone, dragging back to the tab that's showing leaves the page where it is", async ({
  page,
}) => {
  await page.setViewportSize(PHONE);
  await openApp(page);
  await page.mouse.wheel(0, 800);
  await expect.poll(() => page.evaluate(() => scrollY)).toBeGreaterThan(0);
  const scrolled = await page.evaluate(() => scrollY);
  const from = await page.getByRole("tab", { name: "Bracket" }).boundingBox();
  const to = await page.getByRole("tab", { name: "Ranking" }).boundingBox();

  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 8 });
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(700);

  expect(await page.evaluate(() => scrollY)).toBe(scrolled);
});

const readBracketFit = (page) =>
  page.evaluate(() => {
    const scroller = document.querySelector(".tree-scroll");
    const stage = document.querySelector(".bracket-stage").getBoundingClientRect();
    return {
      stageBottom: stage.bottom + scrollY,
      lowestNoteBottom: Math.max(
        ...[...document.querySelectorAll(".card-note")].map(
          (note) => note.getBoundingClientRect().bottom + scrollY,
        ),
      ),
      tabBarTop: document.getElementById("tabBar").getBoundingClientRect().top,
      scrollLeft: scroller.scrollLeft,
      bracketOverflow: scroller.scrollWidth - scroller.clientWidth,
      pageOverflow: document.scrollingElement.scrollWidth - document.scrollingElement.clientWidth,
    };
  });

const expectBracketToFillHeight = async (page) => {
  await expect
    .poll(async () => {
      const { stageBottom, tabBarTop } = await readBracketFit(page);
      return tabBarTop - stageBottom;
    })
    .toBeGreaterThanOrEqual(14);
  const { stageBottom, lowestNoteBottom, tabBarTop } = await readBracketFit(page);
  expect(tabBarTop - stageBottom).toBeLessThan(22);
  expect(stageBottom - lowestNoteBottom).toBeLessThan(4);
};

test("on a phone, the bracket fills the height above the tab bar and swipes sideways", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 900 });
  await openApp(page);
  await expect(page.locator(".bracket-stage")).toBeVisible();
  await expectBracketToFillHeight(page);
  const { bracketOverflow, pageOverflow } = await readBracketFit(page);
  expect(bracketOverflow).toBeGreaterThan(0);
  expect(pageOverflow).toBe(0);
});

test("on a phone, the bracket redraws for a new screen height and keeps its sideways scroll", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 960 });
  await openApp(page);
  await expect(page.locator(".bracket-stage")).toBeVisible();
  await page.locator(".tree-scroll").evaluate((scroller) => (scroller.scrollLeft = 300));
  await page.waitForTimeout(300);
  const { scrollLeft } = await readBracketFit(page);
  expect(scrollLeft).toBeGreaterThan(0);

  await page.setViewportSize({ width: 390, height: 900 });

  await expectBracketToFillHeight(page);
  expect((await readBracketFit(page)).scrollLeft).toBe(scrollLeft);
});

test("on a phone, a bracket drawn while another tab showed fills the height once shown", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 900 });
  await openApp(page);
  await page.getByRole("tab", { name: "Standings" }).click();
  await page.reload();
  await expect(page.locator("#view-standings")).toBeVisible();

  await page.getByRole("tab", { name: "Bracket" }).click();

  await expect(page.locator(".bracket-stage")).toBeVisible();
  await expectBracketToFillHeight(page);
});

test("clicking the tab that's showing scrolls back to the top", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 500 });
  await openApp(page);
  await expect(page.locator("#bracketWrap")).toContainText("Dodgers");
  await page.mouse.wheel(0, 800);
  await expect.poll(() => page.evaluate(() => scrollY)).toBeGreaterThan(0);

  await page.getByRole("tab", { name: "Bracket" }).dispatchEvent("click");

  await expect.poll(() => page.evaluate(() => scrollY)).toBe(0);
});

test("the page reopens on the tab it was last on", async ({ page }) => {
  await page.setViewportSize(PHONE);
  await openApp(page);
  await page.getByRole("tab", { name: "Standings" }).click();

  await page.reload();

  await expect(page.getByRole("tab", { name: "Standings" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(page.locator("#view-standings")).toBeVisible();
  await expect(page.locator("#view-bracket")).toBeHidden();
});
