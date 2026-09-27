import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as MLBSnapshot from "../page/js/snapshot.js";
import {
  describeNotification,
  findNotableEntries,
  listNotifications,
} from "../worker/src/notifications.js";

const FINAL_2025 = JSON.parse(
  readFileSync(`${import.meta.dirname}/fixtures/2025-final.json`, "utf8"),
);
const SNAPSHOT = MLBSnapshot.buildSnapshot(FINAL_2025.responses, {
  season: 2025,
  now: Date.parse(FINAL_2025.now),
});
const CONTEXT = { teams: SNAPSHOT.teams, standings: SNAPSHOT.standings };
const findLogEntry = (kind, game) =>
  SNAPSHOT.log.find((entry) => entry.kind === kind && entry.series === "WS" && entry.game === game);
const GAME_5 = findLogEntry("game", 5);
const CLINCH = findLogEntry("clinch", undefined);

test("a notification's title is the update's main clause, and its body the rest", () => {
  assert.deepEqual(describeNotification(GAME_5, CONTEXT), {
    title: "Blue Jays took Game 5",
    body: "Lead the World Series 3–2",
    tag: "game:WS:5",
  });
  assert.deepEqual(describeNotification(CLINCH, CONTEXT), {
    title: "Dodgers win the World Series, 4–3 over the Blue Jays",
    body: "",
    tag: "clinch:WS",
  });
  assert.equal(describeNotification({ kind: "unknown", at: GAME_5.at }, CONTEXT), null);
});

const NOW = Date.parse(GAME_5.at) + 60 * 1000;
const findFor = (ranking, { before = [], after = [GAME_5], now = NOW } = {}) =>
  findNotableEntries({ before, after, ranking, state: SNAPSHOT, now });

test("a new update about any club in the ranking is notable, win or lose", () => {
  assert.deepEqual(findFor(["TOR"]), [GAME_5]);
  assert.deepEqual(findFor(["LAD"]), [GAME_5], "the Dodgers lost Game 5");
  assert.deepEqual(findFor(["NYY", "SEA"]), []);
});

test("an update already known, or noticed long ago, is not notable", () => {
  assert.deepEqual(findFor(["TOR"], { before: [GAME_5] }), []);
  assert.deepEqual(findFor(["TOR"], { now: NOW + 2 * 60 * 60 * 1000 }), []);
});

test("an update about the whole field is notable once anything is ranked", () => {
  const lock = { kind: "lock", at: GAME_5.at };
  assert.deepEqual(findFor(["NYY"], { after: [lock] }), [lock]);
  assert.deepEqual(findFor([], { after: [lock] }), []);
});

test("past a few updates at once, the rest are summed up in one", () => {
  const entries = SNAPSHOT.log.filter((entry) => entry.series === "WS");
  const messages = listNotifications(entries, CONTEXT);
  assert.equal(messages.length, 4);
  assert.equal(messages[0].title, "Blue Jays took Game 1");
  assert.deepEqual(messages[3], {
    title: `${entries.length - 3} more updates`,
    body: "Open the page to see them all.",
    tag: "more",
  });
  assert.equal(listNotifications(entries.slice(0, 4), CONTEXT).length, 4);
});
