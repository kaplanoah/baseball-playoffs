// Reading a league's own feeds, which every app's Worker does the same way.

export const UPSTREAM_TIMEOUT_MS = 8000;

/**
 * Asks a feed for `url`, giving up after UPSTREAM_TIMEOUT_MS, and letting Cloudflare's edge keep
 * the answer for `cacheSeconds`, or not at all when it's null.
 * @param {(input: string, init: object) => Promise<Response>} fetchImpl
 * @param {string} url
 * @param {{ headers: Record<string, string>, cacheSeconds: number | null }} options
 */
export const fetchUpstream = (fetchImpl, url, { headers, cacheSeconds }) =>
  fetchImpl(url, {
    headers,
    signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    ...(cacheSeconds !== null && { cf: { cacheTtl: cacheSeconds, cacheEverything: true } }),
  });

/**
 * `load`, except that a call for a key loaded in the last `reuseMs`, or still loading, gets that
 * load's promise. A load that fails is forgotten, so the next call tries again.
 * @template Key, Value
 * @param {(key: Key, requestedAt: number) => Promise<Value>} load
 * @param {number} reuseMs
 * @param {() => number} now
 * @returns {(key: Key) => Promise<Value>}
 */
export function createReusedLoader(load, reuseMs, now) {
  const recentLoads = new Map();
  return (key) => {
    const requestedAt = now();
    const recent = recentLoads.get(key);
    if (recent && requestedAt - recent.at < reuseMs) return recent.promise;
    const promise = load(key, requestedAt);
    recentLoads.set(key, { at: requestedAt, promise });
    promise.catch(() => {
      if (recentLoads.get(key)?.promise === promise) recentLoads.delete(key);
    });
    return promise;
  };
}
