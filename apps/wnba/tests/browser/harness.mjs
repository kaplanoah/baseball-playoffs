import { readFileSync } from "node:fs";
import { buildSnapshot } from "../../page/js/snapshot.js";
import { createBoxScoreServer, nameBoxScoreRequest } from "../../worker/src/box-score.js";
import { createPreviewServer, listPreviewRequests } from "../../worker/src/preview.js";
import { SeasonStore } from "../../worker/src/store.js";
import {
  test,
  expect,
  createTestStore,
  connectToStore,
  loadPageAt,
} from "../../../../tests/browser/harness.mjs";
import { holdStore } from "../../../../tests/browser/hold-store.mjs";

const AFTERNOON = JSON.parse(
  readFileSync(new URL("../fixtures/2026-09-30-afternoon.json", import.meta.url), "utf8"),
);
const NOW = AFTERNOON.now;
const GAMES = JSON.parse(
  readFileSync(new URL("../fixtures/2026-10-01-games.json", import.meta.url), "utf8"),
);

export { test, expect, GAMES };

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

/**
 * The page as the Worker serves it, with the Worker's store behind it, already updated once from
 * the afternoon's feeds, and the game sheet's routes reading the league's recorded answers.
 * @param {import("@playwright/test").Page} page
 * @param {{ league?: Parameters<typeof createLeagueFetch>[0] }} [options]
 */
export async function openApp(page, { league = {} } = {}) {
  const loadSnapshot = async (season) =>
    buildSnapshot(
      { ...AFTERNOON.responses, players: GAMES.preview.players },
      { season, now: Date.parse(NOW) },
    );
  const testStore = createTestStore(SeasonStore, { loadSnapshot, now: NOW });
  const { context, store } = testStore;
  await store.alarm();

  await connectToStore(page, testStore);
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
  await loadPageAt(page, NOW);

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
