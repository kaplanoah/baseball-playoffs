// A league's slower feeds, each read again only when it may have changed: as a game ends, for a
// feed that changes with games, or once its answer is older than the feed's own limit. A game's end reaches a league's stats a little
// after its scoreboard, so a feed is read as a game ends and once more a few minutes later. Each
// keeps its last good answer to stand in when a read fails, and one that didn't answer isn't asked
// again for a while, since a hung read holds up each update until it times out.

const SETTLE_MS = 10 * 60 * 1000;
const FAILED_FEED_WAIT_MS = 5 * 60 * 1000;

/**
 * @param {object} options
 * @param {Record<string, { maxAgeMs: number, changesWithGames: boolean }>} options.feeds how old
 *   each feed's answer may get, and whether a game's end changes it
 * @param {string} options.leagueName the league as an error names it, as in "MLB didn't answer"
 * @param {() => number} options.now
 */
export function createFeedKeeper({ feeds, leagueName, now }) {
  /** @type {Map<string, { at: number, data: any }>} */
  const kept = new Map();
  /** @type {Map<string, number>} */
  const failedAt = new Map();
  /** @type {number | null} */
  let lastFinalCount = null;
  let lastFinalAt = -Infinity;

  /** @param {number} readAt */
  const isReadBeforeFinalSettled = (readAt) =>
    readAt < lastFinalAt || (readAt < lastFinalAt + SETTLE_MS && now() >= lastFinalAt + SETTLE_MS);

  /**
   * @param {string} name
   * @param {string} key
   */
  function isDue(name, key) {
    const failed = failedAt.get(key);
    if (failed !== undefined && now() - failed < FAILED_FEED_WAIT_MS) return false;
    const answer = kept.get(key);
    const { maxAgeMs, changesWithGames } = feeds[name];
    if (!answer || now() - answer.at >= maxAgeMs) return true;
    return changesWithGames && isReadBeforeFinalSettled(answer.at);
  }

  return {
    /**
     * Notes how many games have ended, as the league's scoreboard counts them. A count that
     * couldn't be read is null, and leaves the last one standing.
     * @param {number | null} count
     */
    noteFinalCount(count) {
      if (count === null) return;
      if (lastFinalCount !== null && count > lastFinalCount) lastFinalAt = now();
      lastFinalCount = count;
    },

    /**
     * The feed's kept answer while it's still good, or a new one from `load`.
     * @param {string} name which feed's limit applies
     * @param {string} key the request, so that each season's answers are kept apart
     * @param {() => Promise<any>} load
     */
    async readFeed(name, key, load) {
      const answer = kept.get(key);
      if (!isDue(name, key)) {
        if (answer) return answer.data;
        throw new Error(`${leagueName} didn't answer ${name} a moment ago`);
      }
      try {
        const data = await load();
        kept.set(key, { at: now(), data });
        failedAt.delete(key);
        return data;
      } catch (error) {
        failedAt.set(key, now());
        if (answer) return answer.data;
        throw error;
      }
    },
  };
}
