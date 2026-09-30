import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as MLBSnapshot from "../page/js/snapshot.js";
import worker from "../worker/src/index.js";
import { SeasonStore } from "../worker/src/store.js";
import { decodeBase64Url } from "../../../shared/worker/web-push.js";
import { createDurableObjectContext } from "../../../tests/durable-object-context.js";
import { createBrowserKeys, readPushMessage } from "../../../tests/push-reader.js";

const APP_KEY = "k3y";
const ORIGIN = "https://mlb-live.example.workers.dev";
const ENDPOINT = "https://web.push.apple.com/QGuQyavXutnMH";

const EVENING = JSON.parse(
  readFileSync(`${import.meta.dirname}/fixtures/2026-09-24-evening.json`, "utf8"),
);
const NOW = Date.parse(EVENING.now);
const SNAPSHOT = MLBSnapshot.buildSnapshot(EVENING.responses, { season: 2026, now: NOW });

function createPushStore({ pushStatus = 201 } = {}) {
  const context = createDurableObjectContext();
  const harness = { snapshot: SNAPSHOT, pushStatus, pushes: [] };
  const fetchImpl = async (url, init) => {
    harness.pushes.push({ url, init });
    return new Response(null, { status: harness.pushStatus });
  };
  const store = new SeasonStore(
    context.ctx,
    {},
    {
      loadSnapshot: async () => structuredClone(harness.snapshot),
      now: () => NOW,
      fetchImpl,
    },
  );
  const env = {
    APP_KEY,
    STORE: {
      idFromName: (name) => name,
      get: () => ({ fetch: (request) => store.fetch(request) }),
    },
  };
  return { store, context, harness, env };
}

/**
 * @param {object} env
 * @param {string} path
 * @param {{ method?: string, body?: unknown }} [options]
 */
function requestApp(env, path, { method = "GET", body } = {}) {
  /** @type {RequestInit} */
  const init = { method, headers: { "content-type": "application/json" } };
  if (body !== undefined) init.body = JSON.stringify(body);
  return worker.fetch(new Request(`${ORIGIN}/${APP_KEY}${path}`, init), env);
}

async function subscribe(env, endpoint = ENDPOINT) {
  const keys = await createBrowserKeys();
  const response = await requestApp(env, "/push/subscription", {
    method: "PUT",
    body: { endpoint, keys: { p256dh: keys.p256dh, auth: keys.auth } },
  });
  return { response, keys };
}

const listSubscriptions = (context) =>
  [...context.stored.keys()].filter((key) => key.startsWith("push:subscription:"));

test("the signing key is made once, and its public half is the page's to use", async () => {
  const { env, context } = createPushStore();
  const first = await (await requestApp(env, "/push/key")).json();
  const second = await (await requestApp(env, "/push/key")).json();
  assert.equal(first.publicKey, second.publicKey);
  assert.equal(decodeBase64Url(first.publicKey).length, 65);
  assert.ok(context.stored.get("push:signing-key").d, "the private key is kept");
});

test("a subscription is saved, and only for a real push service", async () => {
  const { env, context } = createPushStore();
  const { response } = await subscribe(env);
  assert.equal(response.status, 204);
  const [key] = listSubscriptions(context);
  assert.equal(context.stored.get(key).endpoint, ENDPOINT);
  assert.equal(context.stored.get(key).subject, ORIGIN);

  const elsewhere = await subscribe(env, "https://example.com/push");
  assert.equal(elsewhere.response.status, 400);
  const plainHttp = await subscribe(env, "http://web.push.apple.com/abc");
  assert.equal(plainHttp.response.status, 400);
  const shortKeys = await requestApp(env, "/push/subscription", {
    method: "PUT",
    body: { endpoint: ENDPOINT, keys: { p256dh: "AAAA", auth: "AAAA" } },
  });
  assert.equal(shortKeys.status, 400);
  assert.equal(listSubscriptions(context).length, 1);
});

test("the store's own paths can't reach the keys or subscriptions", async () => {
  const { env } = createPushStore();
  await subscribe(env);
  assert.equal((await requestApp(env, "/store/push:signing-key/x")).status, 404);
  assert.deepEqual((await (await requestApp(env, "/store/push")).json()).docs, []);
});

