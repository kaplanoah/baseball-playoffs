import { readFileSync } from "node:fs";
import { test as base, expect } from "@playwright/test";
import { buildSnapshot } from "../../page/js/snapshot.js";
import { createBoxScoreServer, nameBoxScoreRequest } from "../../worker/src/box-score.js";
import { createPreviewServer, listPreviewRequests } from "../../worker/src/preview.js";
import { SeasonStore } from "../../worker/src/store.js";
import worker from "../../worker/src/index.js";
import { createDurableObjectContext } from "../../../../tests/durable-object-context.js";
import { holdStore } from "../../../../tests/browser/hold-store.mjs";

const AFTERNOON = JSON.parse(
  readFileSync(new URL("../fixtures/2026-09-30-afternoon.json", import.meta.url), "utf8"),
);
const NOW = AFTERNOON.now;
const GAMES = JSON.parse(
  readFileSync(new URL("../fixtures/2026-10-01-games.json", import.meta.url), "utf8"),
);

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
export { expect, GAMES };

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
 * The league's answers to the game sheet's routes, from the recorded box scores and preview feeds,
 * with any of them changed or refused. A game without a box score is one that hasn't started.
 * @param {{ boxScores?: Record<string, any>, refused?: string[] }} league
 */
function createLeagueFetch({ boxScores = {}, refused = [] }) {
  const previewRequests = listPreviewRequests(GAMES.season);
  const answers = new Map([
    ...Object.entries({ ...GAMES.boxScores, ...boxScores }).map(
      ([id, box]) => /** @type {[string, any]} */ ([nameBoxScoreRequest(id), box]),
    ),
    ...Object.entries(previewRequests)
      .filter(([name]) => !refused.includes(name))
      .map(([name, url]) => /** @type {[string, any]} */ ([url, GAMES.preview[name]])),
  ]);
  return async (url) =>
    answers.has(url)
      ? new Response(JSON.stringify(answers.get(url)))
      : new Response("<Error>AccessDenied</Error>", { status: 403 });
}

/**
 * @param {import("@playwright/test").Route} route
 * @param {(url: URL) => Promise<Response>} serve
 */
async function answerFromWorker(route, serve) {
  const answer = await serve(new URL(route.request().url()));
  await route.fulfill({ status: answer.status, json: await answer.json() });
}

/** The Worker's store, already updated once from the afternoon's feeds. */
async function createUpdatedStore() {
  const context = createDurableObjectContext();
  const loadSnapshot = async (season) =>
    buildSnapshot(
      { ...AFTERNOON.responses, players: GAMES.preview.players },
      { season, now: Date.parse(NOW) },
    );
  const store = new SeasonStore(
    context.ctx,
    {},
    {
      loadSnapshot,
      now: () => Date.parse(NOW),
      fetchImpl: async () => new Response(null, { status: 201 }),
    },
  );
  await store.alarm();
  return { context, store };
}

/**
 * The page as the Worker serves it, with the Worker's store behind it, already updated once from
 * the afternoon's feeds, and the game sheet's routes reading the league's recorded answers.
 * @param {import("@playwright/test").Page} page
 * @param {{ league?: Parameters<typeof createLeagueFetch>[0] }} [options]
 */
export async function openApp(page, { league = {} } = {}) {
  const { context, store } = await createUpdatedStore();
  await page.route(
    (url) => url.hostname !== "127.0.0.1",
    (route) => route.abort(),
  );
  await page.route(
    (url) => url.pathname.startsWith("/store/") || url.pathname.startsWith("/push/"),
    (route) => answerFromStore(route, store),
  );
  const fetchImpl = createLeagueFetch(league);
  const boxScores = createBoxScoreServer({ fetchImpl });
  const previews = createPreviewServer({ fetchImpl, now: () => Date.parse(NOW) });
  await page.route(
    (url) => url.pathname === "/box-score",
    (route) => answerFromWorker(route, boxScores.serveBoxScore),
  );
  await page.route(
    (url) => url.pathname === "/preview",
    (route) => answerFromWorker(route, previews.servePreview),
  );
  await page.routeWebSocket(
    (url) => url.pathname === "/watch",
    (socket) => context.ctx.acceptWebSocket({ send: (message) => socket.send(message) }),
  );
  await page.clock.install({ time: new Date(NOW) });
  await page.goto("/");

  const readSeason = async () => structuredClone(await context.ctx.storage.get("seasons/2026"));

  return {
    /** @param {(season: any) => any} change */
    changeSeason: async (change) => {
      await store.docs.write("seasons/2026", change(await readSeason()));
    },
    /**
     * A change the page's socket never hears of, as when a phone sleeps through it.
     * @param {(season: any) => any} change
     */
    changeSeasonWhileAway: async (change) => {
      await context.ctx.storage.put("seasons/2026", change(await readSeason()));
    },
    holdStore: () => holdStore(page),
    /**
     * The saved season as the store would hold it in the next year's off-season.
     * @param {number} year
     */
    moveSeasonTo: async (year) => {
      await context.ctx.storage.put(`seasons/${year}`, await readSeason());
      await context.ctx.storage.delete("seasons/2026");
    },
  };
}

const PAGE_KEY = "test-key";

/**
 * @param {import("@playwright/test").Route} route
 * @param {object} env
 */
async function answerThroughWorker(route, env) {
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
 * by the Worker itself, and the store behind it.
 * @param {import("@playwright/test").Page} page
 * @param {{ accessCode: string }} options
 */
export async function openLockedApp(page, { accessCode }) {
  const { context, store } = await createUpdatedStore();
  const tries = { isOverLimit: false };
  const env = {
    APP_KEY: PAGE_KEY,
    ACCESS_CODE: accessCode,
    ACCESS_LIMIT: { limit: async () => ({ success: !tries.isOverLimit }) },
    STORE: { idFromName: () => "store", get: () => store },
  };
  await page.route(
    (url) => url.hostname !== "127.0.0.1",
    (route) => route.abort(),
  );
  await page.route(
    (url) => url.pathname.startsWith(`/${PAGE_KEY}/`),
    (route) => answerThroughWorker(route, env),
  );
  await page.routeWebSocket(
    (url) => url.pathname === `/${PAGE_KEY}/watch`,
    (socket) => context.ctx.acceptWebSocket({ send: (message) => socket.send(message) }),
  );
  await page.clock.install({ time: new Date(NOW) });
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
