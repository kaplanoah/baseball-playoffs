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
