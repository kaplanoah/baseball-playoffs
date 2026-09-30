import test from "node:test";
import assert from "node:assert/strict";
import { createSeasonStore } from "../shared/worker/season-store.js";
import { createDurableObjectContext } from "./durable-object-context.js";

const ORIGIN = "https://app.example";

// A league with nothing to update, whose page saves only when updates were last seen.
const QUIET_LEAGUE = {
  pageFields: { seenAt: (value) => typeof value === "string" },
  createLoadSnapshot: () => async () => ({}),
  loadCurrentSnapshot: async () => ({ season: 2026 }),
  readUpdates: async () => null,
  saveSnapshot: async () => {},
  describeSnapshotStatus: () => ({ error: "" }),
  saveStatus: async () => {},
  choosePollDelay: () => 60_000,
  retryMs: [30_000],
  listNotifications: () => [],
};

const patchSeason = (store, body) =>
  store.fetch(
    new Request(`${ORIGIN}/store/seasons/2026`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );

test("a store saves only the page fields its league names", async () => {
  const context = createDurableObjectContext();
  const SeasonStore = createSeasonStore(QUIET_LEAGUE);
  const store = new SeasonStore(context.ctx, {});

  assert.equal((await patchSeason(store, { seenAt: "2026-09-30T20:00:00Z" })).status, 204);
  assert.deepEqual(await context.ctx.storage.get("seasons/2026"), {
    seenAt: "2026-09-30T20:00:00Z",
    year: 2026,
  });

  const refused = await patchSeason(store, { ranking: ["NYL"] });
  assert.equal(refused.status, 400);
  assert.equal((await refused.json()).error.message, "A season takes only seenAt.");
});

test("a store waits as long as its league says before the next update", async () => {
  const context = createDurableObjectContext();
  const now = Date.parse("2026-09-30T20:00:00Z");
  const SeasonStore = createSeasonStore(QUIET_LEAGUE);
  const store = new SeasonStore(context.ctx, {}, { now: () => now });

  await store.alarm();

  assert.equal(await context.ctx.storage.getAlarm(), now + 60_000);
});

test("a store whose league's page saves nothing refuses every change", async () => {
  const SeasonStore = createSeasonStore({ ...QUIET_LEAGUE, pageFields: {} });
  const store = new SeasonStore(createDurableObjectContext().ctx, {});

  const refused = await patchSeason(store, { seenAt: "2026-09-30T20:00:00Z" });

  assert.equal(refused.status, 403);
  assert.equal((await refused.json()).error.message, "The page saves nothing here.");
});
