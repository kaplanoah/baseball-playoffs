import test from "node:test";
import assert from "node:assert/strict";
import { createMemoryStorage } from "../../../shared/worker/feed-keeper.js";
import { createGameEnds } from "../worker/src/game-ends.js";

const MINUTE_MS = 60 * 1000;
const END = "2026-10-01T04:01:34Z";

/** @param {string} state */
const showGame = (state) => ({
  id: "1042600112",
  state,
  away: { team: "GSV" },
  home: { team: "DAL" },
  start: "2026-10-01T01:00:00Z",
});

/** @param {(string | null)[]} answers what ESPN says each time it's asked */
function createEnds(answers) {
  const clock = { now: 0 };
  const lookups = [];
  const gameEnds = createGameEnds({
    loadEndTime: async (game) => {
      lookups.push(game.id);
      return answers.shift() ?? null;
    },
    now: () => clock.now,
  });
  return { clock, lookups, gameEnds };
}

test("a game seen live and then final ends when ESPN says, and ESPN is asked once", async () => {
  const { lookups, gameEnds } = createEnds([END]);
  await gameEnds.addEnds([showGame("live")]);
  const [ended] = await gameEnds.addEnds([showGame("final")]);
  const [later] = await gameEnds.addEnds([showGame("final")]);
  assert.equal(ended.end, END);
  assert.equal(later.end, END);
  assert.deepEqual(lookups, ["1042600112"]);
});

test("a game first seen final has no end from ESPN, which isn't asked", async () => {
  const { lookups, gameEnds } = createEnds([END]);
  const [game] = await gameEnds.addEnds([showGame("final")]);
  assert.equal(game.end, undefined);
  assert.deepEqual(lookups, []);
});

test("until ESPN has the game's last play, it's asked every two minutes, for half an hour", async () => {
  const { clock, lookups, gameEnds } = createEnds([]);
  await gameEnds.addEnds([showGame("live")]);
  await gameEnds.addEnds([showGame("final")]);
  clock.now = MINUTE_MS;
  await gameEnds.addEnds([showGame("final")]);
  assert.equal(lookups.length, 1);

  for (let minute = 2; minute <= 40; minute += 2) {
    clock.now = minute * MINUTE_MS;
    await gameEnds.addEnds([showGame("final")]);
  }
  assert.equal(lookups.length, 15);
});

test("a game seen live before the Durable Object left memory still gets its end after", async () => {
  const storage = createMemoryStorage();
  const lookups = [];
  const createEndsOnStorage = () =>
    createGameEnds({
      loadEndTime: async (game) => {
        lookups.push(game.id);
        return END;
      },
      now: () => 0,
      storage,
    });
  await createEndsOnStorage().addEnds([showGame("live")]);
  const [ended] = await createEndsOnStorage().addEnds([showGame("final")]);
  const [later] = await createEndsOnStorage().addEnds([showGame("final")]);
  assert.equal(ended.end, END);
  assert.equal(later.end, END);
  assert.deepEqual(lookups, ["1042600112"]);
});
