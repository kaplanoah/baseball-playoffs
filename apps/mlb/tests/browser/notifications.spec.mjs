import { test, expect, openApp, openSettings } from "./harness.mjs";

const DEVICE_ENDPOINT = "https://fcm.googleapis.com/fcm/send/test-device";

// Headless Chromium has no push service, and its headless shell denies notifications outright,
// so the permission prompt and the subscription are stand-ins. The subscription has real keys,
// which is all the Worker needs.
function stubPushManager(endpoint) {
  /** @type {NotificationPermission} */
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

test("notifications can be turned on and off, with no note while the switch works", async ({
  page,
}) => {
  await page.addInitScript(stubPushManager, DEVICE_ENDPOINT);
  const app = await openApp(page);
  await openSettings(page);

  const toggle = page.getByRole("switch", { name: "Notifications" });
  const note = page.locator("#notifyNote");
  await expect(toggle).toHaveAttribute("aria-checked", "false");
  await expect(note).toBeHidden();

  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-checked", "true");
  expect(app.countSubscriptions()).toBe(1);
  await expect(note).toBeHidden();
  await expect(page.getByRole("button", { name: /test/i })).toHaveCount(0);

  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-checked", "false");
  expect(app.countSubscriptions()).toBe(0);
});

test("blocked notifications point to the browser's site settings", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(Notification, "permission", { get: () => "denied" });
  });
  await openApp(page);
  await openSettings(page);

  await expect(page.locator("#notifyNote")).toHaveText(/browser's site settings/);
  await expect(page.getByRole("switch", { name: "Notifications" })).toBeDisabled();
});

test("on an iPhone, blocked notifications point to Settings", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(Notification, "permission", { get: () => "denied" });
    Object.defineProperty(navigator, "userAgent", {
      get: () => "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)",
    });
  });
  await openApp(page);
  await openSettings(page);

  await expect(page.locator("#notifyNote")).toHaveText(/Turn them on in Settings > Notifications/);
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
  await openSettings(page);

  await expect(page.locator("#notifyNote")).toHaveText(/add this page to your Home Screen/);
  await expect(page.getByRole("switch", { name: "Notifications" })).toBeHidden();
});
