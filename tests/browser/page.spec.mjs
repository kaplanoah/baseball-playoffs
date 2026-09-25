import { test, expect, openApp, buildFixtureSnapshot, EVENING_FIXTURE } from "./harness.mjs";

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

test("falls back to the connector and renders the bracket, standings and stamp", async ({
  page,
}) => {
  const app = await openApp(page);

  await expect
    .poll(() => app.readDocument("live/status"))
    .toMatchObject({ source: "connector", error: "", write: "" });
  expect(app.countMlbRequests()).toBeGreaterThan(0);
  expect(await app.countToolCalls()).toBe(1);

  const bracket = page.locator("#bracketWrap");
  for (const club of PLAYOFF_FIELD_2026) await expect(bracket).toContainText(club);
  await expect(page.locator("#banner")).toContainText("Highest still in");
  await expect(page.locator("#stamp")).toContainText("Reds @ Braves 5-5 in the 5th");

  await page.getByRole("tab", { name: "Standings" }).click();
  await expect(page.locator("#standingsWrap .div-block")).toHaveCount(8);
  await expect(page.locator("#standingsWrap")).toContainText("AL East");

  const season = await app.readDocument("seasons/2026");
  expect(Object.keys(season.teams)).toHaveLength(12);
  expect(await app.readDocument("standings/2026")).toHaveProperty("divisions");
});

test("fetches MLB directly when the page is allowed to", async ({ page }) => {
  const app = await openApp(page, { directAllowed: true });

  await expect
    .poll(() => app.readDocument("live/status"))
    .toMatchObject({ source: "direct", error: "" });
  expect(await app.countToolCalls()).toBe(0);
  await expect(page.locator("#stamp")).toContainText("Reds @ Braves 5-5 in the 5th");
});

test("says how to add the connector when it isn't added, and doesn't retry by itself", async ({
  page,
}) => {
  const app = await openApp(page, { connectorAdded: false });

  await expect(page.locator("#stamp")).toContainText(
    "Live scores need the MLB Live connector: add it in claude.ai's connector settings.",
  );
  await expect
    .poll(() => app.readDocument("live/status"))
    .toMatchObject({ source: "connector", error: "server_not_connected" });

  await page.clock.fastForward("10:00");
  expect(await app.countToolCalls()).toBe(1);
});

test("logs changes against the stored documents across snapshots", async ({ page }) => {
  const currentSnapshot = buildFixtureSnapshot(EVENING_FIXTURE);
  const earlierTeams = structuredClone(currentSnapshot.teams);
  [earlierTeams.NYY.seed, earlierTeams.BOS.seed] = [earlierTeams.BOS.seed, earlierTeams.NYY.seed];
  const app = await openApp(page, {
    store: {
      "seasons/2026": {
        year: 2026,
        teams: earlierTeams,
        series: currentSnapshot.series,
        projected: true,
        ranking: ["NYY", "LAD", "MIL"],
        log: [],
      },
      "standings/2026": { ...currentSnapshot.standings, updatedAt: "2026-09-24T20:00:00Z" },
    },
  });

  const updates = page.locator("#updates");
  await expect(updates).toContainText(/Yankees passed the .*Red Sox for the AL 4 seed/);

  await page.evaluate(() => {
    window.__runtime.transformSnapshot = (snapshot) => {
      const { PHI, ...teams } = snapshot.teams;
      return { ...snapshot, teams: { ...teams, NYM: { ...PHI, w: 83, l: 76 } } };
    };
  });
  // A game is live, so the next poll is thirty seconds out.
  await page.clock.fastForward("00:30");

  await expect(updates).toContainText(/Mets .*Phillies/);
  await expect
    .poll(async () => (await app.readDocument("seasons/2026")).log.map((entry) => entry.kind))
    .toEqual(["seed", "field"]);
  const season = await app.readDocument("seasons/2026");
  expect(season.teams).toHaveProperty("NYM");
  expect(season.teams).not.toHaveProperty("PHI");
  expect(season.ranking).toEqual(["NYY", "LAD", "MIL"]);
  expect(await app.readDocument("live/status")).toMatchObject({ error: "", write: "" });
});

test("switching to 2025 shows the finished bracket and its champion, and stops polling", async ({
  page,
}) => {
  const app = await openApp(page, {
    store: { "seasons/2025": { year: 2025, teams: {}, series: {}, ranking: [], log: [] } },
  });
  await expect.poll(() => app.readDocument("live/status")).toMatchObject({ error: "" });

  await page.locator("#yearSel").selectOption("2025");

  await expect(page.locator("#banner")).toContainText("World Series champions");
  await expect(page.locator("#banner")).toContainText("Dodgers");
  await expect(page.locator("#bracketWrap")).toContainText("Dodgers win the World Series");
  await expect(page.locator("#updates")).toBeHidden();
  await expect.poll(() => app.readDocument("seasons/2025")).toMatchObject({ projected: false });

  const toolCallCount = await app.countToolCalls();
  await page.clock.fastForward("02:00:00");
  expect(await app.countToolCalls()).toBe(toolCallCount);
});

