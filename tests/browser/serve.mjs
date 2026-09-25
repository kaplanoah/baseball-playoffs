import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";

const PAGE_ROOT = join(import.meta.dirname, "..", "..", "page");
const PORT = Number(process.argv[2]) || 4173;
const CONTENT_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
};

function resolveFilePath(requestUrl) {
  const { pathname } = new URL(requestUrl, "http://localhost");
  const requestPath = normalize(decodeURIComponent(pathname));
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
