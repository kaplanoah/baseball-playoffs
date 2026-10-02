import { test, expect, openLockedApp } from "./harness.mjs";
import { listOffScaleText } from "../../../../tests/browser/type-scale.mjs";

/** @param {import("@playwright/test").Page} page */
const findCodeField = (page) => page.getByRole("textbox", { name: "Access code" });

/** @param {import("@playwright/test").Page} page */
const findGate = (page) => page.getByRole("heading", { name: "Enter your access code" });

/**
 * @param {import("@playwright/test").Page} page
 * @param {string} code
 */
async function sendCode(page, code) {
  await findCodeField(page).fill(code);
  await page.getByRole("button", { name: "Open" }).click();
}

test("the gate's text keeps to the type scale", async ({ page }) => {
  await openLockedApp(page, { accessCode: "FASTBREAK" });
  await expect(findGate(page)).toBeVisible();
  expect(await listOffScaleText(page)).toEqual([]);
});

test("the page asks for its code in baseball's gold and copper, and the right one opens the app for good", async ({
  page,
}) => {
  await openLockedApp(page, { accessCode: "FASTBALL" });
  await expect(findGate(page)).toBeVisible();
  await expect(page.getByRole("tab", { name: "Standings" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Open" })).toHaveCSS(
    "background-color",
    "rgb(244, 193, 92)",
  );

  await sendCode(page, "curveball");
  await expect(page.getByRole("alert")).toHaveText(
    "That code isn't right. Check it and try again.",
  );
  await expect(page.getByRole("alert")).toHaveCSS("color", "rgb(205, 149, 102)");

  await sendCode(page, "fast ball");
  await expect(page.getByRole("tab", { name: "Standings" })).toBeVisible();

  await page.reload();
  await expect(page.getByRole("tab", { name: "Standings" })).toBeVisible();
  await expect(findGate(page)).toHaveCount(0);
});

test("a new code signs the phone out, and the gate says the code has changed", async ({ page }) => {
  const app = await openLockedApp(page, { accessCode: "FASTBALL" });
  await sendCode(page, "FASTBALL");
  await expect(page.getByRole("tab", { name: "Standings" })).toBeVisible();

  await page.goto("about:blank");
  app.changeAccessCode("SLIDER");
  await page.goBack();
  await expect(findGate(page)).toBeVisible();
  await expect(page.getByRole("alert")).toHaveText(
    "The code has changed. Ask whoever sent you the link for the new one.",
  );
});
