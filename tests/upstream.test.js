import test from "node:test";
import assert from "node:assert/strict";
import {
  createReusedLoader,
  fetchUpstream,
  UPSTREAM_TIMEOUT_MS,
} from "../shared/worker/upstream.js";

const HEADERS = { accept: "application/json" };

function recordFetches() {
  const requests = [];
  const fetchImpl = async (url, init) => {
    requests.push({ url, init });
    return new Response("{}");
  };
  return { requests, fetchImpl };
}

test("a feed's answer is kept at the edge as long as the caller says", async () => {
  const { requests, fetchImpl } = recordFetches();

  await fetchUpstream(fetchImpl, "https://feed.example/a", { headers: HEADERS, cacheSeconds: 15 });

  const [{ url, init }] = requests;
  assert.equal(url, "https://feed.example/a");
  assert.deepEqual(init.headers, HEADERS);
  assert.deepEqual(init.cf, { cacheTtl: 15, cacheEverything: true });
  assert.ok(init.signal instanceof AbortSignal);
});

test("a feed read with no edge cache time sends no cache options", async () => {
  const { requests, fetchImpl } = recordFetches();

  await fetchUpstream(fetchImpl, "https://feed.example/a", {
    headers: HEADERS,
    cacheSeconds: null,
  });

  assert.equal(Object.hasOwn(requests[0].init, "cf"), false);
});

test("a feed that doesn't answer is given up on after the upstream timeout", async (context) => {
  context.mock.timers.enable({ apis: ["setTimeout"] });
  const fetchImpl = (url, init) =>
    new Promise((resolve, reject) => {
      init.signal.addEventListener("abort", () => reject(init.signal.reason));
    });

  const reading = fetchUpstream(fetchImpl, "https://feed.example/a", {
    headers: HEADERS,
    cacheSeconds: 5,
  });
  context.mock.timers.tick(UPSTREAM_TIMEOUT_MS);

  await assert.rejects(reading, { name: "TimeoutError" });
});

test("a feed's whole answer is read before its timer stops", async (context) => {
  context.mock.timers.enable({ apis: ["setTimeout"] });
  const { requests } = recordFetches();
  const fetchImpl = async (url, init) => {
    requests.push({ url, init });
    return new Response('{"games":[]}', { status: 203, headers: { "x-feed": "1" } });
  };

  const response = await fetchUpstream(fetchImpl, "https://feed.example/a", {
    headers: HEADERS,
    cacheSeconds: 5,
  });
  context.mock.timers.tick(UPSTREAM_TIMEOUT_MS);

  assert.equal(requests[0].init.signal.aborted, false);
  assert.deepEqual(
    [response.status, response.headers.get("x-feed"), await response.json()],
    [203, "1", { games: [] }],
  );
});

function createCountingLoad() {
  const calls = [];
  const load = async (key, requestedAt) => {
    calls.push({ key, requestedAt });
    return `${key} at ${requestedAt}`;
  };
  return { calls, load };
}

test("a reused loader shares one load per key until it's older than the reuse time", async () => {
  let now = 1000;
  const { calls, load } = createCountingLoad();
  const loadReused = createReusedLoader(load, 10_000, () => now);

  const first = loadReused(2026);
  assert.equal(loadReused(2026), first);
  now += 9_999;
  assert.equal(await loadReused(2026), "2026 at 1000");
  assert.equal(await loadReused(2025), "2025 at 10999");
  now += 1;
  assert.equal(await loadReused(2026), "2026 at 11000");

  assert.deepEqual(
    calls.map(({ key }) => key),
    [2026, 2025, 2026],
  );
});

test("a reused loader forgets a load that failed, so the next call tries again", async () => {
  let attempts = 0;
  const loadReused = createReusedLoader(
    async () => {
      attempts += 1;
      if (attempts === 1) throw new Error("The league answered 503");
      return "answered";
    },
    10_000,
    () => 1000,
  );

  await assert.rejects(loadReused(2026), /503/);
  assert.equal(await loadReused(2026), "answered");
  assert.equal(await loadReused(2026), "answered");
  assert.equal(attempts, 2);
});

test("a read logs whether Cloudflare's edge kept the answer, and nothing when it had no part", async (context) => {
  const logged = context.mock.method(console, "log", () => {});
  const answer = (headers) => async () => new Response("{}", { headers });

  await fetchUpstream(answer({ "cf-cache-status": "HIT" }), "https://feed.example/a", {
    headers: HEADERS,
    cacheSeconds: 15,
  });
  await fetchUpstream(answer({}), "https://feed.example/a", { headers: HEADERS, cacheSeconds: 15 });

  assert.deepEqual(
    logged.mock.calls.map((call) => call.arguments),
    [["feed.example cache: HIT"]],
  );
});
