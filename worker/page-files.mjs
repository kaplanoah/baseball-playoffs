// An app's page files as its Worker serves them. Node reads them from disk through the app's
// #page-files/<app> import; the Worker bundle gets the same data embedded by worker/build.mjs.
import { readdirSync, readFileSync } from "node:fs";
import { extname, join, relative } from "node:path";

const TEXT_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
  ".webmanifest": "application/manifest+json",
};
const BINARY_TYPES = { ".png": "image/png" };

function readPageFile(fullPath) {
  const extension = extname(fullPath);
  if (TEXT_TYPES[extension])
    return { contentType: TEXT_TYPES[extension], text: readFileSync(fullPath, "utf8") };
  if (BINARY_TYPES[extension])
    return {
      contentType: BINARY_TYPES[extension],
      base64: readFileSync(fullPath).toString("base64"),
    };
  throw new Error(
    `The Worker doesn't know how to serve ${fullPath}. Add its type to page-files.mjs.`,
  );
}

/** @param {string} pageRoot */
export function readPageFiles(pageRoot) {
  const entries = readdirSync(pageRoot, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => join(entry.parentPath, entry.name))
    .sort();
  return Object.fromEntries(
    entries.map((fullPath) => [
      relative(pageRoot, fullPath).split("\\").join("/"),
      readPageFile(fullPath),
    ]),
  );
}
