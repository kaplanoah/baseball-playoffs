import { MLB_API, readEasternDay } from "../../page/js/snapshot.js";

export const UPSTREAM_TIMEOUT_MS = 8000;
const FIRST_SEASON = 1995;
const LAST_SEASON = 2100;
export const SEASON_RULE = `season must be a whole year between ${FIRST_SEASON} and ${LAST_SEASON}`;
export const DATE_RULE = `date must be a day written YYYY-MM-DD from ${FIRST_SEASON} to ${LAST_SEASON}`;

/**
 * The season a request names, this year's when it names none, or null when it isn't one.
 * @param {URLSearchParams} searchParams
 * @param {number} now
 */
export function readSeasonParam(searchParams, now) {
  if (!searchParams.has("season")) return readEasternDay(now).year;
  const season = Number(searchParams.get("season"));
  const isValid = Number.isInteger(season) && season >= FIRST_SEASON && season <= LAST_SEASON;
  return isValid ? season : null;
}

/**
 * The "YYYY-MM-DD" day a request names, or null when it names none or one that isn't a real day.
 * @param {URLSearchParams} searchParams
 */
export function readDateParam(searchParams) {
  const date = searchParams.get("date") ?? "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const [year, month, day] = date.split("-").map(Number);
  const isRealDay = new Date(Date.UTC(year, month - 1, day)).toISOString().startsWith(date);
  return isRealDay && year >= FIRST_SEASON && year <= LAST_SEASON ? date : null;
}

/**
 * Reads a path from MLB's Stats API, letting Cloudflare's edge keep the answer for `cacheSeconds`.
 * @param {(input: string, init: object) => Promise<Response>} fetchImpl
 * @param {string} path
 * @param {number} cacheSeconds
 */
export async function fetchMlbJson(fetchImpl, path, cacheSeconds) {
  const response = await fetchImpl(MLB_API + path, {
    headers: { accept: "application/json", "user-agent": "mlb-postseason-page/1.0" },
    signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    cf: { cacheTtl: cacheSeconds, cacheEverything: true },
  });
  if (!response.ok)
    throw new Error(`MLB Stats API answered ${response.status} for ${path.split("?")[0]}`);
  return response.json();
}
