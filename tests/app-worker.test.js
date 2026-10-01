import test from "node:test";
import assert from "node:assert/strict";
import { createAppWorker } from "../shared/worker/app-worker.js";

const answerNothing = () => new Response(null, { status: 500 });

/** @param {Record<string, { contentType: string, text?: string }>} pageFiles */
const requestRobots = (pageFiles) =>
  createAppWorker({ pageFiles, serveSnapshot: answerNothing, forwardToStore: answerNothing }).fetch(
    new Request("https://worker.example/robots.txt"),
    {},
  );

test("robots.txt names the commit the Worker was built from, and none when the build named none", async () => {
  const release = { version: "1.2.3", commit: "abc1234", builtAt: "2026-10-01T20:00:00Z" };
  const built = await requestRobots({
    "version.json": { contentType: "application/json", text: JSON.stringify(release) },
  });
  assert.equal(built.headers.get("x-release-commit"), "abc1234");
  assert.equal(await built.text(), "User-agent: *\nDisallow: /\n");

  const unnamed = await requestRobots({});
  assert.equal(unnamed.headers.get("x-release-commit"), null);
});

/** @param {Record<string, { contentType: string, text?: string }>} pageFiles */
const createPageWorker = (pageFiles) =>
  createAppWorker({ pageFiles, serveSnapshot: answerNothing, forwardToStore: answerNothing });

/**
 * @param {ReturnType<typeof createPageWorker>} worker
 * @param {string} path
 */
const requestPageFile = (worker, path) =>
  worker.fetch(new Request(`https://worker.example/key/${path}`), { APP_KEY: "key" });

test("a release's own folder serves its files for good, and another release's folder serves nothing", async () => {
  const release = { version: "1.2.3", commit: "abc1234", builtAt: "2026-10-01T20:00:00Z" };
  const worker = createPageWorker({
    "version.json": { contentType: "application/json", text: JSON.stringify(release) },
    "styles.css": { contentType: "text/css; charset=utf-8", text: "body {}" },
  });

  const pinned = await requestPageFile(worker, "release/abc1234/styles.css");
  assert.equal(pinned.status, 200);
  assert.equal(await pinned.text(), "body {}");
  assert.equal(pinned.headers.get("cache-control"), "public, max-age=31536000, immutable");

  const unpinned = await requestPageFile(worker, "styles.css");
  assert.equal(await unpinned.text(), "body {}");
  assert.equal(unpinned.headers.get("cache-control"), "no-cache");

  const otherRelease = await requestPageFile(worker, "release/def5678/styles.css");
  assert.equal(otherRelease.status, 404);
  assert.equal(otherRelease.headers.get("cache-control"), "no-cache");
});

test("a Worker built without a release has no release folder", async () => {
  const worker = createPageWorker({
    "styles.css": { contentType: "text/css; charset=utf-8", text: "body {}" },
  });

  assert.equal((await requestPageFile(worker, "release/abc1234/styles.css")).status, 404);
});
