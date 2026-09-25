import PAGE_FILES from "#page-files";

// What claude.ai adds around the page, plus what an iPhone needs to save it as a full-screen app.
const HEAD_TAGS = [
  '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />',
  '<meta name="store" content="worker" />',
  '<link rel="manifest" href="manifest.webmanifest" />',
  '<link rel="icon" href="icon.svg" type="image/svg+xml" />',
  '<link rel="apple-touch-icon" href="icon-180.png" />',
  '<meta name="apple-mobile-web-app-capable" content="yes" />',
  '<meta name="apple-mobile-web-app-title" content="Postseason" />',
  '<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />',
  '<meta name="theme-color" content="#0d1f16" />',
];
const CHARSET_TAG = '<meta charset="utf-8" />';

const PAGE_HEADERS = {
  "cache-control": "no-cache",
  "x-robots-tag": "noindex, nofollow",
  "referrer-policy": "no-referrer",
  "x-content-type-options": "nosniff",
};

export function wrapPage(indexHtml) {
  if (!indexHtml.includes(CHARSET_TAG)) throw new Error(`page/index.html lost its ${CHARSET_TAG}`);
  const head = [CHARSET_TAG, ...HEAD_TAGS].join("\n  ");
  return `<!doctype html>\n${indexHtml.replace(CHARSET_TAG, head)}`;
}

const decodeBase64 = (text) => Uint8Array.from(atob(text), (character) => character.charCodeAt(0));

function readPageFiles() {
  const files = new Map();
  for (const [path, { contentType, text, base64 }] of Object.entries(PAGE_FILES)) {
    const body = path === "index.html" ? wrapPage(text) : (text ?? decodeBase64(base64));
    files.set(path, { contentType, body });
  }
  return files;
}

const pageFiles = readPageFiles();

const respondText = (body, status, headers = {}) =>
  new Response(body, { status, headers: { "content-type": "text/plain", ...headers } });

// Relative links in the page need the address to end in a slash.
export const redirectToFolder = (url) =>
  new Response(null, { status: 301, headers: { location: `${url.pathname}/${url.search}` } });

export function servePageFile(request, pagePath) {
  if (request.method !== "GET" && request.method !== "HEAD")
    return respondText("GET only.\n", 405, { allow: "GET, HEAD" });
  const file = pageFiles.get(pagePath === "/" ? "index.html" : pagePath.slice(1));
  if (!file) return respondText("Not found\n", 404, PAGE_HEADERS);
  const body = request.method === "HEAD" ? null : file.body;
  return new Response(body, { headers: { "content-type": file.contentType, ...PAGE_HEADERS } });
}

export const serveRobots = () => respondText("User-agent: *\nDisallow: /\n", 200);
