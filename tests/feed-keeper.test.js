import test from "node:test";
import assert from "node:assert/strict";
import { createFeedKeeper } from "../shared/worker/feed-keeper.js";

const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;

function createKeeper() {
  const clock = { now: 0 };
  const keeper = createFeedKeeper({
    feeds: {
      standings: { maxAgeMs: 24 * HOUR_MS, changesWithGames: true },
      season: { maxAgeMs: 24 * HOUR_MS, changesWithGames: false },
    },
    leagueName: "The league",
    now: () => clock.now,
  });
  const reads = { standings: 0, season: 0 };
  /** @param {"standings" | "season"} name */
  const read = (name) =>
    keeper.readFeed(name, `/${name}`, async () => {
      reads[name] += 1;
      return { name, read: reads[name] };
    });
  return { clock, keeper, reads, read };
}

test("a feed's answer is kept until it's older than the feed's limit", async () => {
  const { clock, reads, read } = createKeeper();
  await read("standings");
  clock.now = 23 * HOUR_MS;
  await read("standings");
  assert.equal(reads.standings, 1);

  clock.now = 24 * HOUR_MS;
  assert.deepEqual(await read("standings"), { name: "standings", read: 2 });
});

test("a game's end has a feed that changes with games read at once, and again ten minutes on", async () => {
  const { clock, keeper, reads, read } = createKeeper();
  keeper.noteFinalCount(3);
  await Promise.all([read("standings"), read("season")]);

  clock.now = MINUTE_MS;
  keeper.noteFinalCount(4);
  await Promise.all([read("standings"), read("season")]);
  assert.deepEqual(reads, { standings: 2, season: 1 });

  clock.now = 9 * MINUTE_MS;
  await read("standings");
  assert.equal(reads.standings, 2);

  clock.now = 11 * MINUTE_MS;
  await read("standings");
  clock.now = 30 * MINUTE_MS;
  await read("standings");
  assert.deepEqual(reads, { standings: 3, season: 1 });
});

test("a count that couldn't be read, or the first one, isn't a game ending", async () => {
  const { clock, keeper, reads, read } = createKeeper();
  keeper.noteFinalCount(null);
  keeper.noteFinalCount(3);
  await read("standings");

  clock.now = MINUTE_MS;
  keeper.noteFinalCount(null);
  keeper.noteFinalCount(3);
  await read("standings");
  assert.equal(reads.standings, 1);
});

test("a feed that fails stands in with its last answer, and waits five minutes to be asked again", async () => {
  const clock = { now: 0 };
  const keeper = createFeedKeeper({
    feeds: { standings: { maxAgeMs: MINUTE_MS, changesWithGames: true } },
    leagueName: "The league",
    now: () => clock.now,
  });
  let attempts = 0;
  const fail = async () => {
    attempts += 1;
    throw new Error("503");
  };
  await assert.rejects(keeper.readFeed("standings", "/standings", fail), /503/);
  await assert.rejects(
    keeper.readFeed("standings", "/standings", fail),
    /The league didn't answer standings a moment ago/,
  );
  assert.equal(attempts, 1);

  clock.now = 5 * MINUTE_MS;
  assert.equal(await keeper.readFeed("standings", "/standings", async () => "answer"), "answer");
  clock.now = 6 * MINUTE_MS;
  assert.equal(await keeper.readFeed("standings", "/standings", fail), "answer");
});
