import test from "node:test";
import assert from "node:assert/strict";
import { findOpeningRound } from "#shared/opening-round.js";

const isDecided = (series) => !!series.winner;
const decided = { winner: "A" };
const open = { winner: null };

test("a bracket opens on the earliest round with a series still to finish", () => {
  assert.equal(findOpeningRound([[open, open], [open], [open]], isDecided), 0);
  assert.equal(findOpeningRound([[decided, open], [open], [open]], isDecided), 0);
  assert.equal(findOpeningRound([[decided, decided], [open], [open]], isDecided), 1);
});

test("a finished bracket opens on its last round", () => {
  assert.equal(findOpeningRound([[decided, decided], [decided], [decided]], isDecided), 2);
});
