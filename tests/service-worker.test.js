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

/**
 * A browser's cache of responses, in memory, with the parts of the cache API the worker uses.
 * @param {(request: any) => Promise<Response>} fetch
 */
function createCacheStorage(fetch) {
  const caches = new Map();
  const readKey = (request) => (typeof request === "string" ? request : request.url);
  const openCache = (name) => {
    if (!caches.has(name)) caches.set(name, new Map());
    const entries = caches.get(name);
    return {
      match: async (request) => entries.get(readKey(request))?.clone(),
      put: async (request, response) => void entries.set(readKey(request), response),
      addAll: async (requests) => {
        const responses = await Promise.all(requests.map((request) => fetch(request)));
        if (responses.some((response) => !response.ok)) throw new TypeError("a file failed");
        responses.forEach((response, index) => entries.set(readKey(requests[index]), response));
      },
      keys: async () => [...entries.keys()].map((url) => ({ url })),
      delete: async (request) => entries.delete(readKey(request)),
    };
  };
  return {
    open: async (name) => openCache(name),
    match: async (request, { cacheName }) =>
      caches.has(cacheName) ? openCache(cacheName).match(request) : undefined,
    delete: async (name) => caches.delete(name),
    listKept: (name) => [...(caches.get(name)?.keys() ?? [])],
  };
}

const answerPublicKey = (publicKey) => async () => new Response(JSON.stringify({ publicKey }));

