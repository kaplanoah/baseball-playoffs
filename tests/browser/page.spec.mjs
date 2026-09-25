import { test, expect, openApp, buildFixtureSnapshot, EVENING } from "./harness.mjs";

const FIELD_2026 = [
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
    .poll(() => app.read("live/status"))
    .toMatchObject({ source: "connector", error: "", write: "" });
  expect(app.countMlbRequests()).toBeGreaterThan(0);
  expect(await app.countToolCalls()).toBe(1);

  const bracket = page.locator("#bracketWrap");
  for (const club of FIELD_2026) await expect(bracket).toContainText(club);
  await expect(page.locator("#banner")).toContainText("Highest still in");
  await expect(page.locator("#stamp")).toContainText("Reds @ Braves 5-5 in the 5th");

  await page.getByRole("button", { name: "Standings" }).click();
  await expect(page.locator("#standingsWrap .div-block")).toHaveCount(8);
  await expect(page.locator("#standingsWrap")).toContainText("AL East");

  const season = await app.read("seasons/2026");
  expect(Object.keys(season.teams)).toHaveLength(12);
  expect(await app.read("standings/2026")).toHaveProperty("divisions");
});

test("fetches MLB directly when the page is allowed to", async ({ page }) => {
  const app = await openApp(page, { directAllowed: true });

  await expect.poll(() => app.read("live/status")).toMatchObject({ source: "direct", error: "" });
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
    .poll(() => app.read("live/status"))
    .toMatchObject({ source: "connector", error: "server_not_connected" });

  await page.clock.fastForward("10:00");
  expect(await app.countToolCalls()).toBe(1);
});

test("logs changes against the stored documents across snapshots", async ({ page }) => {
  const current = buildFixtureSnapshot(EVENING);
  const earlier = structuredClone(current.teams);
  [earlier.NYY.seed, earlier.BOS.seed] = [earlier.BOS.seed, earlier.NYY.seed];
  const app = await openApp(page, {
    store: {
      "seasons/2026": {
        year: 2026,
        teams: earlier,
        series: current.series,
        projected: true,
        ranking: ["NYY", "LAD", "MIL"],
        log: [],
      },
      "standings/2026": { ...current.standings, updatedAt: "2026-09-24T20:00:00Z" },
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
    .poll(async () => (await app.read("seasons/2026")).log.map((entry) => entry.kind))
    .toEqual(["seed", "field"]);
  const season = await app.read("seasons/2026");
  expect(season.teams).toHaveProperty("NYM");
  expect(season.teams).not.toHaveProperty("PHI");
  expect(season.ranking).toEqual(["NYY", "LAD", "MIL"]);
  expect(await app.read("live/status")).toMatchObject({ error: "", write: "" });
});

test("switching to 2025 shows the finished bracket and its champion, and stops polling", async ({
  page,
}) => {
  const app = await openApp(page, {
    store: { "seasons/2025": { year: 2025, teams: {}, series: {}, ranking: [], log: [] } },
  });
  await expect.poll(() => app.read("live/status")).toMatchObject({ error: "" });

  await page.locator("#yearSel").selectOption("2025");

  await expect(page.locator("#banner")).toContainText("World Series champions");
  await expect(page.locator("#banner")).toContainText("Dodgers");
  await expect(page.locator("#bracketWrap")).toContainText("Dodgers win the World Series");
  await expect(page.locator("#updates")).toBeHidden();
  await expect.poll(() => app.read("seasons/2025")).toMatchObject({ projected: false });

  const calls = await app.countToolCalls();
  await page.clock.fastForward("02:00:00");
  expect(await app.countToolCalls()).toBe(calls);
});

test("warns under the title when MLB stops sending a field", async ({ page }) => {
  const app = await openApp(page);
  await expect.poll(() => app.read("live/status")).toMatchObject({ error: "" });

  await page.evaluate(() => {
    window.__runtime.transformSnapshot = (snapshot) => ({ ...snapshot, missing: ["wildCardRank"] });
  });
  await page.clock.fastForward("00:30");

  await expect(page.locator("#stamp")).toContainText(
    "MLB stopped sending wildCardRank, so some details may be blank.",
  );
  await expect(page.locator("#bracketWrap")).toContainText("Dodgers");
  await expect
    .poll(() => app.read("live/status"))
    .toMatchObject({ error: "mlb_fields_missing", detail: "wildCardRank" });
});

test("setting the field by hand says what's missing instead of saving", async ({ page }) => {
  await openApp(page, { connectorAdded: false });

  await page.getByRole("button", { name: "Set the field" }).click();
  await page.getByRole("button", { name: "Save field" }).click();

  await expect(page.getByRole("alert")).toHaveText(
    "Assign all 6 seeds in both the AL and the NL before saving.",
  );
  await expect(page.locator("#setupModalBg")).toBeVisible();
});
