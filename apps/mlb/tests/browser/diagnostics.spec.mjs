import { test, expect, openApp, openSettings } from "./harness.mjs";

test.use({ contextOptions: { reducedMotion: "reduce" } });

const PHONE = { width: 390, height: 844 };
const WIDE = { width: 1280, height: 800 };
const RECORD_MS = 5000;

/** @param {import("@playwright/test").Page} page */
const findSwitch = (page) => page.getByRole("switch", { name: "Diagnostics" });

/**
 * @param {import("@playwright/test").Page} page
 * @param {number} distance
 */
async function scrollSettings(page, distance) {
  const settings = page.locator("#settingsDialog");
  await settings.evaluate((dialog) =>
    dialog.addEventListener("scrollend", () => dialog.setAttribute("data-scrolled", ""), {
      once: true,
    }),
  );
  await page.mouse.wheel(0, distance);
  await expect(settings).toHaveAttribute("data-scrolled");
  await settings.evaluate((dialog) => dialog.removeAttribute("data-scrolled"));
}

test("on a phone, Diagnostics sit past the copyright, a scroll beyond where settings rest, off", async ({
  page,
}) => {
  await page.setViewportSize(PHONE);
  await openApp(page);
  await openSettings(page);
  await page.mouse.move(PHONE.width / 2, PHONE.height / 2);

  const copyright = page.getByText("\u00a9 2026 Noah Kaplan");
  const copyrightBottom = await copyright.evaluate((line) => line.getBoundingClientRect().bottom);

  await scrollSettings(page, copyrightBottom - PHONE.height + 40);
  await expect(copyright).toBeInViewport({ ratio: 1 });
  await expect(findSwitch(page)).not.toBeInViewport();

  await scrollSettings(page, 2000);
  await expect(findSwitch(page)).toBeInViewport();
  await expect(findSwitch(page)).toHaveAttribute("aria-checked", "false");
  await expect(page.locator("#diagnostics")).toBeHidden();
});

test("on a wide screen, Diagnostics sit under the settings and ranking, a scroll away", async ({
  page,
}) => {
  await page.setViewportSize(WIDE);
  await openApp(page);
  await openSettings(page);
  await expect(page.locator(".rank-frame")).toBeInViewport();
  await expect(findSwitch(page)).not.toBeInViewport();
  await page.mouse.move(WIDE.width / 2, WIDE.height / 2);

  await scrollSettings(page, 600);

  await expect(findSwitch(page)).toBeInViewport();
});

test("with Diagnostics on, a reload is recorded with what the store sent", async ({ page }) => {
  await page.setViewportSize(WIDE);
  await openApp(page);
  await openSettings(page);
  await findSwitch(page).click();
  await expect(page.locator("#diagnostics")).toContainText("Nothing yet");

  await page.reload();
  await expect(page.locator("#bracketWrap")).toContainText("Phillies");
  await page.clock.runFor(RECORD_MS + 1000);
  await openSettings(page);

  const record = page.locator("#diagnostics .diagnostics-record").first();
  await expect(record.locator("summary")).toContainText("Steady");
  await expect(record).toContainText("Store sent seasons/2026");
  await expect(record).toContainText(/Shows .*bracketWrap \d+\/\d+px/);
});
