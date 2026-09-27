import { test, expect, openApp } from "./harness.mjs";

const DEVICE_ENDPOINT = "https://fcm.googleapis.com/fcm/send/test-device";

// Headless Chromium has no push service, and its headless shell denies notifications outright,
// so the permission prompt and the subscription are stand-ins. The subscription has real keys,
// which is all the Worker needs.
function stubPushManager(endpoint) {
  let permission = "default";
  Object.defineProperty(Notification, "permission", { get: () => permission });
  Notification.requestPermission = async () => {
    permission = "granted";
    return permission;
  };
  let current = null;
  const encode = (buffer) =>
    btoa(String.fromCharCode(...new Uint8Array(buffer)))
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
  PushManager.prototype.getSubscription = async () => current;
  PushManager.prototype.subscribe = async (options) => {
    const pair = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, [
      "deriveBits",
    ]);
    const keys = {
      p256dh: encode(await crypto.subtle.exportKey("raw", pair.publicKey)),
      auth: encode(crypto.getRandomValues(new Uint8Array(16))),
    };
    current = {
      endpoint,
      options: { applicationServerKey: options.applicationServerKey },
      toJSON: () => ({ endpoint, keys }),
      unsubscribe: async () => {
        current = null;
        return true;
      },
    };
    return current;
  };
}

test("notifications can be turned on, tested, and turned off", async ({ page }) => {
  await page.addInitScript(stubPushManager, DEVICE_ENDPOINT);
  const app = await openApp(page);
  await page.getByRole("tab", { name: "Ranking" }).click();

  const toggle = page.getByRole("switch", { name: "Notifications" });
  const note = page.locator("#notifyNote");
  await expect(toggle).toHaveAttribute("aria-checked", "false");
  await expect(note).toHaveText(/when something happens to a team in your ranking/);

  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-checked", "true");
  expect(app.countSubscriptions()).toBe(1);

  await page.getByRole("button", { name: "Send a test" }).click();
  await expect(note).toHaveText("Sent. It should arrive in a few seconds.");
  expect(app.listPushes()).toEqual([DEVICE_ENDPOINT]);

  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-checked", "false");
  expect(app.countSubscriptions()).toBe(0);
  await expect(page.getByRole("button", { name: "Send a test" })).toBeHidden();
});

test("blocked notifications say where to turn them back on", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(Notification, "permission", { get: () => "denied" });
  });
  await openApp(page);
  await page.getByRole("tab", { name: "Ranking" }).click();

  await expect(page.locator("#notifyNote")).toHaveText(/Settings > Notifications/);
  await expect(page.getByRole("switch", { name: "Notifications" })).toBeDisabled();
});

test("on an iPhone outside the Home Screen, the page says to add it there", async ({ page }) => {
  await page.addInitScript(() => {
    delete window.PushManager;
    Object.defineProperty(navigator, "userAgent", {
      get: () => "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)",
    });
  });
  await openApp(page);
  await page.getByRole("tab", { name: "Ranking" }).click();

  await expect(page.locator("#notifyNote")).toHaveText(/add this page to your Home Screen/);
  await expect(page.getByRole("switch", { name: "Notifications" })).toBeHidden();
});
