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

function fakeMlb({ status = 200 } = {}) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    const kind = url.includes("/standings")
      ? "standings"
      : url.includes("/postseason")
        ? "postseason"
        : "schedule";
    return new Response(JSON.stringify(EVENING.responses[kind]), { status });
  };
  return { fetchImpl, calls };
}
function worker(opts = {}) {
  const mlb = fakeMlb(opts);
  let now = NOW;
  const w = createWorker({ fetchImpl: mlb.fetchImpl, now: () => now });
  return {
    w,
    mlb,
    tick: (ms) => {
      now += ms;
    },
  };
}
const rpc = (w, body, { env = {}, path: p = "/mcp" } = {}) =>
  w.fetch(
    new Request(`https://mlb-live.example${p}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
    env,
  );
const call = (id, name, args) => ({
  jsonrpc: "2.0",
  id,
  method: "tools/call",
  params: { name, arguments: args },
});

test("the handshake claude.ai makes when the connector is added", async () => {
  const { w } = worker();
  const res = await rpc(w, {
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "claude-ai", version: "1" },
    },
  });
  assert.equal(res.status, 200);
  const { result } = await res.json();
  assert.equal(result.protocolVersion, "2025-06-18");
  assert.deepEqual(result.capabilities, { tools: { listChanged: false } });
  assert.equal(result.serverInfo.name, "mlb-live");

  const note = await rpc(w, { jsonrpc: "2.0", method: "notifications/initialized" });
  assert.equal(note.status, 202);
  assert.equal(await note.text(), "");
});

test("an unknown protocol version gets the newest one back", async () => {
  const { w } = worker();
  const { result } = await (
    await rpc(w, {
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { protocolVersion: "1999-01-01" },
    })
  ).json();
  assert.equal(result.protocolVersion, "2025-06-18");
});

test("one tool, marked read-only so the page may watch it", async () => {
  const { w } = worker();
  const { result } = await (await rpc(w, { jsonrpc: "2.0", id: 2, method: "tools/list" })).json();
  assert.equal(result.tools.length, 1);
  const [tool] = result.tools;
  assert.equal(tool.name, "get_snapshot");
  assert.equal(tool.annotations.readOnlyHint, true);
  assert.equal(tool.annotations.destructiveHint, false);
});

test("get_snapshot answers with the snapshot, structured and as text", async () => {
  const { w, mlb } = worker();
  const { result } = await (await rpc(w, call(3, "get_snapshot", { season: 2026 }))).json();
  const expected = MLBSnapshot.buildSnapshot(EVENING.responses, { season: 2026, now: NOW });
  assert.deepEqual(result.structuredContent, expected);
  assert.deepEqual(JSON.parse(result.content[0].text), expected);
  assert.equal(mlb.calls.length, 3);
  assert.equal(mlb.calls[0].init.cf.cacheTtl, 15);
  assert.ok(mlb.calls[0].init.signal);
});

test("season defaults to this year", async () => {
  const { w } = worker();
  const { result } = await (await rpc(w, call(4, "get_snapshot", {}))).json();
  assert.equal(result.structuredContent.season, 2026);
});

test("callers polling together share one trip to MLB", async () => {
  const { w, mlb, tick } = worker();
  await Promise.all([1, 2, 3].map((i) => rpc(w, call(i, "get_snapshot", { season: 2026 }))));
  assert.equal(mlb.calls.length, 3);
  tick(11000);
  await rpc(w, call(4, "get_snapshot", { season: 2026 }));
  assert.equal(mlb.calls.length, 6);
});

test("bad arguments are refused before anything is fetched", async () => {
  const { w, mlb } = worker();
  for (const args of [
    { season: "2026" },
    { season: 2026.5 },
    { season: 1800 },
    { season: 2026, team: "NYY" },
  ]) {
    const { error } = await (await rpc(w, call(5, "get_snapshot", args))).json();
    assert.equal(error.code, -32602, JSON.stringify(args));
  }
  const { error } = await (await rpc(w, call(6, "delete_everything", {}))).json();
  assert.equal(error.code, -32602);
  assert.equal(mlb.calls.length, 0);
});

test("MLB failing is the tool's error, not the protocol's, and is not remembered", async () => {
  const { w } = worker({ status: 503 });
  const { result } = await (await rpc(w, call(7, "get_snapshot", { season: 2026 }))).json();
  assert.equal(result.isError, true);
  assert.match(result.content[0].text, /MLB Stats API answered 503/);
});

test("malformed requests get JSON-RPC errors", async () => {
  const { w } = worker();
  const parse = await rpc(w, "{not json");
  assert.equal(parse.status, 400);
  assert.equal((await parse.json()).error.code, -32700);
  assert.equal((await (await rpc(w, { id: 1, method: "ping" })).json()).error.code, -32600);
  assert.equal(
    (await (await rpc(w, { jsonrpc: "2.0", id: 1, method: "resources/list" })).json()).error.code,
    -32601,
  );
  assert.deepEqual(
    (await (await rpc(w, { jsonrpc: "2.0", id: 9, method: "ping" })).json()).result,
    {},
  );
  const big = await rpc(
    w,
    JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping", pad: "x".repeat(70000) }),
  );
  assert.equal(big.status, 413);
});

test("a batch gets one answer per request", async () => {
  const { w } = worker();
  const res = await rpc(w, [
    { jsonrpc: "2.0", id: 1, method: "ping" },
    { jsonrpc: "2.0", method: "notifications/initialized" },
  ]);
  assert.deepEqual(
    (await res.json()).map((r) => r.id),
    [1],
  );
});

test("params that aren't an object get a JSON-RPC error, not a crash", async () => {
  const { w } = worker();
  for (const params of [null, 5, "x", []]) {
    const res = await rpc(w, { jsonrpc: "2.0", id: 1, method: "initialize", params });
    assert.equal(res.status, 200, JSON.stringify(params));
    const answer = await res.json();
    assert.equal(answer.error?.code ?? null, params === null ? null : -32602);
  }
  const { error } = await (
    await rpc(w, {
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: { name: "get_snapshot", arguments: [] },
    })
  ).json();
  assert.equal(error.code, -32602);
});

test("a batch is capped, so one request can't fan out into many trips to MLB", async () => {
  const { w, mlb } = worker();
  const seasons = Array.from({ length: 11 }, (_, index) => 2000 + index);
  const res = await rpc(
    w,
    seasons.map((season, index) => call(index, "get_snapshot", { season })),
  );
  assert.equal(res.status, 400);
  assert.equal((await res.json()).error.code, -32600);
  assert.equal(mlb.calls.length, 0);
});

test("the size limit counts bytes, and a declared length over it is refused unread", async () => {
  const { w } = worker();
  const wide = JSON.stringify({
    jsonrpc: "2.0",
    id: 1,
    method: "ping",
    pad: "\u00e9".repeat(40000),
  });
  assert.ok(wide.length < 64 * 1024);
  assert.equal((await rpc(w, wide)).status, 413);
  const declared = await w.fetch(
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
  const { w } = worker();
  const get = await w.fetch(new Request("https://mlb-live.example/mcp"), {});
  assert.equal(get.status, 405);
  const snap = await w.fetch(new Request("https://mlb-live.example/snapshot?season=2026"), {});
  assert.equal(snap.status, 200);
  assert.equal(snap.headers.get("access-control-allow-origin"), "*");
  assert.equal((await snap.json()).season, 2026);
  assert.equal(
    (await w.fetch(new Request("https://mlb-live.example/snapshot?season=abc"), {})).status,
    400,
  );
});

test("with CONNECTOR_KEY set, only the keyed paths answer", async () => {
  const { w } = worker();
  const env = { CONNECTOR_KEY: "s3cret" };
  assert.equal((await rpc(w, { jsonrpc: "2.0", id: 1, method: "ping" }, { env })).status, 404);
  assert.equal(
    (await rpc(w, { jsonrpc: "2.0", id: 1, method: "ping" }, { env, path: "/mcp/s3cret" })).status,
    200,
  );
  assert.equal((await w.fetch(new Request("https://mlb-live.example/"), env)).status, 404);
  assert.equal(
    (await w.fetch(new Request("https://mlb-live.example/snapshot/s3cret?season=2026"), env))
      .status,
    200,
  );
});

test("the deployable file is built from the current sources", async () => {
  const { buildWorker, OUTPUT } = await import("../worker/build.mjs");
  assert.equal(readFileSync(OUTPUT, "utf8"), await buildWorker(), "run: npm run build");
});
