import { test } from "node:test";
import assert from "node:assert/strict";
import { fetchLive } from "../page/js/live-fetch.js";
import { UPSTREAM_TIMEOUT_MS } from "../../../shared/worker/upstream.js";

const SNAPSHOT = { version: 1, season: 2026 };

globalThis.location = /** @type {any} */ ({ href: "https://mlb-live.example/k3y/" });

test("the page reads the snapshot from the Worker that serves it", async () => {
  const requested = [];
  globalThis.fetch = async (url) => {
    requested.push(String(url));
    return new Response(JSON.stringify(SNAPSHOT));
  };
  assert.deepEqual(await fetchLive(2026), SNAPSHOT);
  assert.deepEqual(requested, ["https://mlb-live.example/k3y/snapshot?season=2026"]);
});

test("an error from the Worker keeps its reason, and an unexpected answer says so", async () => {
  globalThis.fetch = async () =>
    new Response(JSON.stringify({ error: "MLB is down" }), { status: 502 });
  await assert.rejects(fetchLive(2026), { code: "upstream_error", message: "MLB is down" });
  globalThis.fetch = async () => new Response(JSON.stringify({ version: 1, season: 2025 }));
  await assert.rejects(fetchLive(2026), { code: "bad_payload" });
});

test("the page waits out the Worker's two rounds of MLB requests", async (context) => {
  const waits = [];
  const timeout = AbortSignal.timeout;
  context.mock.method(AbortSignal, "timeout", (milliseconds) => {
    waits.push(milliseconds);
    return timeout.call(AbortSignal, milliseconds);
  });
  globalThis.fetch = async () => new Response(JSON.stringify(SNAPSHOT));
  await fetchLive(2026);
  assert.ok(waits[0] > 2 * UPSTREAM_TIMEOUT_MS);
});
