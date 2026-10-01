const PAGE_HEADERS = {
  "cache-control": "no-cache",
  "x-robots-tag": "noindex, nofollow",
  "referrer-policy": "no-referrer",
  "x-content-type-options": "nosniff",
};

const decodeBase64 = (text) => Uint8Array.from(atob(text), (character) => character.charCodeAt(0));
const textEncoder = new TextEncoder();

/** @param {Record<string, { contentType: string, text?: string, base64?: string }>} pageFiles */
function decodePageFiles(pageFiles) {
  const files = new Map();
  for (const [path, { contentType, text, base64 }] of Object.entries(pageFiles)) {
    files.set(path, { contentType, body: text ?? decodeBase64(base64), etag: null });
  }
  return files;
}

/** @param {string | Uint8Array<ArrayBuffer>} body */
async function hashBody(body) {
  const bytes = typeof body === "string" ? textEncoder.encode(body) : body;
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  const hex = [...digest.subarray(0, 16)].map((byte) => byte.toString(16).padStart(2, "0"));
  return `"${hex.join("")}"`;
}

// Cloudflare weakens a file's tag when it compresses the file, so a weak copy still matches.
const hasMatchingTag = (request, etag) =>
  (request.headers.get("if-none-match") ?? "")
    .split(",")
    .some((tag) => tag.trim().replace(/^W\//, "") === etag);

const respondText = (body, status, headers = {}) =>
  new Response(body, { status, headers: { "content-type": "text/plain", ...headers } });

const serveNotFound = () => respondText("Not found\n", 404, PAGE_HEADERS);

// Relative links in the page need the address to end in a slash.
const redirectToFolder = (url) =>
  new Response(null, { status: 301, headers: { location: `${url.pathname}/${url.search}` } });

/** @param {Parameters<typeof decodePageFiles>[0]} pageFiles */
function createPageServer(pageFiles) {
  const files = decodePageFiles(pageFiles);
  // Every load asks again, and a browser that already has a file gets a 304 instead of the file.
  return async function servePageFile(request, pagePath) {
    if (request.method !== "GET" && request.method !== "HEAD")
      return respondText("GET only.\n", 405, { allow: "GET, HEAD" });
    const file = files.get(pagePath === "/" ? "index.html" : pagePath.slice(1));
    if (!file) return serveNotFound();
    file.etag ??= hashBody(file.body);
    const etag = await file.etag;
    const headers = { "content-type": file.contentType, etag, ...PAGE_HEADERS };
    if (hasMatchingTag(request, etag)) return new Response(null, { status: 304, headers });
    const body = request.method === "HEAD" ? null : file.body;
    return new Response(body, { headers });
  };
}

// robots.txt is the one path that answers without the key, so it names the commit the Worker
// was built from, for the deploy to tell its new version from the one before.
const RELEASE_COMMIT_HEADER = "x-release-commit";

/** @param {Parameters<typeof decodePageFiles>[0]} pageFiles */
function readReleaseCommit(pageFiles) {
  const release = pageFiles["version.json"]?.text;
  return release ? JSON.parse(release).commit : null;
}

/** @param {string | null} commit */
const serveRobots = (commit) =>
  respondText(
    "User-agent: *\nDisallow: /\n",
    200,
    commit ? { [RELEASE_COMMIT_HEADER]: commit } : {},
  );

// The page and its store answer only under the APP_KEY secret; nothing else does.
function findAppPath(pathname, appKey) {
  if (!appKey) return null;
  const prefix = `/${appKey}`;
  if (pathname === prefix) return "";
  return pathname.startsWith(`${prefix}/`) ? pathname.slice(prefix.length) : null;
}

const isStorePath = (appPath) =>
  appPath === "/watch" || appPath.startsWith("/store/") || appPath.startsWith("/push/");

/**
 * An app's Worker: its page, its store, its live snapshot, and any reads of its own, all under the
 * APP_KEY secret.
 * @param {object} app
 * @param {Parameters<typeof decodePageFiles>[0]} app.pageFiles
 * @param {(url: URL) => Response | Promise<Response>} app.serveSnapshot
 * @param {(request: Request, env: any, storePath: string) => Response | Promise<Response>} app.forwardToStore
 * @param {Record<string, (url: URL) => Response | Promise<Response>>} [app.reads] more GET paths
 */
export function createAppWorker({ pageFiles, serveSnapshot, forwardToStore, reads = {} }) {
  const servePageFile = createPageServer(pageFiles);
  const releaseCommit = readReleaseCommit(pageFiles);
  return {
    fetch(request, env = {}) {
      const url = new URL(request.url);
      if (url.pathname === "/robots.txt") return serveRobots(releaseCommit);
      const appPath = findAppPath(url.pathname, env.APP_KEY);
      if (appPath === null) return serveNotFound();
      if (appPath === "") return redirectToFolder(url);
      if (isStorePath(appPath)) return forwardToStore(request, env, appPath);
      if (request.method === "GET" && appPath === "/snapshot") return serveSnapshot(url);
      if (request.method === "GET" && Object.hasOwn(reads, appPath)) return reads[appPath](url);
      return servePageFile(request, appPath);
    },
  };
}