test("a test goes to that device, and a gone device is forgotten", async () => {
  const { env, context, harness } = createPushStore();
  const { keys } = await subscribe(env);
  const sent = await requestApp(env, "/push/test", {
    method: "POST",
    body: { endpoint: ENDPOINT },
  });
  assert.equal(sent.status, 204);
  assert.equal(harness.pushes[0].url, ENDPOINT);
  const message = await readPushMessage(harness.pushes[0].init.body, keys);
  assert.equal(message.title, "Notifications are on");

  harness.pushStatus = 410;
  const gone = await requestApp(env, "/push/test", {
    method: "POST",
    body: { endpoint: ENDPOINT },
  });
  assert.equal(gone.status, 502);
  assert.deepEqual(listSubscriptions(context), []);
  const unknown = await requestApp(env, "/push/test", {
    method: "POST",
    body: { endpoint: ENDPOINT },
  });
  assert.equal(unknown.status, 404);
});

test("unsubscribing removes the device", async () => {
  const { env, context } = createPushStore();
  await subscribe(env);
  const response = await requestApp(env, "/push/subscription", {
    method: "DELETE",
    body: { endpoint: ENDPOINT },
  });
  assert.equal(response.status, 204);
  assert.deepEqual(listSubscriptions(context), []);
});

function moveMetsIntoField(snapshot) {
  const { PHI, ...teams } = snapshot.teams;
  return { ...snapshot, teams: { ...teams, NYM: { ...PHI, w: 83, l: 76 } } };
}

test("an update that finds a change for a ranked club notifies every device", async () => {
  const { store, env, context, harness } = createPushStore();
  const endpoints = [ENDPOINT, `${ENDPOINT}-2`];
  const devices = [await subscribe(env, endpoints[0]), await subscribe(env, endpoints[1])];
  context.stored.set("seasons/2026", { year: 2026, ranking: ["PHI", "LAD"] });
  await store.alarm();
  assert.deepEqual(harness.pushes, [], "the first reading has nothing to compare with");

  harness.snapshot = moveMetsIntoField(SNAPSHOT);
  await store.alarm();
  assert.equal(harness.pushes.length, 2);
  for (const [index, { keys }] of devices.entries()) {
    const push = harness.pushes.find(({ url }) => url === endpoints[index]);
    const message = await readPushMessage(push.init.body, keys);
    assert.match(message.title, /^Mets take .* from the Phillies$/);
    assert.match(message.tag, /^field:NYM:PHI:/);
  }

  harness.pushes.length = 0;
  await store.alarm();
  assert.deepEqual(harness.pushes, [], "nothing new, nothing sent");
});

test("a club counts as ranked before the ranking is ever dragged", async () => {
  const { store, env, harness } = createPushStore();
  await subscribe(env);
  await store.alarm();
  harness.snapshot = moveMetsIntoField(SNAPSHOT);
  await store.alarm();
  assert.equal(harness.pushes.length, 1);
});

test("an update's news goes out even when saving its status fails", async () => {
  const { store, env, context, harness } = createPushStore();
  await subscribe(env);
  await store.alarm();
  harness.snapshot = moveMetsIntoField(SNAPSHOT);
  const { put } = context.ctx.storage;
  context.ctx.storage.put = async (key, value) => {
    if (key.endsWith("live/status")) throw new Error("storage is full");
    return put(key, value);
  };
  await store.alarm();
  assert.equal(harness.pushes.length, 1);
});

test("a push service that fails doesn't stop the season update", async () => {
  const { store, env, context, harness } = createPushStore();
  await subscribe(env);
  context.stored.set("seasons/2026", { year: 2026, ranking: ["PHI"] });
  await store.alarm();
  harness.snapshot = moveMetsIntoField(SNAPSHOT);
  harness.pushStatus = 500;
  await store.alarm();
  assert.equal(harness.pushes.length, 1);
  assert.ok("NYM" in context.stored.get("seasons/2026").teams);
  assert.equal(context.alarm.at, NOW + MLBSnapshot.POLL_LIVE_MS);
});
