import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";

const ROOT = join(import.meta.dirname, "..", "..");
const PORT = Number(process.argv[2]) || 4173;
const CONTENT_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
};

createServer(async (request, response) => {
  const { pathname } = new URL(request.url, "http://localhost");
  const path = normalize(decodeURIComponent(pathname));
  const file = join(ROOT, path.endsWith("/") ? `${path}index.html` : path);
  try {
    const body = await readFile(file);
    const contentType = CONTENT_TYPES[extname(file)] || "application/octet-stream";
    response.writeHead(200, { "content-type": contentType });
    response.end(body);
  } catch {
    response.writeHead(404).end("not found");
  }
}).listen(PORT, "127.0.0.1");
