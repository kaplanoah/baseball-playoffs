const PAGE_HEADERS = {
  "cache-control": "no-cache",
  "x-robots-tag": "noindex, nofollow",
  "referrer-policy": "no-referrer",
  "x-content-type-options": "nosniff",
};

const decodeBase64 = (text) => Uint8Array.from(atob(text), (character) => character.charCodeAt(0));

/** @param {Record<string, { contentType: string, text?: string, base64?: string }>} pageFiles */
function decodePageFiles(pageFiles) {
  const files = new Map();
  for (const [path, { contentType, text, base64 }] of Object.entries(pageFiles)) {
    files.set(path, { contentType, body: text ?? decodeBase64(base64) });
  }
  return files;
}

const respondText = (body, status, headers = {}) =>
  new Response(body, { status, headers: { "content-type": "text/plain", ...headers } });

const serveNotFound = () => respondText("Not found\n", 404, PAGE_HEADERS);

// Relative links in the page need the address to end in a slash.
const redirectToFolder = (url) =>
  new Response(null, { status: 301, headers: { location: `${url.pathname}/${url.search}` } });

/** @param {Parameters<typeof decodePageFiles>[0]} pageFiles */
function createPageServer(pageFiles) {
  const files = decodePageFiles(pageFiles);
  return function servePageFile(request, pagePath) {
    if (request.method !== "GET" && request.method !== "HEAD")
      return respondText("GET only.\n", 405, { allow: "GET, HEAD" });
    const file = files.get(pagePath === "/" ? "index.html" : pagePath.slice(1));
    if (!file) return serveNotFound();
    const body = request.method === "HEAD" ? null : file.body;
    return new Response(body, { headers: { "content-type": file.contentType, ...PAGE_HEADERS } });
  };
}

const serveRobots = () => respondText("User-agent: *\nDisallow: /\n", 200);

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
  return {
    fetch(request, env = {}) {
      const url = new URL(request.url);
      if (url.pathname === "/robots.txt") return serveRobots();
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
