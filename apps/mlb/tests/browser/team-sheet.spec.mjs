import { test, expect, openApp, openSettings, buildSnapshotWithStarters } from "./harness.mjs";

test.use({ contextOptions: { reducedMotion: "reduce" } });

const ASTROS_AT_ATHLETICS = "Pitching matchup: Blubaugh vs Springs";

/** @param {import("@playwright/test").Page} page */
async function showGames(page) {
  await openApp(page, { snapshots: { 2026: buildSnapshotWithStarters() } });
  await page.getByRole("tab", { name: "Games" }).click();
  return page.getByRole("button", { name: ASTROS_AT_ATHLETICS });
}

test("a club's name in a game's row opens its sheet, and the rest of the row opens the matchup", async ({
  page,
}) => {
  const gameButton = await showGames(page);
  const row = gameButton.locator("xpath=..");
  const astros = row.getByRole("button", { name: "Team details: Astros" });
  const astrosBox = await astros.boundingBox();
  const awaySideBox = await row.locator(".game-side.away").boundingBox();
  expect(astrosBox.width).toBeLessThan(awaySideBox.width);

  await astros.click();
  const teamSheet = page.locator("#teamDialog");
  await expect(teamSheet.locator("#teamTitle")).toHaveText("Astros");
  await expect(teamSheet.locator("#teamNote")).toContainText("AL West");
  await expect(page.locator("#matchupDialog")).toBeHidden();
  await teamSheet.getByRole("button", { name: "Done" }).click();
  await expect(teamSheet).toBeHidden();

  await gameButton.click();
  await expect(page.locator("#matchupDialog")).toBeVisible();
  await expect(teamSheet).toBeHidden();
});

test("a club's name in the matchup opens its sheet over it, and Done goes back to the matchup", async ({
  page,
}) => {
  await (await showGames(page)).click();
  const matchup = page.locator("#matchupDialog");
  await matchup.getByRole("button", { name: "Team details: Athletics" }).click();
  const teamSheet = page.locator("#teamDialog");

  await expect(teamSheet.locator("#teamTitle")).toHaveText("Athletics");
  await teamSheet.getByRole("button", { name: "Done" }).click();
  await expect(teamSheet).toBeHidden();
  await expect(matchup).toBeVisible();
});

test("a club's row in the standings opens its sheet, with its race and titles, and Done closes it", async ({
  page,
}) => {
  await openApp(page);
  await page.getByRole("tab", { name: "Standings" }).click();
  await page.locator('.div-grid tr[data-team="SEA"] td.mid').first().click();
  const sheet = page.locator("#teamDialog");

  await expect(sheet.locator("#teamTitle")).toHaveText(/Mariners/);
  await expect(sheet.locator(".sheet-part h3")).toHaveText(["Season", "Titles"]);
  await expect(sheet.locator(".team-stat .team-label").first()).toHaveText("AL West");
  await expect(sheet.locator(".team-detail .team-label")).toHaveText("Next");
  await expect(sheet.locator(".team-titles")).toHaveText("None yet");
  await expect(sheet).toContainText("Since 1977");

  await sheet.getByRole("button", { name: "Done" }).click();
  await expect(sheet).toBeHidden();
});

test("a club in the bracket opens its sheet", async ({ page }) => {
  await openApp(page);
  const club = page.locator("#bracketWrap .team-id .team-open").first();
  const name = await club.locator(".team-name").textContent();
  await club.click();

  await expect(page.locator("#teamDialog #teamTitle")).toHaveText(new RegExp(name));
});

test("a club in the ranking stays a handle to drag, not a way to its sheet", async ({ page }) => {
  await openApp(page);
  await openSettings(page);
  const firstClub = page.locator("#rankList .rank-item .club").first();
  await expect(firstClub).toBeVisible();

  await expect(page.locator("#rankList .team-open")).toHaveCount(0);
  await firstClub.click();
  await expect(page.locator("#teamDialog")).toBeHidden();
});

test("a club's sheet title is its dot and name, in the page's own type, not in capitals, over gold part titles and green labels", async ({
  page,
}) => {
  await openApp(page);
  await page.getByRole("tab", { name: "Standings" }).click();
  await page.locator('.div-grid tr[data-team="SEA"] .team-open').click();
  const title = page.locator("#teamDialog #teamTitle");

  await expect(title.locator(".dot")).toBeVisible();
  await expect(title).toHaveCSS("font-family", /^"Chivo Mono"/);
  await expect(title).toHaveCSS("text-transform", "none");
  await expect(page.locator("#teamDialog .sheet-part h3").first()).toHaveCSS(
    "color",
    "rgb(244, 193, 92)",
  );
  await expect(page.locator("#teamDialog .team-detail .team-label")).toHaveCSS(
    "color",
    "rgb(127, 168, 143)",
  );
});

test("a page last left on the Teams tab, which it no longer has, opens on the bracket", async ({
  page,
}) => {
  await page.addInitScript(() => localStorage.setItem("lastTab", "reference"));
  await openApp(page);

  await expect(page.getByRole("tab", { name: "Bracket" })).toHaveAttribute("aria-selected", "true");
  await expect(page.locator("#view-bracket")).toBeVisible();
});
