import { isSameJson } from "#shared/compare.js";
import { createMemoryStorage } from "../../../../shared/worker/feed-keeper.js";

// When each game ended, to the second. The league's feeds don't say, so a game seen live and then
// final is looked up in ESPN's summary, which logs the time of its last play once ESPN has caught
// up. Until then it's asked again every few minutes, for a while. Which games were live, and what
// ESPN said, go in `storage`, since a Durable Object leaves memory between updates.

const RETRY_MS = 2 * 60 * 1000;
const GIVE_UP_MS = 30 * 60 * 1000;
// An ending this old is long settled, so it's let go.
const FORGET_MS = 24 * 60 * 60 * 1000;
const STORAGE_KEY = "game-ends";

/** @typedef {{ finishedAt: number, triedAt: number, end: string | null }} Ending */

/**
 * @param {object} options
 * @param {(game: any) => Promise<string | null>} options.loadEndTime
 * @param {() => number} options.now
 * @param {import("../../../../shared/worker/feed-keeper.js").FeedStorage} [options.storage]
 */
export function createGameEnds({ loadEndTime, now, storage = createMemoryStorage() }) {
  /** @returns {Promise<{ liveIds: string[], endings: Record<string, Ending> }>} */
  async function readState() {
    return (await storage.get(STORAGE_KEY)) ?? { liveIds: [], endings: {} };
  }

  /**
   * @param {{ liveIds: string[], endings: Record<string, Ending> }} state
   * @param {any[]} games
   */
  function noteFinishes({ liveIds, endings }, games) {
    const wasLive = new Set(liveIds);
    for (const game of games) {
      if (game.state === "final" && wasLive.has(game.id) && !endings[game.id])
        endings[game.id] = { finishedAt: now(), triedAt: -Infinity, end: null };
    }
    const stillKept = Object.entries(endings).filter(
      ([, ending]) => now() - ending.finishedAt < FORGET_MS,
    );
    return {
      liveIds: games.filter((game) => game.state === "live").map((game) => game.id),
      endings: Object.fromEntries(stillKept),
    };
  }

  /** @param {Ending | undefined} ending */
  const isDueForLookup = (ending) =>
    !!ending &&
    !ending.end &&
    now() - ending.finishedAt < GIVE_UP_MS &&
    now() - ending.triedAt >= RETRY_MS;

  /**
   * @param {any} game
   * @param {Ending} ending
   */
  async function lookUpEnd(game, ending) {
    ending.triedAt = now();
    ending.end = await loadEndTime(game).catch(() => null);
  }

  return {
    /**
     * The games, each that ended while watched with its `end` once ESPN has it.
     * @param {any[]} games
     */
    async addEnds(games) {
      const saved = await readState();
      const state = noteFinishes(structuredClone(saved), games);
      const due = games.filter((game) => isDueForLookup(state.endings[game.id]));
      await Promise.all(due.map((game) => lookUpEnd(game, state.endings[game.id])));
      if (!isSameJson(saved, state)) await storage.put(STORAGE_KEY, state);
      return games.map((game) => {
        const end = state.endings[game.id]?.end;
        return end ? { ...game, end } : game;
      });
    },
  };
}
