import { test } from "node:test";
import assert from "node:assert/strict";
import { createWorkerStore } from "../shared/page/worker-store.js";

// Stand-ins for the browser: each read waits until the test answers it, and the socket opens
// when the test says so.
function startStore() {
  const reads = [];
  const sockets = [];
  globalThis.fetch = /** @type {any} */ (
    (url) =>
      new Promise((resolve) => {
        const answer = (body) => resolve(new Response(JSON.stringify(body)));
        reads.push({ url: String(url), answer });
      })
  );
  globalThis.WebSocket = /** @type {any} */ (
    class {
      constructor() {
        this.listeners = {};
        this.isClosed = false;
        sockets.push(this);
      }
      addEventListener(type, listener) {
        this.listeners[type] = listener;
      }
      close() {
        this.isClosed = true;
        this.listeners.close?.();
      }
    }
  );
  const store = createWorkerStore(new URL("https://mlb-live.example/k3y/"));
  const openSocket = () => sockets.at(-1).listeners.open();
  return { store, reads, sockets, openSocket };
}

const settle = () => new Promise((resolve) => setTimeout(resolve));
const SEASON_URL = "https://mlb-live.example/k3y/store/seasons/2026";
const READINGS_URL = "https://mlb-live.example/k3y/store/readings-2026?limit=10";

test("watches started before the socket opens read once each, as it opens", () => {
  const { store, reads, openSocket } = startStore();
  store.doc("seasons/2026").onSnapshot(() => {});
  store
    .collection("readings-2026")
    .limit(10)
    .onSnapshot(() => {});
  assert.equal(reads.length, 0);

  openSocket();

  assert.deepEqual(
    reads.map((read) => read.url),
    [SEASON_URL, READINGS_URL],
  );
});

test("a watch started once the socket is open reads right away", () => {
  const { store, reads, openSocket } = startStore();
  store.doc("seasons/2026").onSnapshot(() => {});
  openSocket();

  store
    .collection("readings-2026")
    .limit(10)
    .onSnapshot(() => {});

  assert.deepEqual(
    reads.map((read) => read.url),
    [SEASON_URL, READINGS_URL],
  );
});

test("a document read that arrives after a newer one is dropped", async () => {
  const { store, reads, openSocket } = startStore();
  const seen = [];
  store.doc("seasons/2026").onSnapshot((snapshot) => seen.push(snapshot.data().ranking));
  openSocket();
  store.catchUp();
  openSocket();
  assert.equal(reads.length, 2);
  reads[1].answer({ data: { ranking: ["TOR"] } });
  await settle();
  reads[0].answer({ data: { ranking: ["NYY"] } });
  await settle();
  assert.deepEqual(seen, [["TOR"]]);
});

test("a listing that arrives after a newer one is dropped", async () => {
  const { store, reads, openSocket } = startStore();
  const seen = [];
  store
    .collection("readings-2026")
    .limit(10)
    .onSnapshot(({ docs }) => seen.push(docs.map((doc) => doc.id)));
  openSocket();
  store.catchUp();
  openSocket();
  assert.equal(reads.length, 2);
  reads[1].answer({ docs: [{ id: "2026-09-25-01", data: {} }] });
  await settle();
  reads[0].answer({ docs: [{ id: "2026-09-24-01", data: {} }] });
  await settle();
  assert.deepEqual(seen, [["2026-09-25-01"]]);
});

test("catching up reads every watched document once, as the new socket opens", () => {
  const { store, reads, openSocket } = startStore();
  store.doc("seasons/2026").onSnapshot(() => {});
  openSocket();
  const readCount = reads.length;

  store.catchUp();
  assert.equal(reads.length, readCount);
  openSocket();

  assert.equal(reads.length, readCount + 1);
  assert.equal(reads.at(-1).url, SEASON_URL);
});

test("catching up swaps a socket that may have gone quiet for a new one", () => {
  const { store, sockets, openSocket } = startStore();
  store.doc("seasons/2026").onSnapshot(() => {});
  openSocket();

  store.catchUp();

  assert.equal(sockets.length, 2);
  assert.ok(sockets[0].isClosed);
  assert.ok(!sockets[1].isClosed);
});
