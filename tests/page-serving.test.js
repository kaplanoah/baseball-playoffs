import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import worker from "../worker/src/index.js";

const ENV = { APP_KEY: "k3y" };
const ORIGIN = "https://mlb-live.example";
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47];

/** @param {string} path @param {{ env?: { APP_KEY?: string }, method?: string }} [options] */
const requestPage = (path, { env = ENV, method = "GET" } = {}) =>
  worker.fetch(new Request(`${ORIGIN}${path}`, { method }), env);

test("the page is a whole document with what an iPhone needs to save it as an app", async () => {
  const response = await requestPage("/k3y/");
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-type"), "text/html; charset=utf-8");
  const page = await response.text();
  assert.ok(page.startsWith("<!doctype html>\n"));
  for (const tag of [
    'content="width=device-width, initial-scale=1, viewport-fit=cover"',
    '<meta name="store" content="worker" />',
    '<link rel="manifest" href="manifest.webmanifest" />',
    '<link rel="apple-touch-icon" href="icon-180.png" />',
    '<meta name="apple-mobile-web-app-title" content="Postseason" />',
  ])
    assert.ok(page.includes(tag), tag);
  assert.ok(page.includes('<script type="module" src="js/app.js"></script>'));
});

test("every response keeps the address out of search engines and referrers", async () => {
  for (const path of ["/k3y/", "/k3y/js/app.js", "/k3y/missing.js"]) {
    const response = await requestPage(path);
    assert.equal(response.headers.get("x-robots-tag"), "noindex, nofollow", path);
    assert.equal(response.headers.get("referrer-policy"), "no-referrer", path);
  }
  const robots = await requestPage("/robots.txt", { env: {} });
  assert.equal(await robots.text(), "User-agent: *\nDisallow: /\n");
});

test("the page's files are served with their types, and the icon as PNG bytes", async () => {
  const script = await requestPage("/k3y/js/worker-store.js");
  assert.equal(script.headers.get("content-type"), "text/javascript; charset=utf-8");
  assert.equal(await script.text(), readFileSync("page/js/worker-store.js", "utf8"));

  const icon = await requestPage("/k3y/icon-180.png");
  assert.equal(icon.headers.get("content-type"), "image/png");
  const bytes = new Uint8Array(await icon.arrayBuffer());
  assert.deepEqual([...bytes.slice(0, 4)], PNG_SIGNATURE);
  assert.equal(bytes.length, readFileSync("page/icon-180.png").length);

  const manifest = await (await requestPage("/k3y/manifest.webmanifest")).json();
  assert.equal(manifest.display, "standalone");
  assert.equal(manifest.start_url, "./");
  for (const { src } of manifest.icons)
    assert.equal((await requestPage(`/k3y/${src}`)).status, 200, src);
});

test("the key without a slash redirects, so the page's relative links work", async () => {
  const response = await requestPage("/k3y?from=home");
  assert.equal(response.status, 301);
  assert.equal(response.headers.get("location"), "/k3y/?from=home");
});

test("without the key, or without an APP_KEY, there is no page", async () => {
  assert.equal((await requestPage("/other/")).status, 404);
  assert.equal((await requestPage("/k3y/", { env: {} })).status, 404);
  assert.equal((await requestPage("/k3y/nope.html")).status, 404);
  assert.equal((await requestPage("/k3y/", { method: "POST" })).status, 405);
  const head = await requestPage("/k3y/", { method: "HEAD" });
  assert.equal(head.status, 200);
  assert.equal(await head.text(), "");
});

test("the connector still answers alongside the page", async () => {
  const response = await worker.fetch(
    new Request(`${ORIGIN}/mcp`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping" }),
    }),
    ENV,
  );
  assert.deepEqual(await response.json(), { jsonrpc: "2.0", id: 1, result: {} });
});

test("the page's own snapshot route reaches the connector's snapshot", async () => {
  const response = await requestPage("/k3y/snapshot?season=1800");
  assert.equal(response.status, 400);
  assert.match((await response.json()).error, /season must be a whole year/);
  assert.equal((await requestPage("/k3y/snapshot", { method: "POST" })).status, 405);
});
