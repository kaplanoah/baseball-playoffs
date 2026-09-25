import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import * as MLBSnapshot from "../page/js/snapshot.js";
import { createWorker } from "../worker/src/mcp.js";

const EVENING = JSON.parse(
  readFileSync(path.join(import.meta.dirname, "fixtures/2026-09-24-evening.json"), "utf8"),
);
const NOW = Date.parse(EVENING.now);

function createFakeMlb({ status = 200 } = {}) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    const kind = url.includes("/seasons/")
      ? "season"
      : url.includes("/standings")
        ? "standings"
        : url.includes("/postseason")
          ? "postseason"
          : "schedule";
    return new Response(JSON.stringify(EVENING.responses[kind]), { status });
  };
  return { fetchImpl, calls };
}
function createTestWorker(options = {}) {
  const mlb = createFakeMlb(options);
  let now = NOW;
  const worker = createWorker({ fetchImpl: mlb.fetchImpl, now: () => now });
  return {
    worker,
    mlb,
    advanceClock: (milliseconds) => {
      now += milliseconds;
    },
  };
}
const postRpc = (worker, body, { env = {}, path: endpointPath = "/mcp" } = {}) =>
  worker.fetch(
    new Request(`https://mlb-live.example${endpointPath}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
    env,
  );
const buildToolCall = (id, name, args) => ({
  jsonrpc: "2.0",
  id,
  method: "tools/call",
  params: { name, arguments: args },
});

test("the handshake claude.ai makes when the connector is added", async () => {
  const { worker } = createTestWorker();
  const response = await postRpc(worker, {
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "claude-ai", version: "1" },
    },
  });
  assert.equal(response.status, 200);
  const { result } = await response.json();
  assert.equal(result.protocolVersion, "2025-06-18");
  assert.deepEqual(result.capabilities, { tools: { listChanged: false } });
  assert.equal(result.serverInfo.name, "mlb-live");

  const notificationResponse = await postRpc(worker, {
    jsonrpc: "2.0",
    method: "notifications/initialized",
  });
  assert.equal(notificationResponse.status, 202);
  assert.equal(await notificationResponse.text(), "");
});

test("an unknown protocol version gets the newest one back", async () => {
  const { worker } = createTestWorker();
  const { result } = await (
    await postRpc(worker, {
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { protocolVersion: "1999-01-01" },
    })
  ).json();
  assert.equal(result.protocolVersion, "2025-06-18");
});

test("one tool, marked read-only so the page may watch it", async () => {
  const { worker } = createTestWorker();
  const { result } = await (
    await postRpc(worker, { jsonrpc: "2.0", id: 2, method: "tools/list" })
  ).json();
  assert.equal(result.tools.length, 1);
  const [tool] = result.tools;
  assert.equal(tool.name, "get_snapshot");
  assert.equal(tool.annotations.readOnlyHint, true);
  assert.equal(tool.annotations.destructiveHint, false);
});

test("get_snapshot answers with the snapshot, structured and as text", async () => {
  const { worker, mlb } = createTestWorker();
  const { result } = await (
    await postRpc(worker, buildToolCall(3, "get_snapshot", { season: 2026 }))
  ).json();
  const expected = MLBSnapshot.buildSnapshot(EVENING.responses, { season: 2026, now: NOW });
  assert.deepEqual(result.structuredContent, expected);
  assert.deepEqual(JSON.parse(result.content[0].text), expected);
  assert.equal(mlb.calls.length, 4);
  assert.equal(mlb.calls[0].init.cf.cacheTtl, 15);
  assert.ok(mlb.calls[0].init.signal);
});

test("season defaults to this year", async () => {
  const { worker } = createTestWorker();
  const { result } = await (await postRpc(worker, buildToolCall(4, "get_snapshot", {}))).json();
  assert.equal(result.structuredContent.season, 2026);
});

test("callers polling together share one trip to MLB", async () => {
  const { worker, mlb, advanceClock } = createTestWorker();
  await Promise.all(
    [1, 2, 3].map((id) => postRpc(worker, buildToolCall(id, "get_snapshot", { season: 2026 }))),
  );
  assert.equal(mlb.calls.length, 4);
  advanceClock(11000);
  await postRpc(worker, buildToolCall(4, "get_snapshot", { season: 2026 }));
  assert.equal(mlb.calls.length, 8);
});

test("bad arguments are refused before anything is fetched", async () => {
  const { worker, mlb } = createTestWorker();
  for (const args of [
    { season: "2026" },
    { season: 2026.5 },
    { season: 1800 },
    { season: 2026, team: "NYY" },
  ]) {
    const { error } = await (await postRpc(worker, buildToolCall(5, "get_snapshot", args))).json();
    assert.equal(error.code, -32602, JSON.stringify(args));
  }
  const { error } = await (await postRpc(worker, buildToolCall(6, "delete_everything", {}))).json();
  assert.equal(error.code, -32602);
  assert.equal(mlb.calls.length, 0);
});

test("MLB failing is the tool's error, not the protocol's, and is not remembered", async () => {
  const { worker } = createTestWorker({ status: 503 });
  const { result } = await (
    await postRpc(worker, buildToolCall(7, "get_snapshot", { season: 2026 }))
  ).json();
  assert.equal(result.isError, true);
  assert.match(result.content[0].text, /MLB Stats API answered 503/);
});

test("malformed requests get JSON-RPC errors", async () => {
  const { worker } = createTestWorker();
  const unparsableResponse = await postRpc(worker, "{not json");
  assert.equal(unparsableResponse.status, 400);
  assert.equal((await unparsableResponse.json()).error.code, -32700);
  assert.equal(
    (await (await postRpc(worker, { id: 1, method: "ping" })).json()).error.code,
    -32600,
  );
  assert.equal(
    (await (await postRpc(worker, { jsonrpc: "2.0", id: 1, method: "resources/list" })).json())
      .error.code,
    -32601,
  );
  assert.deepEqual(
    (await (await postRpc(worker, { jsonrpc: "2.0", id: 9, method: "ping" })).json()).result,
    {},
  );
  const oversizedResponse = await postRpc(
    worker,
    JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping", pad: "x".repeat(70000) }),
  );
  assert.equal(oversizedResponse.status, 413);
});

test("a batch gets one answer per request", async () => {
  const { worker } = createTestWorker();
  const response = await postRpc(worker, [
    { jsonrpc: "2.0", id: 1, method: "ping" },
    { jsonrpc: "2.0", method: "notifications/initialized" },
  ]);
  assert.deepEqual(
    (await response.json()).map((answer) => answer.id),
    [1],
  );
});

test("params that aren't an object get a JSON-RPC error, not a crash", async () => {
  const { worker } = createTestWorker();
  for (const params of [null, 5, "x", []]) {
    const response = await postRpc(worker, { jsonrpc: "2.0", id: 1, method: "initialize", params });
    assert.equal(response.status, 200, JSON.stringify(params));
    const answer = await response.json();
    assert.equal(answer.error?.code ?? null, params === null ? null : -32602);
  }
  const { error } = await (
    await postRpc(worker, {
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: { name: "get_snapshot", arguments: [] },
    })
  ).json();
  assert.equal(error.code, -32602);
});

test("a batch is capped, so one request can't fan out into many trips to MLB", async () => {
  const { worker, mlb } = createTestWorker();
  const seasons = Array.from({ length: 11 }, (_, index) => 2000 + index);
  const response = await postRpc(
    worker,
    seasons.map((season, index) => buildToolCall(index, "get_snapshot", { season })),
  );
  assert.equal(response.status, 400);
  assert.equal((await response.json()).error.code, -32600);
  assert.equal(mlb.calls.length, 0);
});

test("the size limit counts bytes, and a declared length over it is refused unread", async () => {
  const { worker } = createTestWorker();
  const wide = JSON.stringify({
    jsonrpc: "2.0",
    id: 1,
    method: "ping",
    pad: "\u00e9".repeat(40000),
  });
  assert.ok(wide.length < 64 * 1024);
  assert.equal((await postRpc(worker, wide)).status, 413);
  const declared = await worker.fetch(
    new Request("https://mlb-live.example/mcp", {
      method: "POST",
      headers: { "content-length": String(1024 * 1024) },
      body: "{}",
    }),
    {},
  );
  assert.equal(declared.status, 413);
});

test("GET on the MCP endpoint is refused; /snapshot answers plain HTTP", async () => {
  const { worker } = createTestWorker();
  const getResponse = await worker.fetch(new Request("https://mlb-live.example/mcp"), {});
  assert.equal(getResponse.status, 405);
  const snapshotResponse = await worker.fetch(
    new Request("https://mlb-live.example/snapshot?season=2026"),
    {},
  );
  assert.equal(snapshotResponse.status, 200);
  assert.equal(snapshotResponse.headers.get("access-control-allow-origin"), "*");
  assert.equal((await snapshotResponse.json()).season, 2026);
  assert.equal(
    (await worker.fetch(new Request("https://mlb-live.example/snapshot?season=abc"), {})).status,
    400,
  );
});

test("with CONNECTOR_KEY set, only the keyed paths answer", async () => {
  const { worker } = createTestWorker();
  const env = { CONNECTOR_KEY: "s3cret" };
  assert.equal(
    (await postRpc(worker, { jsonrpc: "2.0", id: 1, method: "ping" }, { env })).status,
    404,
  );
  assert.equal(
    (await postRpc(worker, { jsonrpc: "2.0", id: 1, method: "ping" }, { env, path: "/mcp/s3cret" }))
      .status,
    200,
  );
  assert.equal((await worker.fetch(new Request("https://mlb-live.example/"), env)).status, 404);
  assert.equal(
    (await worker.fetch(new Request("https://mlb-live.example/snapshot/s3cret?season=2026"), env))
      .status,
    200,
  );
});

test("the deployable file is built from the current sources", async () => {
  const { buildWorker, OUTPUT } = await import("../worker/build.mjs");
  assert.equal(readFileSync(OUTPUT, "utf8"), await buildWorker(), "run: npm run build");
});
