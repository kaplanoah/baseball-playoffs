import { test as base, expect } from "@playwright/test";
import { createDurableObjectContext } from "../durable-object-context.js";

/** @type {import("@playwright/test").Fixtures<{ pageErrors: string[] }, {}, import("@playwright/test").PlaywrightTestArgs>} */
const pageErrorsFixture = {
  pageErrors: [
    async ({ page }, use) => {
      const errors = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await use(errors);
      expect(errors).toEqual([]);
    },
    { auto: true },
  ],
};

export const test = base.extend(pageErrorsFixture);
export { expect };

/**
 * An app's store in a stand-in Durable Object, holding `stored`, whose clock reads `now`, and whose
 * pushes all succeed.
 * @template {{ fetch: (request: Request) => Promise<Response> }} Store
 * @param {new (ctx: any, env: object, options: object) => Store} SeasonStore the app's store class
 * @param {object} options
 * @param {(season: string) => Promise<object>} options.loadSnapshot
 * @param {string} options.now
 * @param {Record<string, unknown>} [options.stored] documents by path
 */
export function createTestStore(SeasonStore, { loadSnapshot, now, stored = {} }) {
  const context = createDurableObjectContext();
  for (const [path, data] of Object.entries(stored)) context.stored.set(path, data);
  const store = new SeasonStore(
    context.ctx,
    {},
    {
      loadSnapshot,
      now: () => Date.parse(now),
      fetchImpl: async () => new Response(null, { status: 201 }),
    },
  );
  return { context, store };
}

/** @param {import("@playwright/test").Page} page */
const blockOtherHosts = (page) =>
  page.route(
    (url) => url.hostname !== "127.0.0.1",
    (route) => route.abort(),
  );

/**
 * @param {import("@playwright/test").Route} route
 * @param {{ fetch: (request: Request) => Promise<Response> }} store
 */
async function answerFromStore(route, store) {
  const request = route.request();
  const answer = await store.fetch(
    new Request(request.url(), {
      method: request.method(),
      headers: request.headers(),
      body: request.postData() ?? undefined,
    }),
  );
  await route.fulfill({
    status: answer.status,
    headers: Object.fromEntries(answer.headers),
    body: Buffer.from(await answer.arrayBuffer()),
  });
}

/**
 * @param {import("@playwright/test").Page} page
 * @param {Parameters<typeof answerFromStore>[1]} store
 */
const routeStoreRequests = (page, store) =>
  page.route(
    (url) => url.pathname.startsWith("/store/") || url.pathname.startsWith("/push/"),
    (route) => answerFromStore(route, store),
  );

/**
 * @template Item
 * @param {Item[]} list
 * @param {Item} item
 */
function removeItem(list, item) {
  const index = list.indexOf(item);
  if (index >= 0) list.splice(index, 1);
}

/**
 * @param {import("@playwright/test").Page} page
 * @param {ReturnType<typeof createDurableObjectContext>["ctx"]} ctx
 * @returns {Promise<import("@playwright/test").WebSocketRoute[]>} the sockets the page has open
 */
async function routeWatchSockets(page, ctx) {
  const openSockets = [];
  await page.routeWebSocket(
    (url) => url.pathname === "/watch",
    (socket) => {
      const accepted = { send: (message) => socket.send(message) };
      openSockets.push(socket);
      ctx.acceptWebSocket(accepted);
      socket.onClose(() => {
        removeItem(openSockets, socket);
        removeItem(ctx.getWebSockets(), accepted);
      });
    },
  );
  return openSockets;
}

/**
 * Keeps the page from reaching anything but the test server, and answers its store, its pushes,
 * and its watch socket from `store`. Routes added after it come first.
 * @param {import("@playwright/test").Page} page
 * @param {ReturnType<typeof createTestStore>} testStore
 */
export async function connectToStore(page, { context, store }) {
  await blockOtherHosts(page);
  await routeStoreRequests(page, store);
  return routeWatchSockets(page, context.ctx);
}

/**
 * Loads the page with its clock set to `now`.
 * @param {import("@playwright/test").Page} page
 * @param {string} now
 */
export async function loadPageAt(page, now) {
  await page.clock.install({ time: new Date(now) });
  await page.goto("/");
}

const PAGE_KEY = "test-key";

/**
 * @param {import("@playwright/test").Route} route
 * @param {{ fetch: (request: Request, env: object) => Response | Promise<Response> }} worker
 * @param {object} env
 */
async function answerThroughWorker(route, worker, env) {
  const request = route.request();
  const answer = await worker.fetch(
    new Request(request.url(), {
      method: request.method(),
      headers: await request.allHeaders(),
      body: request.postData() ?? undefined,
    }),
    env,
  );
  await route.fulfill({
    status: answer.status,
    headers: Object.fromEntries(answer.headers),
    body: Buffer.from(await answer.arrayBuffer()),
  });
}

/**
 * The page at its key's address behind an access code, with every request under the key answered
 * by `worker` in front of `testStore`.
 * @param {import("@playwright/test").Page} page
 * @param {object} options
 * @param {Parameters<typeof answerThroughWorker>[1]} options.worker the app's Worker
 * @param {ReturnType<typeof createTestStore>} options.testStore
 * @param {string} options.accessCode
 * @param {string} options.now
 */
export async function openLockedPage(page, { worker, testStore, accessCode, now }) {
  const tries = { isOverLimit: false };
  const env = {
    APP_KEY: PAGE_KEY,
    ACCESS_CODE: accessCode,
    ACCESS_SIGNING_KEY: "test-signing-key",
    ACCESS_LIMIT: { limit: async () => ({ success: !tries.isOverLimit }) },
    STORE: { idFromName: () => "store", get: () => testStore.store },
  };
  await blockOtherHosts(page);
  await page.route(
    (url) => url.pathname.startsWith(`/${PAGE_KEY}/`),
    (route) => answerThroughWorker(route, worker, env),
  );
  await page.routeWebSocket(
    (url) => url.pathname === `/${PAGE_KEY}/watch`,
    (socket) => testStore.context.ctx.acceptWebSocket({ send: (message) => socket.send(message) }),
  );
  await page.clock.install({ time: new Date(now) });
  await page.goto(`/${PAGE_KEY}/`);

  return {
    /** @param {string} code */
    changeAccessCode: (code) => {
      env.ACCESS_CODE = code;
    },
    limitTries: () => {
      tries.isOverLimit = true;
    },
  };
}
