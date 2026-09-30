import * as WebPush from "./web-push.js";
import { respondError, respondJson } from "./responses.js";

// Push subscriptions and the key that signs messages for them. Both are kept under keys the
// store's own paths can't name, so the page's store never hands them out.

const SIGNING_KEY = "push:signing-key";
const SUBSCRIPTION_PREFIX = "push:subscription:";
const MAX_BODY_BYTES = 4 * 1024;
const GONE_STATUSES = new Set([404, 410]);

// Only real push services, so a stored address can't point the Worker anywhere else.
const PUSH_SERVICE_HOSTS = [
  "push.apple.com",
  "fcm.googleapis.com",
  "push.services.mozilla.com",
  "notify.windows.com",
];

const TEST_MESSAGE = {
  title: "Notifications are on",
  body: "You'll hear here when something happens to a team in your ranking.",
  tag: "test",
};

const isPushServiceHost = (host) =>
  PUSH_SERVICE_HOSTS.some((allowed) => host === allowed || host.endsWith(`.${allowed}`));

function isPushServiceUrl(text) {
  try {
    const url = new URL(text);
    return url.protocol === "https:" && isPushServiceHost(url.hostname);
  } catch {
    return false;
  }
}

function hasKeyLength(text, length) {
  try {
    return typeof text === "string" && WebPush.decodeBase64Url(text).length === length;
  } catch {
    return false;
  }
}

const isSubscription = (value) =>
  !!value &&
  isPushServiceUrl(value.endpoint) &&
  hasKeyLength(value.keys?.p256dh, 65) &&
  hasKeyLength(value.keys?.auth, 16);

async function readBody(request) {
  const text = await request.text();
  if (text.length > MAX_BODY_BYTES) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

async function findSubscriptionKey(endpoint) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(endpoint));
  const hex = [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0"));
  return SUBSCRIPTION_PREFIX + hex.join("").slice(0, 32);
}

/**
 * @param {object} options
 * @param {{ get: Function, put: Function, delete: Function, list: Function }} options.storage
 * @param {() => number} options.now
 * @param {typeof fetch} [options.fetchImpl]
 */
export function createPushService({ storage, now, fetchImpl }) {
  let signingKey = null;

  async function loadSigningKey() {
    const stored = await storage.get(SIGNING_KEY);
    if (stored) return stored;
    const created = await WebPush.createSigningKey();
    await storage.put(SIGNING_KEY, created);
    return created;
  }

  // Held as one promise, so two requests at once can't each make a key.
  function readSigningKey() {
    signingKey ??= loadSigningKey().catch((error) => {
      signingKey = null;
      throw error;
    });
    return signingKey;
  }

  async function deliver(key, subscription, message) {
    const status = await WebPush.sendPush({
      subscription,
      message,
      signingKey: await readSigningKey(),
      subject: subscription.subject,
      now: now(),
      fetchImpl,
    });
    if (GONE_STATUSES.has(status)) await storage.delete(key);
    return status;
  }

  async function serveKey() {
    const publicKey = WebPush.readApplicationServerKey(await readSigningKey());
    return respondJson({ publicKey });
  }

  // The push service needs a way to reach whoever sends, and the page's own address is one.
  async function saveSubscription(request) {
    const body = await readBody(request);
    if (!isSubscription(body))
      return respondError(400, "invalid_argument", "That isn't a push subscription.");
    const { endpoint, keys } = body;
    const subject = new URL(request.url).origin;
    await storage.put(await findSubscriptionKey(endpoint), { endpoint, keys, subject });
    return new Response(null, { status: 204 });
  }

  async function readSubscriptionFor(request) {
    const body = await readBody(request);
    if (!body || typeof body.endpoint !== "string") return {};
    const key = await findSubscriptionKey(body.endpoint);
    return { key, subscription: await storage.get(key) };
  }

  async function removeSubscription(request) {
    const { key } = await readSubscriptionFor(request);
    if (!key) return respondError(400, "invalid_argument", "Say which subscription to remove.");
    await storage.delete(key);
    return new Response(null, { status: 204 });
  }

  async function sendTest(request) {
    const { key, subscription } = await readSubscriptionFor(request);
    if (!subscription) return respondError(404, "not_found", "This device isn't subscribed.");
    const status = await deliver(key, subscription, TEST_MESSAGE);
    if (status >= 200 && status < 300) return new Response(null, { status: 204 });
    return respondError(502, "push_failed", `The push service answered ${status}.`);
  }

  /** @param {Request} request @param {string} pathname */
  function serveRequest(request, pathname) {
    const route = `${request.method} ${pathname}`;
    if (route === "GET /push/key") return serveKey();
    if (route === "PUT /push/subscription") return saveSubscription(request);
    if (route === "DELETE /push/subscription") return removeSubscription(request);
    if (route === "POST /push/test") return sendTest(request);
    return respondError(404, "not_found", "No such path.");
  }

  // Each device gets its messages in order, and one device failing doesn't stop the others.
  async function sendInOrder(key, subscription, messages) {
    for (const message of messages) {
      const status = await deliver(key, subscription, message);
      if (GONE_STATUSES.has(status)) return;
    }
  }

  async function sendToAll(messages) {
    const stored = await storage.list({ prefix: SUBSCRIPTION_PREFIX });
    return Promise.allSettled(
      [...stored].map(([key, subscription]) => sendInOrder(key, subscription, messages)),
    );
  }

  return { serveRequest, sendToAll };
}