// Runs an app's service worker with stand-ins for what the browser gives it.
function startServiceWorker({ publicKey = "AQID_w", app = "mlb", answer = null } = {}) {
  const listeners = {};
  const requests = [];
  const subscribed = [];
  const createSubscription = (endpoint) => ({
    endpoint,
    toJSON: () => ({ endpoint, keys: { p256dh: "p", auth: "a" } }),
  });
  const answerRequest = answer ?? answerPublicKey(publicKey);
  const fetch = async (request, init = {}) => {
    const url = typeof request === "object" && "url" in request ? request.url : String(request);
    requests.push({ url, method: init.method || "GET", body: init.body });
    return answerRequest(url);
  };
  const caches = createCacheStorage(fetch);
  const shown = [];
  const self = {
    clients: { claim: async () => {} },
    addEventListener: (type, listener) => (listeners[type] ??= []).push(listener),
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
  const context = createContext({ self, fetch, caches, URL, JSON, atob, Response });
  context.importScripts = (...paths) =>
    paths.forEach((path) => runInContext(readPageFile(app, path), context));
  runInContext(readPageFile(app, "sw.js"), context);
  // A worker can extend an event while it handles it, so each wait is read as it's added.
  const finish = async (waiting) => {
    for (let index = 0; index < waiting.length; index++) await waiting[index];
  };
  const startEvent = (type, fields) => {
    const waiting = [];
    for (const listener of listeners[type] ?? [])
      listener({ ...fields, waitUntil: (promise) => waiting.push(promise) });
    return waiting;
  };
  const dispatch = (type, fields) => finish(startEvent(type, fields));
  // What the worker answers for a request, or null when it leaves the request to the browser.
  const request = async (url, { mode = "no-cors", method = "GET" } = {}) => {
    let answered = null;
    const waiting = startEvent("fetch", {
      request: { url, mode, method },
      respondWith: (promise) => (answered = promise),
    });
    const response = answered && (await answered);
    await finish(waiting);
    return response;
  };
  // What the worker answers a page that asks it to read the page again.
  const refreshCopy = async () => {
    let answer = null;
    await dispatch("message", {
      data: { type: "refreshPageCopy" },
      ports: [{ postMessage: (message) => (answer = message) }],
    });
    return answer;
  };
  return {
    dispatch,
    request,
    refreshCopy,
    caches,
    requests,
    subscribed,
    shown,
    createSubscription,
  };
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
    ["mlb", "MLB"],
    ["wnba", "WNBA"],
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

const writePage = (commit) => `<!doctype html>
  <link rel="stylesheet" href="release/${commit}/styles.css" />
  <link rel="stylesheet" href="https://fonts.example/text.css" />
  <link rel="icon" href="icon.svg" />
  <link rel="modulepreload" href="release/${commit}/js/app.js" />
  <script type="module" src="release/${commit}/js/app.js"></script>
`;
const GATE = "<h1>Access code</h1>";
const STYLESHEET = `@font-face { src: url("fonts/text.woff2") format("woff2"); }
:root { --select-arrow: url("data:image/svg+xml,%3Csvg%3E%3C/svg%3E"); }
`;

/**
 * The Worker as the service worker reaches it, on one release at a time, or not at all.
 * @param {{ release: string, pageStatus?: number, isOffline?: boolean, isSignedOut?: boolean, missing?: Set<string> }} server
 */
const serveRelease = (server) => async (url) => {
  if (server.isOffline) throw new TypeError("Failed to fetch");
  if (url === SCOPE && server.pageStatus) return new Response("", { status: server.pageStatus });
  if (url === SCOPE && server.isSignedOut)
    return new Response(GATE, { headers: { "cache-control": "no-store" } });
  if (url === SCOPE)
    return new Response(writePage(server.release), { headers: { "cache-control": "no-cache" } });
  const path = url.slice(SCOPE.length);
  if (path.startsWith(`release/${server.release}/`) && !server.missing?.has(path))
    return new Response(path.endsWith(".css") ? STYLESHEET : `file ${path}`);
  return new Response("Not found", { status: 404 });
};

const NAVIGATION = { mode: "navigate" };

/** @param {ReturnType<typeof startServiceWorker>} worker */
const readCopy = async (worker) => {
  const copy = await worker.caches.match(SCOPE, { cacheName: "page" });
  return copy ? copy.text() : null;
};

/** @param {string} commit */
const listReleaseFiles = (commit) =>
  [
    SCOPE,
    `${SCOPE}release/${commit}/fonts/text.woff2`,
    `${SCOPE}release/${commit}/js/app.js`,
    `${SCOPE}release/${commit}/styles.css`,
  ].sort();

/** @param {ReturnType<typeof startServiceWorker>} worker */
const listKept = (worker) => worker.caches.listKept("page").sort();

test("the page is kept with every file of its own it loads, and opens whole from the copy offline", async () => {
  const server = { release: "a" };
  const worker = startServiceWorker({ answer: serveRelease(server) });
  assert.equal(await (await worker.request(SCOPE, NAVIGATION)).text(), writePage("a"));
  assert.deepEqual(listKept(worker), listReleaseFiles("a"));

  server.isOffline = true;

  assert.equal(
    await (await worker.request(`${SCOPE}index.html`, NAVIGATION)).text(),
    writePage("a"),
  );
  const code = await worker.request(`${SCOPE}release/a/js/app.js`);
  assert.equal(await code.text(), "file release/a/js/app.js");
});

test("a newer page replaces the copy only once all its files are kept, and the old ones go", async () => {
  const server = { release: "a", missing: new Set() };
  const worker = startServiceWorker({ answer: serveRelease(server) });
  await worker.request(SCOPE, NAVIGATION);
  server.release = "b";
  server.missing.add("release/b/js/app.js");

  assert.equal(await (await worker.request(SCOPE, NAVIGATION)).text(), writePage("a"));
  assert.equal(await readCopy(worker), writePage("a"));
  server.missing.clear();

  assert.equal(await (await worker.request(SCOPE, NAVIGATION)).text(), writePage("a"));
  assert.equal(await readCopy(worker), writePage("b"));
  assert.deepEqual(listKept(worker), listReleaseFiles("b"));
});

test("a page the Worker can't answer leaves the copy as it was", async () => {
  const server = { release: "a" };
  const worker = startServiceWorker({ answer: serveRelease(server) });
  await worker.request(SCOPE, NAVIGATION);
  Object.assign(server, { release: "b", pageStatus: 503 });

  await worker.request(SCOPE, NAVIGATION);

  assert.equal(await readCopy(worker), writePage("a"));
});

test("a signed-out phone's copy goes, so its next open shows the gate", async () => {
  const server = { release: "a" };
  const worker = startServiceWorker({ answer: serveRelease(server) });
  await worker.request(SCOPE, NAVIGATION);
  server.isSignedOut = true;

  assert.equal(await (await worker.request(SCOPE, NAVIGATION)).text(), writePage("a"));

  assert.equal(await readCopy(worker), null);
  assert.equal(await (await worker.request(SCOPE, NAVIGATION)).text(), GATE);
});

test("a file the copy needs that the Worker no longer has forgets the copy, and only that", async () => {
  const server = { release: "a" };
  const worker = startServiceWorker({ answer: serveRelease(server) });
  await worker.request(SCOPE, NAVIGATION);
  server.release = "b";
  const extraFont = await worker.request(`${SCOPE}release/a/fonts/extra.woff2`);
  assert.equal(extraFont.status, 404);
  assert.equal(await readCopy(worker), writePage("a"));
  await (await worker.caches.open("page")).delete(`${SCOPE}release/a/js/app.js`);

  const code = await worker.request(`${SCOPE}release/a/js/app.js`);

  assert.equal(code.status, 404);
  assert.equal(await readCopy(worker), null);
});

test("only the page and its own files go through the service worker", async () => {
  const worker = startServiceWorker({ answer: serveRelease({ release: "a" }) });
  await worker.request(SCOPE, NAVIGATION);

  for (const url of [
    `${SCOPE}version.json`,
    `${SCOPE}release/a/version.json`,
    `${SCOPE}store/seasons/2026`,
    `${SCOPE}icon-180.png`,
    "https://fonts.example/text.css",
  ])
    assert.equal(await worker.request(url), null, url);
  assert.equal(await worker.request(SCOPE), null);
  assert.equal(await worker.request(`${SCOPE}gate.html`, NAVIGATION), null);
  assert.equal(await worker.request(SCOPE, { ...NAVIGATION, method: "POST" }), null);
});

test("a phone gets its first copy as soon as the service worker starts", async () => {
  const worker = startServiceWorker({ answer: serveRelease({ release: "a" }) });

  await worker.dispatch("activate", {});

  for (let turn = 0; turn < 100 && !(await readCopy(worker)); turn++)
    await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(listKept(worker), listReleaseFiles("a"));
});

test("a page asking for a fresh copy hears whether the copy now holds the Worker's page", async () => {
  const server = { release: "a" };
  const worker = startServiceWorker({ answer: serveRelease(server) });
  await worker.request(SCOPE, NAVIGATION);
  server.release = "b";

  assert.equal(await worker.refreshCopy(), true);
  assert.equal(await readCopy(worker), writePage("b"));

  Object.assign(server, { release: "c", isOffline: true });
  assert.equal(await worker.refreshCopy(), false);
  Object.assign(server, { isOffline: false, pageStatus: 503 });
  assert.equal(await worker.refreshCopy(), false);
  assert.equal(await readCopy(worker), writePage("b"));

  Object.assign(server, { pageStatus: undefined, isSignedOut: true });
  assert.equal(await worker.refreshCopy(), true);
  assert.equal(await readCopy(worker), null);
});

test("pages asking at once share one read of the page", async () => {
  const worker = startServiceWorker({ answer: serveRelease({ release: "a" }) });

  await Promise.all([worker.refreshCopy(), worker.refreshCopy()]);

  assert.equal(worker.requests.filter(({ url }) => url === SCOPE).length, 1);
});

test("the next try on a weak connection reads only the files the last one missed", async () => {
  const server = { release: "a", missing: new Set() };
  const worker = startServiceWorker({ answer: serveRelease(server) });
  await worker.request(SCOPE, NAVIGATION);
  server.release = "b";
  server.missing.add("release/b/js/app.js");
  assert.equal(await worker.refreshCopy(), false);
  server.missing.clear();

  assert.equal(await worker.refreshCopy(), true);

  const reads = (path) => worker.requests.filter(({ url }) => url === `${SCOPE}${path}`).length;
  assert.equal(reads("release/b/styles.css"), 1);
  assert.equal(reads("release/b/js/app.js"), 2);
});

test("a font the copy's stylesheet needs that the Worker no longer has forgets the copy", async () => {
  const server = { release: "a" };
  const worker = startServiceWorker({ answer: serveRelease(server) });
  await worker.request(SCOPE, NAVIGATION);
  server.release = "b";
  await (await worker.caches.open("page")).delete(`${SCOPE}release/a/fonts/text.woff2`);

  const font = await worker.request(`${SCOPE}release/a/fonts/text.woff2`);

  assert.equal(font.status, 404);
  assert.equal(await readCopy(worker), null);
});
