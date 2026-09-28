import test from "node:test";
import assert from "node:assert/strict";
import worker from "../worker/src/index.js";
import { SeasonStore } from "../worker/src/store.js";
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
  return {
    env,
    stored,
    sockets,
    seenPaths,
    write: (key, doc) => store.docs.write(key, doc),
    remove: (key) => store.docs.remove(key),
  };
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
  const { env, write } = createFakeStore();
  assert.equal(await readData(env, "/store/seasons/2026"), null);

  await write("seasons/2026", {
    year: 2026,
    ranking: ["NYY", "LAD"],
    teams: { NYY: { seed: 4 }, LAD: { seed: 2 } },
  });
  const data = await readData(env, "/store/seasons/2026");
  assert.deepEqual(data, {
    ranking: ["NYY", "LAD"],
    teams: { LAD: { seed: 2 }, NYY: { seed: 4 } },
    year: 2026,
  });
  assert.deepEqual(Object.keys(data), ["ranking", "teams", "year"]);
  assert.deepEqual(Object.keys(data.teams), ["LAD", "NYY"]);
});

test("the page's update replaces each field it names, and a null removes one", async () => {
  const { env, write } = createFakeStore();
  await write("seasons/2026", {
    year: 2026,
    ranking: ["NYY", "LAD"],
    series: { WS: { winsA: 1, winsB: 0 } },
    seenAt: "a",
    log: [{ kind: "lock" }],
  });
  const response = await requestStore(env, "/store/seasons/2026", {
    method: "PATCH",
    body: { ranking: ["LAD"], series: { ALCS: { winsA: 0 } }, seenAt: null },
  });
  assert.equal(response.status, 204);
  assert.deepEqual(await readData(env, "/store/seasons/2026"), {
    log: [{ kind: "lock" }],
    ranking: ["LAD"],
    series: { ALCS: { winsA: 0 } },
    year: 2026,
  });
});

test("the page's update creates a season that isn't there yet", async () => {
  const { env } = createFakeStore();
  const response = await requestStore(env, "/store/seasons/2030", {
    method: "PATCH",
    body: { ranking: ["NYY"] },
  });
  assert.equal(response.status, 204);
  assert.deepEqual(await readData(env, "/store/seasons/2030"), { ranking: ["NYY"], year: 2030 });
});

test("a collection lists its documents by id, up to the limit", async () => {
  const { env, write } = createFakeStore();
  for (const year of [2024, 2025, 2026]) await write(`seasons/${year}`, { year });
  await write("standings/2026", { divisions: {} });

  const all = await (await requestStore(env, "/store/seasons")).json();
  assert.deepEqual(
    all.docs.map((doc) => doc.id),
    ["2024", "2025", "2026"],
  );
  assert.deepEqual(all.docs[0].data, { year: 2024 });
  const limited = await (await requestStore(env, "/store/seasons?limit=2")).json();
  assert.equal(limited.docs.length, 2);
});

test("every write reaches each open watcher, with the document as saved", async () => {
  const { env, sockets, write } = createFakeStore();
  const opened = await requestStore(env, "/watch", { headers: { upgrade: "websocket" } });
  assert.equal(await opened.text(), "socket opened");
  await requestStore(env, "/watch", { headers: { upgrade: "websocket" } });

  await write("seasons/2026", { year: 2026 });
  await requestStore(env, "/store/seasons/2026", { method: "PATCH", body: { seenAt: "x" } });
  for (const socket of sockets)
    assert.deepEqual(socket.sent, [
      { path: "seasons/2026", data: { year: 2026 } },
      { path: "seasons/2026", data: { seenAt: "x", year: 2026 } },
    ]);

  const plain = await requestStore(env, "/watch");
  assert.equal(plain.status, 426);
});

test("a removed document reads as null, and its watchers hear so", async () => {
  const { env, stored, sockets, write, remove } = createFakeStore();
  await requestStore(env, "/watch", { headers: { upgrade: "websocket" } });
  await write("readings-2026/2026-09-27", { day: 1 });

  await remove("readings-2026/2026-09-27");
  assert.equal(await readData(env, "/store/readings-2026/2026-09-27"), null);
  assert.equal(stored.size, 0);
  assert.deepEqual(sockets[0].sent.at(-1), { path: "readings-2026/2026-09-27", data: null });
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
  const patch = (path, body) => requestStore(env, path, { method: "PATCH", body });
  const refusals = [
    [requestStore(env, "/store/seasons/20 26"), 404],
    [requestStore(env, "/store/seasons/2026/extra"), 404],
    [requestStore(env, "/store/seasons/"), 404],
    [patch("/store/seasons/2026", "[1, 2]"), 400],
    [patch("/store/seasons/2026", "not json"), 400],
    [patch("/store/seasons/2026", { seenAt: "x".repeat(70_000) }), 413],
    [requestStore(env, "/store/seasons/2026", { method: "POST" }), 405],
    [requestStore(env, "/store/seasons", { method: "PATCH", body: {} }), 405],
  ];
  for (const [pending, status] of refusals) assert.equal((await pending).status, status);
  assert.equal(stored.size, 0);
});

test("the page can't replace or remove documents, or change anything but its own fields", async () => {
  const { env, stored, write } = createFakeStore();
  const season = { year: 2026, ranking: ["NYY"], log: [{ kind: "lock" }] };
  await write("seasons/2026", season);
  await write("standings/2026", { divisions: {} });
  const patch = (path, body) => requestStore(env, path, { method: "PATCH", body });
  const refusals = [
    [requestStore(env, "/store/seasons/2026", { method: "PUT", body: {} }), 405],
    [requestStore(env, "/store/seasons/2026", { method: "DELETE" }), 405],
    [patch("/store/standings/2026", { divisions: null }), 403],
    [patch("/store/live/status", { error: "" }), 403],
    [patch("/store/seasons/next", { ranking: [] }), 403],
    [patch("/store/seasons/2026", { log: null }), 400],
    [patch("/store/seasons/2026", { year: 1999 }), 400],
    [patch("/store/seasons/2026", { ranking: "NYY" }), 400],
    [patch("/store/seasons/2026", { teams: ["NYY"] }), 400],
  ];
  for (const [pending, status] of refusals) assert.equal((await pending).status, status);
  assert.deepEqual(stored.get("seasons/2026"), season);
  assert.deepEqual(stored.get("standings/2026"), { divisions: {} });
});
