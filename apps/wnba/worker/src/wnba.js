// Reading the league's own feeds, which every route the Worker serves shares.

export const UPSTREAM_TIMEOUT_MS = 8000;
const FIRST_SEASON = 1997;
const LAST_SEASON = 2100;
export const SEASON_RULE = `season must be a whole year between ${FIRST_SEASON} and ${LAST_SEASON}`;

// The league's feeds answer only what looks like its own site in a browser: without these, the
// CDN answers with a web page and the stats site never answers at all.
export const FEED_HEADERS = {
  accept: "application/json, text/plain, */*",
  "accept-language": "en-US,en;q=0.9",
  "user-agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36",
  origin: "https://www.wnba.com",
  referer: "https://www.wnba.com/",
  "sec-fetch-dest": "empty",
  "sec-fetch-mode": "cors",
  "sec-fetch-site": "same-site",
};

function parseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/**
 * Reads one of the league's feeds, letting Cloudflare's edge keep the answer for `cacheSeconds`, or
 * not at all when it's null. A refusal comes back as a web page with a 200, which the edge keeps
 * like any answer, so only JSON that `hasData` finds its data in counts as an answer.
 * @param {(input: string, init: object) => Promise<Response>} fetchImpl
 * @param {string} url
 * @param {number | null} cacheSeconds
 * @param {(answer: any) => boolean} hasData
 */
export async function fetchWnbaJson(fetchImpl, url, cacheSeconds, hasData) {
  const response = await fetchImpl(url, {
    headers: FEED_HEADERS,
    signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    ...(cacheSeconds !== null && { cf: { cacheTtl: cacheSeconds, cacheEverything: true } }),
  });
  const path = new URL(url).pathname;
  if (!response.ok)
    throw Object.assign(new Error(`The WNBA answered ${response.status} for ${path}`), {
      status: response.status,
    });
  const answer = parseJson(await response.text());
  if (!hasData(answer)) throw new Error(`The WNBA answered ${path} with something other than data`);
  return answer;
}

/**
 * The season a request names, this year's when it names none, or null when it isn't one.
 * @param {URLSearchParams} searchParams
 * @param {number} now
 */
export function readSeasonParam(searchParams, now) {
  if (!searchParams.has("season")) return new Date(now).getUTCFullYear();
  const season = Number(searchParams.get("season"));
  const isValid = Number.isInteger(season) && season >= FIRST_SEASON && season <= LAST_SEASON;
  return isValid ? season : null;
}
