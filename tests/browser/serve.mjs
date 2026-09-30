import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";

// Serves one app's page folder, named from the repo's root.
const [port, pageFolder] = process.argv.slice(2);
if (!port || !pageFolder) {
  console.error("usage: node tests/browser/serve.mjs <port> apps/<app>/page");
  process.exit(1);
}
const PORT = Number(port);
const PAGE_ROOT = join(import.meta.dirname, "..", "..", pageFolder);
// The Worker serves the shared page files under shared/, where the import map points #shared/.
const SHARED_ROOT = join(import.meta.dirname, "..", "..", "shared", "page");
const SHARED_PREFIX = "/shared/";
const CONTENT_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8",
};

function resolveFilePath(requestUrl) {
  const { pathname } = new URL(requestUrl, "http://localhost");
  const requestPath = normalize(decodeURIComponent(pathname));
  if (requestPath.startsWith(SHARED_PREFIX))
    return join(SHARED_ROOT, requestPath.slice(SHARED_PREFIX.length));
  return join(PAGE_ROOT, requestPath.endsWith("/") ? `${requestPath}index.html` : requestPath);
}

async function servePageFile(request, response) {
  const filePath = resolveFilePath(request.url);
  try {
    const body = await readFile(filePath);
    const contentType = CONTENT_TYPES[extname(filePath)] || "application/octet-stream";
    response.writeHead(200, { "content-type": contentType });
    response.end(body);
  } catch {
    response.writeHead(404).end("not found");
  }
}

createServer(servePageFile).listen(PORT, "127.0.0.1");
