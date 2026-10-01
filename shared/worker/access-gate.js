// A Worker with the ACCESS_CODE secret asks for that code before its page opens. A phone that
// sends it gets a cookie signed with the code and the page's key, so a new code signs every
// phone out, and the Worker holds nothing about who has signed in.
import { respondError, respondJson } from "./responses.js";

export const ACCESS_PATH = "/access";

const COOKIE_NAME = "access";
// Browsers keep a cookie 400 days at most, and every visit to the page starts the count again.
const COOKIE_MAX_AGE_SECONDS = 400 * 24 * 60 * 60;
const textEncoder = new TextEncoder();

/**
 * The code as it's compared: phones capitalize, space, and hyphenate what's typed on their own.
 * @param {string} text
 */
export const normalizeCode = (text) => text.replace(/[\s-]/g, "").toUpperCase();

function encodeBase64Url(buffer) {
  let binary = "";
  for (const byte of new Uint8Array(buffer)) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/**
 * @param {string} code
 * @param {string} appKey
 */
async function signCode(code, appKey) {
  const key = await crypto.subtle.importKey(
    "raw",
    textEncoder.encode(appKey),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, textEncoder.encode(normalizeCode(code)));
  return encodeBase64Url(signature);
}

// Every character is compared, so how long a check takes says nothing about how close a guess was.
/**
 * @param {string} first
 * @param {string} second
 */
function isSameText(first, second) {
  if (first.length !== second.length) return false;
  let difference = 0;
  for (let index = 0; index < first.length; index += 1)
    difference |= first.charCodeAt(index) ^ second.charCodeAt(index);
  return difference === 0;
}

/** @param {Request} request */
function readAccessCookie(request) {
  for (const cookie of (request.headers.get("cookie") ?? "").split(";")) {
    const [name, ...value] = cookie.trim().split("=");
    if (name === COOKIE_NAME) return value.join("=");
  }
  return null;
}

/**
 * Whether the phone may see the page: "open" when it may, "missing" when it never sent the
 * code, and "changed" when the code it sent is no longer the one asked for.
 * @param {Request} request
 * @param {any} env
 * @returns {Promise<"open" | "missing" | "changed">}
 */
export async function readAccess(request, env) {
  if (!env.ACCESS_CODE) return "open";
  const cookie = readAccessCookie(request);
  if (cookie === null) return "missing";
  return isSameText(cookie, await signCode(env.ACCESS_CODE, env.APP_KEY)) ? "open" : "changed";
}

/**
 * @param {Request} request
 * @param {any} env
 */
export async function createAccessCookie(request, env) {
  const isSecure = new URL(request.url).protocol === "https:";
  return [
    `${COOKIE_NAME}=${await signCode(env.ACCESS_CODE, env.APP_KEY)}`,
    `Path=/${env.APP_KEY}/`,
    `Max-Age=${COOKIE_MAX_AGE_SECONDS}`,
    "HttpOnly",
    // Lax, not Strict, so a link tapped in another site's page still opens the app.
    "SameSite=Lax",
    ...(isSecure ? ["Secure"] : []),
  ].join("; ");
}

// Without the binding, as in tests, nothing limits how often a phone tries.
/**
 * @param {Request} request
 * @param {any} env
 */
async function isWithinTryLimit(request, env) {
  if (!env.ACCESS_LIMIT) return true;
  const address = request.headers.get("cf-connecting-ip") ?? "unknown";
  const { success } = await env.ACCESS_LIMIT.limit({
    key: `${new URL(request.url).hostname} ${address}`,
  });
  return success;
}

/** @param {Request} request */
async function readSentCode(request) {
  const body = await request.json().catch(() => null);
  return typeof body?.code === "string" ? body.code : null;
}

/**
 * @param {Request} request
 * @param {any} env
 */
async function checkSentCode(request, env) {
  const code = await readSentCode(request);
  if (code === null) return respondError(400, "bad_request", "Send the code as { code }.");
  if (!(await isWithinTryLimit(request, env)))
    return respondError(429, "too_many_tries", "Too many tries. Try again in a minute.");
  const expected = await signCode(env.ACCESS_CODE, env.APP_KEY);
  if (!isSameText(await signCode(code, env.APP_KEY), expected))
    return respondError(401, "wrong_code", "That code isn't right.");
  return new Response(null, {
    status: 204,
    headers: { "set-cookie": await createAccessCookie(request, env) },
  });
}

/**
 * The page's access route: a GET says whether the phone's code has changed, and a POST of the
 * code signs the phone in.
 * @param {Request} request
 * @param {any} env
 */
export async function serveAccess(request, env) {
  if (!env.ACCESS_CODE) return respondError(404, "not_found", "This page needs no code.");
  if (request.method === "GET")
    return respondJson({ isChanged: (await readAccess(request, env)) === "changed" });
  if (request.method === "POST") return checkSentCode(request, env);
  return respondError(405, "method_not_allowed", "GET or POST only.");
}

export const respondAccessRequired = () =>
  respondError(401, "access_required", "This page needs its access code.");
