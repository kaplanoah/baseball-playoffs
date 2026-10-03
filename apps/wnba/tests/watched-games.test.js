import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describeBoxScore, nameBoxScoreRequest } from "../worker/src/box-score.js";
import { nameScoreboardRequest, nameSummaryRequest } from "../worker/src/lead.js";
import { createWatchedGameLoader } from "../worker/src/watched-games.js";

const GAMES = JSON.parse(
  readFileSync(`${import.meta.dirname}/fixtures/2026-10-01-games.json`, "utf8"),
);
// Valkyries at Wings, Game 2, which went to overtime.
const LEAD = JSON.parse(
  readFileSync(`${import.meta.dirname}/fixtures/2026-10-01-espn-lead.json`, "utf8"),
);
const ID = "1042600112";
const liveBoxScore = structuredClone(GAMES.boxScores[ID]);
Object.assign(liveBoxScore.game, { gameStatus: 2, period: 3 });

/** @param {string} state */
const createSnapshot = (state) => ({
  games: [{ id: ID, state, away: { team: "GSV" }, home: { team: "DAL" }, start: LEAD.game.start }],
});

/** @param {{ refuse?: boolean }} [options] */
function createLoader({ refuse = false } = {}) {
  const answers = {
    [nameBoxScoreRequest(ID)]: liveBoxScore,
    [nameScoreboardRequest(LEAD.game.start)]: LEAD.scoreboard,
    [nameSummaryRequest(LEAD.eventId)]: LEAD.summary,
  };
  const reads = [];
  const fetchImpl = async (url) => {
    reads.push(url);
    if (refuse || !(url in answers)) return new Response("", { status: 503 });
    return new Response(JSON.stringify(answers[url]));
  };
  return { reads, loadWatchedGame: createWatchedGameLoader({ fetchImpl }) };
}

test("a live game's details are its box score and its lead", async () => {
  const { loadWatchedGame } = createLoader();
  const details = await loadWatchedGame(ID, createSnapshot("live"), null);
  assert.deepEqual(details.boxScore, describeBoxScore(liveBoxScore));
  assert.equal(details.lead.periods, 5);
});

test("a game that hasn't started, or whose final box score is saved, needs no reads", async () => {
  const { reads, loadWatchedGame } = createLoader();
  assert.equal(await loadWatchedGame(ID, createSnapshot("pre"), null), null);
  const saved = { boxScore: { state: "final" }, lead: null };
  assert.equal(await loadWatchedGame(ID, createSnapshot("final"), saved), null);
  assert.equal(await loadWatchedGame("1042600999", createSnapshot("live"), null), null);
  assert.deepEqual(reads, []);
});

test("a read that fails keeps the details saved", async () => {
  const { loadWatchedGame } = createLoader({ refuse: true });
  const saved = { boxScore: { state: "live", away: {}, home: {} }, lead: { periods: 4 } };
  assert.deepEqual(await loadWatchedGame(ID, createSnapshot("live"), saved), saved);
});
