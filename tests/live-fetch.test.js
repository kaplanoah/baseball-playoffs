// The module remembers when the sandbox refused a direct request, so these run in order.
import { mock, test } from "node:test";
import assert from "node:assert/strict";
import { fetchLive, isDirectBlocked } from "../page/js/live-fetch.js";

const SNAPSHOT = { version: 1, season: 2026 };

// The module keeps the first connector it gets, so the tests change its answer instead.
/** @type {(...input: unknown[]) => Promise<unknown>} */
let answerTool = async () => ({ payload: SNAPSHOT });
const mcp = {
  callTool: (...input) => answerTool(...input),
  listTools: async (server) => ({ servers: [{ server, tools: [{ name: "get_snapshot" }] }] }),
};
globalThis.window = /** @type {any} */ ({ claude: { use: async () => mcp } });

const flushMicrotasks = () => new Promise((resolve) => setImmediate(resolve));

test("a bug while building the snapshot is not mistaken for the sandbox refusing MLB", async () => {
  const broken = { records: [{ division: { id: 200 }, teamRecords: [null] }] };
  globalThis.fetch = async () => new Response(JSON.stringify(broken));
  await assert.rejects(fetchLive(2026), TypeError);
  assert.equal(isDirectBlocked(), false);
});

test("a refused direct request switches to the connector", async () => {
  globalThis.fetch = async () => {
    throw new TypeError("Failed to fetch");
  };
  assert.deepEqual(await fetchLive(2026), { snapshot: SNAPSHOT, source: "connector" });
  assert.equal(isDirectBlocked(), true);
});

test("a connector call that never answers times out", async () => {
  mock.timers.enable({ apis: ["setTimeout"] });
  try {
    answerTool = () => new Promise(() => {});
    const fetching = fetchLive(2026);
    for (let turn = 0; turn < 5; turn++) await flushMicrotasks();
    mock.timers.tick(20 * 1000);
    await assert.rejects(fetching, { code: "timeout" });
  } finally {
    mock.timers.reset();
  }
});
