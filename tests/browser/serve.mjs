import { createServer } from "node:http";
import { join } from "node:path";
import { readPageFiles } from "../../worker/page-files.mjs";

// Serves one app's page, named from the repo's root, as its Worker bundles it, at the server's root.
const [port, pageFolder] = process.argv.slice(2);
if (!port || !pageFolder) {
  console.error("usage: node tests/browser/serve.mjs <port> apps/<app>/page");
  process.exit(1);
}
const PAGE_FILES = new Map(
  Object.entries(readPageFiles(join(import.meta.dirname, "..", "..", pageFolder))),
);

/** @param {string} requestUrl */
function findPageFile(requestUrl) {
  try {
    const { pathname } = new URL(requestUrl, "http://localhost");
    return PAGE_FILES.get(pathname === "/" ? "index.html" : pathname.slice(1)) ?? null;
  } catch {
    return null;
  }
}

/**
 * @param {import("node:http").IncomingMessage} request
 * @param {import("node:http").ServerResponse} response
 */
function servePageFile(request, response) {
  const file = findPageFile(request.url);
  if (!file) {
    response.writeHead(404).end("not found");
    return;
  }
  response.writeHead(200, { "content-type": file.contentType });
  response.end(file.text ?? Buffer.from(file.base64, "base64"));
}

createServer(servePageFile).listen(Number(port), "127.0.0.1");
