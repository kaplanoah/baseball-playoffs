import { createSeasonParam } from "../../../../shared/worker/seasons.js";
import { fetchUpstream } from "../../../../shared/worker/upstream.js";

// Reading the league's own feeds, which every route the Worker serves shares.

export const SEASON_PARAM = createSeasonParam({
  firstSeason: 1997,
  readCurrentSeason: (now) => new Date(now).getUTCFullYear(),
});

// The league's feeds answer only what looks like its own site in a browser: without these, the
// CDN answers with a web page and the stats site never answers at all. The stats site also hangs
// on a caller that can't take a compressed answer, and can answer anything but gzip alone from a
// months-old copy.
export const FEED_HEADERS = {
  accept: "application/json, text/plain, */*",
  "accept-encoding": "gzip",
  "accept-language": "en-US,en;q=0.9",
  "user-agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36",
  origin: "https://www.wnba.com",
  referer: "https://www.wnba.com/",
  "sec-fetch-dest": "empty",
  "sec-fetch-mode": "cors",
  "sec-fetch-site": "same-site",
};

// ESPN answers any caller, so it needs only to be asked for JSON.
export const ESPN_HEADERS = { accept: "application/json", "user-agent": FEED_HEADERS["user-agent"] };

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
  const response = await fetchUpstream(fetchImpl, url, { headers: FEED_HEADERS, cacheSeconds });
  const path = new URL(url).pathname;
  if (!response.ok)
    throw Object.assign(new Error(`The WNBA answered ${response.status} for ${path}`), {
      status: response.status,
    });
  const answer = parseJson(await response.text());
  if (!hasData(answer)) throw new Error(`The WNBA answered ${path} with something other than data`);
  return answer;
}
