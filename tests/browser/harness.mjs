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
 * @param {import("@playwright/test").Page} page
 * @param {ReturnType<typeof createDurableObjectContext>["ctx"]} ctx
 * @returns {Promise<import("@playwright/test").WebSocketRoute[]>} the sockets the page opens
 */
async function routeWatchSockets(page, ctx) {
  const openSockets = [];
  await page.routeWebSocket(
    (url) => url.pathname === "/watch",
    (socket) => {
      openSockets.push(socket);
      ctx.acceptWebSocket({ send: (message) => socket.send(message) });
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
