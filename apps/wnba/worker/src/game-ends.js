// When each game ended, to the second. The league's feeds don't say, so a game seen live and then
// final is looked up in ESPN's summary, which logs the time of its last play once ESPN has caught
// up. Until then it's asked again every few minutes, for a while.

const RETRY_MS = 2 * 60 * 1000;
const GIVE_UP_MS = 30 * 60 * 1000;

/**
 * @param {object} options
 * @param {(game: any) => Promise<string | null>} options.loadEndTime
 * @param {() => number} options.now
 */
export function createGameEnds({ loadEndTime, now }) {
  /** @type {Set<string>} */
  const liveIds = new Set();
  /** @type {Map<string, { finishedAt: number, triedAt: number, end: string | null }>} */
  const endings = new Map();

  /** @param {any[]} games */
  function noteFinishes(games) {
    for (const game of games) {
      if (game.state === "final" && liveIds.has(game.id) && !endings.has(game.id))
        endings.set(game.id, { finishedAt: now(), triedAt: -Infinity, end: null });
      if (game.state === "live") liveIds.add(game.id);
      else liveIds.delete(game.id);
    }
  }

  /** @param {{ finishedAt: number, triedAt: number, end: string | null }} ending */
  const isDueForLookup = (ending) =>
    !ending.end && now() - ending.finishedAt < GIVE_UP_MS && now() - ending.triedAt >= RETRY_MS;

  /** @param {any} game */
  async function lookUpEnd(game) {
    const ending = endings.get(game.id);
    ending.triedAt = now();
    ending.end = await loadEndTime(game).catch(() => null);
  }

  return {
    /**
     * The games, each that ended while watched with its `end` once ESPN has it.
     * @param {any[]} games
     */
    async addEnds(games) {
      noteFinishes(games);
      const due = games.filter(
        (game) => endings.has(game.id) && isDueForLookup(endings.get(game.id)),
      );
      await Promise.all(due.map(lookUpEnd));
      return games.map((game) => {
        const end = endings.get(game.id)?.end;
        return end ? { ...game, end } : game;
      });
    },
  };
}
