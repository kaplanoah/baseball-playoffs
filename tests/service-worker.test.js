import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";

const SCOPE = "https://mlb-live.example.workers.dev/k3y/";
const OLD_ENDPOINT = "https://web.push.apple.com/old";
const NEW_ENDPOINT = "https://web.push.apple.com/new";

// Runs the service worker with stand-ins for what the browser gives it.
function startServiceWorker({ publicKey = "AQID_w" } = {}) {
  const listeners = {};
  const requests = [];
  const subscribed = [];
  const createSubscription = (endpoint) => ({
    endpoint,
    toJSON: () => ({ endpoint, keys: { p256dh: "p", auth: "a" } }),
  });
  const fetch = async (url, init = {}) => {
    requests.push({ url: String(url), method: init.method || "GET", body: init.body });
    return new Response(JSON.stringify({ publicKey }));
  };
  const self = {
    addEventListener: (type, listener) => (listeners[type] = listener),
    registration: {
      scope: SCOPE,
      pushManager: {
        subscribe: async (options) => {
          subscribed.push(options);
          return createSubscription(NEW_ENDPOINT);
        },
      },
    },
  };
  runInNewContext(readFileSync("page/sw.js", "utf8"), { self, fetch, URL, JSON, atob });
  const dispatch = async (type, fields) => {
    let waiting;
    listeners[type]({ ...fields, waitUntil: (promise) => (waiting = promise) });
    await waiting;
  };
  return { dispatch, requests, subscribed, createSubscription };
}

const listSubscriptionRequests = (requests) =>
  requests
    .filter(({ url }) => url === `${SCOPE}push/subscription`)
    .map(({ method, body }) => [method, JSON.parse(body).endpoint]);

test("a subscription the browser replaced is saved, and the old one removed", async () => {
  const worker = startServiceWorker();
  await worker.dispatch("pushsubscriptionchange", {
    oldSubscription: worker.createSubscription(OLD_ENDPOINT),
    newSubscription: worker.createSubscription(NEW_ENDPOINT),
  });
  assert.deepEqual(listSubscriptionRequests(worker.requests), [
    ["PUT", NEW_ENDPOINT],
    ["DELETE", OLD_ENDPOINT],
  ]);
});

test("a subscription the browser dropped is made again with the Worker's key", async () => {
  const worker = startServiceWorker({ publicKey: "AQID_w" });
  await worker.dispatch("pushsubscriptionchange", { oldSubscription: null, newSubscription: null });
  const [options] = worker.subscribed;
  assert.equal(options.userVisibleOnly, true);
  assert.deepEqual([...options.applicationServerKey], [1, 2, 3, 255]);
  assert.deepEqual(listSubscriptionRequests(worker.requests), [["PUT", NEW_ENDPOINT]]);
});
