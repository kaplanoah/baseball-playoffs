import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createContext, runInContext } from "node:vm";

const SCOPE = "https://mlb-live.example.workers.dev/k3y/";
const OLD_ENDPOINT = "https://web.push.apple.com/old";
const NEW_ENDPOINT = "https://web.push.apple.com/new";

const REPO_ROOT = `${import.meta.dirname}/..`;

// The Worker serves the shared page files under shared/, beside each app's own.
const readPageFile = (app, path) =>
  readFileSync(
    path.startsWith("shared/")
      ? `${REPO_ROOT}/shared/page/${path.slice("shared/".length)}`
      : `${REPO_ROOT}/apps/${app}/page/${path}`,
    "utf8",
  );

// Runs an app's service worker with stand-ins for what the browser gives it.
function startServiceWorker({ publicKey = "AQID_w", app = "mlb" } = {}) {
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
  const shown = [];
  const self = {
    addEventListener: (type, listener) => (listeners[type] = listener),
    registration: {
      scope: SCOPE,
      showNotification: async (title, options) => shown.push({ title, ...options }),
      pushManager: {
        subscribe: async (options) => {
          subscribed.push(options);
          return createSubscription(NEW_ENDPOINT);
        },
      },
    },
  };
  const context = createContext({ self, fetch, URL, JSON, atob });
  context.importScripts = (path) => runInContext(readPageFile(app, path), context);
  runInContext(readPageFile(app, "sw.js"), context);
  const dispatch = async (type, fields) => {
    let waiting;
    listeners[type]({ ...fields, waitUntil: (promise) => (waiting = promise) });
    await waiting;
  };
  return { dispatch, requests, subscribed, shown, createSubscription };
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

test("a push shows its message, and one that can't be read shows the app's name", async () => {
  for (const [app, pageName] of [
    ["mlb", "MLB Postseason"],
    ["wnba", "WNBA Playoffs"],
  ]) {
    const worker = startServiceWorker({ app });
    const message = { title: "The Dream beat the Mystics 84-79", body: "", tag: "final:1" };
    await worker.dispatch("push", { data: { json: () => message } });
    await worker.dispatch("push", {
      data: {
        json: () => {
          throw new SyntaxError("Unexpected end of JSON input");
        },
      },
    });
    assert.deepEqual(
      worker.shown.map(({ title }) => title),
      [message.title, pageName],
    );
  }
});