test("warns under the title when MLB stops sending a field", async ({ page }) => {
  const app = await openApp(page);
  await expect.poll(() => app.readDocument("live/status")).toMatchObject({ error: "" });

  await page.evaluate(() => {
    window.__runtime.transformSnapshot = (snapshot) => ({ ...snapshot, missing: ["wildCardRank"] });
  });
  await page.clock.fastForward("00:30");

  await expect(page.locator("#stamp")).toContainText(
    "MLB stopped sending wildCardRank, so some details may be blank.",
  );
  await expect(page.locator("#bracketWrap")).toContainText("Dodgers");
  await expect
    .poll(() => app.readDocument("live/status"))
    .toMatchObject({ error: "mlb_fields_missing", detail: "wildCardRank" });
});

test("setting the field by hand says what's missing instead of saving", async ({ page }) => {
  await openApp(page, { connectorAdded: false });

  await page.getByRole("button", { name: "Set the field" }).click();
  await page.getByRole("button", { name: "Save field" }).click();

  await expect(page.getByRole("alert")).toHaveText(
    "Assign all 6 seeds in both the AL and the NL before saving.",
  );
  await expect(page.getByRole("dialog", { name: "Set the playoff field" })).toBeVisible();
});

test("switching years works without a store", async ({ page }) => {
  await openApp(page, { dbAvailable: false });
  await expect(page.locator("#bracketWrap")).toContainText("Dodgers");

  await page.locator("#yearSel").selectOption("2025");

  await expect(page.locator("#bracketWrap")).toContainText("Dodgers win the World Series");
});

test("the ranking can be reordered from the keyboard, and saves", async ({ page }) => {
  const app = await openApp(page);
  await expect.poll(() => app.readDocument("live/status")).toMatchObject({ error: "" });
  await page.getByRole("tab", { name: "Ranking" }).click();

  const firstItem = page.locator("#rankList .rank-item").first();
  const movedClubId = await firstItem.getAttribute("data-id");
  await firstItem.locator(".grip").focus();
  await page.keyboard.press("ArrowDown");

  await expect(page.locator("#rankList .rank-item").nth(1)).toHaveAttribute("data-id", movedClubId);
  await expect(page.locator("#rankList .rank-item").nth(1).locator(".grip")).toBeFocused();
  await expect
    .poll(async () => (await app.readDocument("seasons/2026")).ranking[1])
    .toBe(movedClubId);
});

test("a save that fails says so under the title", async ({ page }) => {
  const app = await openApp(page);
  await expect.poll(() => app.readDocument("live/status")).toMatchObject({ error: "" });
  await page.evaluate(() => (window.__runtime.failWrites = true));
  await page.getByRole("tab", { name: "Ranking" }).click();

  await page.locator("#rankList .grip").first().focus();
  await page.keyboard.press("ArrowDown");

  await expect(page.locator("#stamp")).toContainText("Couldn't save your last change.");
});

test("markup in the shared store is shown as text", async ({ page }) => {
  const markup = '<img id="injected" src="x">';
  await openApp(page, {
    connectorAdded: false,
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

test("the field setup dialog closes with Escape", async ({ page }) => {
  await openApp(page, { connectorAdded: false });

  await page.getByRole("button", { name: "Set the field" }).click();
  const dialog = page.getByRole("dialog", { name: "Set the playoff field" });
  await expect(dialog).toBeVisible();
  await page.keyboard.press("Escape");

  await expect(dialog).toBeHidden();
});

test("the update list shows when a change happened, not when the page noticed it", async ({
  page,
}) => {
  await openApp(page, {
    connectorAdded: false,
    store: {
      "seasons/2026": {
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
      },
    },
  });

  const updateTimes = page.locator("#updates .when");
  await expect(updateTimes).toHaveCount(2);
  await expect(updateTimes.nth(0)).toHaveText(/^8:30\sPM$/);
  await expect(updateTimes.nth(1)).toHaveText(/^Yesterday$/);
  await expect(page.locator("#updates .updates-count")).toHaveText("2 updates since yesterday");
});

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
    extraSnapshots: { 2027: buildEmptySeasonSnapshot(2027, "2027-02-19") },
  });

  await expect(page.locator("#yearSel")).toHaveValue("2027");
  await expect(page.getByRole("button", { name: "Set the field" })).toBeVisible();
});

test("until spring training starts, the latest season is last year's", async ({ page }) => {
  const app = await openApp(page, {
    now: "2027-02-18T15:00:00Z",
    extraSnapshots: { 2027: buildEmptySeasonSnapshot(2027, "2027-02-19") },
  });

  await expect.poll(() => app.countToolCalls()).toBeGreaterThanOrEqual(2);
  await expect(page.locator("#yearSel")).toHaveValue("2026");
});
