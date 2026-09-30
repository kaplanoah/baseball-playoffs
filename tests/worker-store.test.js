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
  globalThis.document = /** @type {any} */ ({ hidden: false, addEventListener: () => {} });
  globalThis.WebSocket = /** @type {any} */ (
    class {
      constructor() {
        this.listeners = {};
        sockets.push(this);
      }
      addEventListener(type, listener) {
        this.listeners[type] = listener;
      }
    }
  );
  const store = createWorkerStore(new URL("https://mlb-live.example/k3y/"));
  const openSocket = () => sockets[0].listeners.open();
  return { store, reads, openSocket };
}

const settle = () => new Promise((resolve) => setTimeout(resolve));

test("a document read that arrives after a newer one is dropped", async () => {
  const { store, reads, openSocket } = startStore();
  const seen = [];
  store.doc("seasons/2026").onSnapshot((snapshot) => seen.push(snapshot.data().ranking));
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
  assert.equal(reads.length, 2);
  reads[1].answer({ docs: [{ id: "2026-09-25-01", data: {} }] });
  await settle();
  reads[0].answer({ docs: [{ id: "2026-09-24-01", data: {} }] });
  await settle();
  assert.deepEqual(seen, [["2026-09-25-01"]]);
});
