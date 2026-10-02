import { test, expect, openLockedApp } from "./harness.mjs";

/** @param {import("@playwright/test").Page} page */
const findCodeField = (page) => page.getByRole("textbox", { name: "Access code" });

/**
 * @param {import("@playwright/test").Page} page
 * @param {string} code
 */
async function sendCode(page, code) {
  await findCodeField(page).fill(code);
  await page.getByRole("button", { name: "Open" }).click();
}

/**
 * Sends the right code, and waits for the app to draw the season it reads.
 * @param {import("@playwright/test").Page} page
 */
async function signIn(page) {
  await sendCode(page, "FASTBREAK");
  await expect(page.locator("#bracketWrap .series").first()).toBeVisible();
}

/** @param {import("@playwright/test").Page} page */
const findGate = (page) => page.getByRole("heading", { name: "Enter your access code" });

test("the page asks for its code, and the right one, however it's typed, opens the app for good", async ({
  page,
}) => {
  await openLockedApp(page, { accessCode: "FASTBREAK" });
  await expect(findGate(page)).toBeVisible();
  await expect(page.getByRole("tab", { name: "Bracket" })).toHaveCount(0);

  await page.getByRole("button", { name: "Open" }).click();
  await expect(page.getByRole("alert")).toHaveText("Type the code first.");

  await sendCode(page, "fastbrake");
  await expect(page.getByRole("alert")).toHaveText(
    "That code isn't right. Check it and try again.",
  );
  await expect(findCodeField(page)).toHaveValue("fastbrake");
  await findCodeField(page).fill("fastbreak");
  await expect(page.getByRole("alert")).toHaveText("");

  await findCodeField(page).fill("fast break");
  await findCodeField(page).press("Enter");
  await expect(page.getByRole("tab", { name: "Bracket" })).toBeVisible();

  await page.reload();
  await expect(page.getByRole("tab", { name: "Bracket" })).toBeVisible();
  await expect(findGate(page)).toHaveCount(0);
});

test("a new code signs the phone out, and the gate says the code has changed", async ({ page }) => {
  const app = await openLockedApp(page, { accessCode: "FASTBREAK" });
  await signIn(page);

  await page.goto("about:blank");
  app.changeAccessCode("LAYUP");
  await page.goBack();
  await expect(findGate(page)).toBeVisible();
  await expect(page.getByRole("alert")).toHaveText(
    "The code has changed. Ask whoever sent you the link for the new one.",
  );
  await sendCode(page, "layup");
  await expect(page.getByRole("tab", { name: "Bracket" })).toBeVisible();
});

test("a page left open when the code changes goes back to the gate on its next read", async ({
  page,
}) => {
  const app = await openLockedApp(page, { accessCode: "FASTBREAK" });
  await signIn(page);
  await page.getByRole("tab", { name: "Games" }).click();
  await page.getByRole("tab", { name: "Previous" }).click();

  app.changeAccessCode("LAYUP");
  await page.locator("#games-previous").getByRole("button").first().click();
  await expect(findGate(page)).toBeVisible();
});

test("too many tries ask the phone to wait, even with the right code", async ({ page }) => {
  const app = await openLockedApp(page, { accessCode: "FASTBREAK" });
  app.limitTries();
  await sendCode(page, "FASTBREAK");
  await expect(page.getByRole("alert")).toHaveText("Too many tries. Try again in a minute.");
  await expect(findGate(page)).toBeVisible();
  await expect(page.getByRole("button", { name: "Open" })).toBeEnabled();
});

/**
 * How far the icon sits below the top of the screen, and Open above its bottom.
 * @param {import("@playwright/test").Page} page
 */
async function measureGateMargins(page) {
  const icon = await page.locator(".gate-icon:visible").boundingBox();
  const open = await page.getByRole("button", { name: "Open" }).boundingBox();
  const height = page.viewportSize()?.height ?? 0;
  return {
    above: Math.round(icon?.y ?? 0),
    below: Math.round(height - (open?.y ?? 0) - (open?.height ?? 0)),
  };
}

test("the gate sits in the middle of a short screen, and a message doesn't move it", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 500 });
  await openLockedApp(page, { accessCode: "FASTBREAK" });
  const margins = await measureGateMargins(page);
  expect(Math.abs(margins.above - margins.below)).toBeLessThanOrEqual(1);

  await sendCode(page, "fastbrake");
  await expect(page.getByRole("alert")).toHaveText(
    "That code isn't right. Check it and try again.",
  );
  expect(await measureGateMargins(page)).toEqual(margins);
});

test("the code field shows it's ready with its cursor, not an outline", async ({ page }) => {
  await openLockedApp(page, { accessCode: "FASTBREAK" });
  await findCodeField(page).focus();
  await expect(findCodeField(page)).toHaveCSS("outline-style", "none");
});
