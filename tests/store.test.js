import test from "node:test";
import assert from "node:assert/strict";
import worker from "../worker/src/index.js";
import { SeasonStore, mergeFields } from "../worker/src/store.js";
import { createDurableObjectContext } from "./durable-object-context.js";

const APP_KEY = "k3y";
const ORIGIN = "https://mlb-live.example";

function createFakeStore() {
  const { ctx, stored, sockets } = createDurableObjectContext();
  const openSocket = (context) => {
    const socket = {
      sent: [],
      send(message) {
        this.sent.push(JSON.parse(message));
      },
    };
    context.acceptWebSocket(socket);
    return new Response("socket opened");
  };
  const store = new SeasonStore(ctx, {}, { openSocket });
  const seenPaths = [];
  const env = {
    APP_KEY,
    STORE: {
      idFromName: (name) => name,
      get: () => ({
        fetch: (request) => {
          seenPaths.push(new URL(request.url).pathname);
          return store.fetch(request);
        },
      }),
    },
  };
  return { env, stored, sockets, seenPaths };
}

/**
 * @param {object} env
 * @param {string} path
 * @param {{ method?: string, body?: unknown, headers?: Record<string, string> }} [options]
 */
function requestStore(env, path, { method = "GET", body, headers = {} } = {}) {
  const init = { method, headers: { "content-type": "application/json", ...headers } };
  if (body !== undefined) init.body = typeof body === "string" ? body : JSON.stringify(body);
  return worker.fetch(new Request(`${ORIGIN}/${APP_KEY}${path}`, init), env);
}

const readData = async (env, path) => (await (await requestStore(env, path)).json()).data;

test("a document reads back with sorted keys, and a missing one reads as null", async () => {
  const { env } = createFakeStore();
  assert.equal(await readData(env, "/store/seasons/2026"), null);

  const response = await requestStore(env, "/store/seasons/2026", {
    method: "PUT",
    body: { year: 2026, ranking: ["NYY", "LAD"], teams: { NYY: { seed: 4 }, LAD: { seed: 2 } } },
  });
  assert.equal(response.status, 204);
  const data = await readData(env, "/store/seasons/2026");
  assert.deepEqual(data, {
    ranking: ["NYY", "LAD"],
    teams: { LAD: { seed: 2 }, NYY: { seed: 4 } },
    year: 2026,
  });
  assert.deepEqual(Object.keys(data), ["ranking", "teams", "year"]);
  assert.deepEqual(Object.keys(data.teams), ["LAD", "NYY"]);
});

test("update merges nested objects, replaces arrays, and removes keys set to null", async () => {
  const { env } = createFakeStore();
  await requestStore(env, "/store/seasons/2026", {
    method: "PUT",
    body: { ranking: ["NYY", "LAD"], series: { WS: { winsA: 1, winsB: 0 } }, seenAt: "a" },
  });
  const response = await requestStore(env, "/store/seasons/2026", {
    method: "PATCH",
    body: { ranking: ["LAD"], series: { WS: { winsB: 2 }, ALCS: { winsA: 0 } }, seenAt: null },
  });
  assert.equal(response.status, 204);
  assert.deepEqual(await readData(env, "/store/seasons/2026"), {
    ranking: ["LAD"],
    series: { ALCS: { winsA: 0 }, WS: { winsA: 1, winsB: 2 } },
  });
});

test("update needs a document that exists, as the artifact store does", async () => {
  const { env } = createFakeStore();
  const response = await requestStore(env, "/store/seasons/2030", {
    method: "PATCH",
    body: { ranking: [] },
  });
  assert.equal(response.status, 404);
  assert.equal((await response.json()).error.code, "invalid_argument");
  assert.equal(await readData(env, "/store/seasons/2030"), null);
});

test("merging drops nulls inside new objects too", () => {
  assert.deepEqual(mergeFields({ a: 1 }, { b: { c: null, d: 2 } }), { a: 1, b: { d: 2 } });
  assert.deepEqual(mergeFields({ a: { b: 1 } }, { a: [1] }), { a: [1] });
});

test("a collection lists its documents by id, up to the limit", async () => {
  const { env } = createFakeStore();
  for (const year of ["2024", "2025", "2026"])
    await requestStore(env, `/store/seasons/${year}`, { method: "PUT", body: { year } });
  await requestStore(env, "/store/standings/2026", { method: "PUT", body: { divisions: {} } });

  const all = await (await requestStore(env, "/store/seasons")).json();
  assert.deepEqual(
    all.docs.map((doc) => doc.id),
    ["2024", "2025", "2026"],
  );
  assert.deepEqual(all.docs[0].data, { year: "2024" });
  const limited = await (await requestStore(env, "/store/seasons?limit=2")).json();
  assert.equal(limited.docs.length, 2);
});

test("every write reaches each open watcher, with the document as saved", async () => {
  const { env, sockets } = createFakeStore();
  const opened = await requestStore(env, "/watch", { headers: { upgrade: "websocket" } });
  assert.equal(await opened.text(), "socket opened");
  await requestStore(env, "/watch", { headers: { upgrade: "websocket" } });

  await requestStore(env, "/store/live/status", { method: "PUT", body: { source: "mlb" } });
  await requestStore(env, "/store/live/status", { method: "PATCH", body: { error: "x" } });
  for (const socket of sockets)
    assert.deepEqual(socket.sent, [
      { path: "live/status", data: { source: "mlb" } },
      { path: "live/status", data: { error: "x", source: "mlb" } },
    ]);

  const plain = await requestStore(env, "/watch");
  assert.equal(plain.status, 426);
});

test("the store answers only under the key, and never sees it", async () => {
  const { env, seenPaths } = createFakeStore();
  await requestStore(env, "/store/seasons/2026?limit=1");
  assert.deepEqual(seenPaths, ["/store/seasons/2026"]);

  const wrongKey = await worker.fetch(new Request(`${ORIGIN}/nope/store/seasons/2026`), env);
  assert.equal(wrongKey.status, 404);
  const noKey = await worker.fetch(new Request(`${ORIGIN}/store/seasons/2026`), env);
  assert.equal(noKey.status, 404);
  const keyless = await worker.fetch(new Request(`${ORIGIN}/k3y/store/seasons/2026`), {
    ...env,
    APP_KEY: undefined,
  });
  assert.equal(keyless.status, 404);
  assert.equal(seenPaths.length, 1, "nothing else reached the store");
});

test("bad names, bodies, and methods are refused without writing", async () => {
  const { env, stored } = createFakeStore();
  const refusals = [
    [requestStore(env, "/store/seasons/20 26"), 404],
    [requestStore(env, "/store/seasons/2026/extra"), 404],
    [requestStore(env, "/store/seasons/"), 404],
    [requestStore(env, "/store/seasons/2026", { method: "PUT", body: "[1, 2]" }), 400],
    [requestStore(env, "/store/seasons/2026", { method: "PUT", body: "not json" }), 400],
    [
      requestStore(env, "/store/seasons/2026", {
        method: "PUT",
        body: { big: "x".repeat(70_000) },
      }),
      413,
    ],
    [requestStore(env, "/store/seasons/2026", { method: "DELETE" }), 405],
    [requestStore(env, "/store/seasons", { method: "PUT", body: {} }), 405],
  ];
  for (const [pending, status] of refusals) assert.equal((await pending).status, status);
  assert.equal(stored.size, 0);
});
