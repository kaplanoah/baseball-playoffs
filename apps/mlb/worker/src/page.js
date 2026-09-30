import PAGE_FILES from "#page-files/mlb";

const PAGE_HEADERS = {
  "cache-control": "no-cache",
  "x-robots-tag": "noindex, nofollow",
  "referrer-policy": "no-referrer",
  "x-content-type-options": "nosniff",
};

const decodeBase64 = (text) => Uint8Array.from(atob(text), (character) => character.charCodeAt(0));

function readPageFiles() {
  const files = new Map();
  for (const [path, { contentType, text, base64 }] of Object.entries(PAGE_FILES)) {
    files.set(path, { contentType, body: text ?? decodeBase64(base64) });
  }
  return files;
}

const pageFiles = readPageFiles();

const respondText = (body, status, headers = {}) =>
  new Response(body, { status, headers: { "content-type": "text/plain", ...headers } });

export const serveNotFound = () => respondText("Not found\n", 404, PAGE_HEADERS);

// Relative links in the page need the address to end in a slash.
export const redirectToFolder = (url) =>
  new Response(null, { status: 301, headers: { location: `${url.pathname}/${url.search}` } });

export function servePageFile(request, pagePath) {
  if (request.method !== "GET" && request.method !== "HEAD")
    return respondText("GET only.\n", 405, { allow: "GET, HEAD" });
  const file = pageFiles.get(pagePath === "/" ? "index.html" : pagePath.slice(1));
  if (!file) return serveNotFound();
  const body = request.method === "HEAD" ? null : file.body;
  return new Response(body, { headers: { "content-type": file.contentType, ...PAGE_HEADERS } });
}

export const serveRobots = () => respondText("User-agent: *\nDisallow: /\n", 200);
