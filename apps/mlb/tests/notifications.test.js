import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as MLBSnapshot from "../page/js/snapshot.js";
import {
  describeNotification,
  findNotableUpdates,
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
  assert.deepEqual(describeNotification([GAME_5], CONTEXT), {
    title: "Blue Jays took Game 5",
    body: "Lead the World Series 3\u20132",
    tag: "game:WS:5",
  });
  assert.deepEqual(describeNotification([CLINCH], CONTEXT), {
    title: "Dodgers win the World Series, 4\u20133 over the Blue Jays",
    body: "",
    tag: "clinch:WS",
  });
  assert.equal(describeNotification([{ kind: "unknown", at: GAME_5.at }], CONTEXT), null);
});

const NOW = Date.parse(GAME_5.at) + 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;
const findFor = ({ before = [], after = [GAME_5], now = NOW } = {}) =>
  findNotableUpdates({ before, after, state: SNAPSHOT, now });

test("a new update about any club in the field is notable, and one about others is not", () => {
  assert.deepEqual(findFor(), [[GAME_5]]);
  const outsider = { kind: "elim", team: "TEX", at: GAME_5.at };
  assert.deepEqual(findFor({ after: [outsider] }), []);
});

test("an update already known is not notable", () => {
  assert.deepEqual(findFor({ before: [GAME_5] }), []);
});

test("a change found long ago is not notable, but a game seen late still is", () => {
  const elimination = { kind: "elim", team: "NYY", at: GAME_5.at };
  assert.deepEqual(findFor({ after: [elimination], now: NOW + 2 * HOUR_MS }), []);
  assert.deepEqual(findFor({ now: NOW + 2 * HOUR_MS }), [[GAME_5]]);
  assert.deepEqual(findFor({ now: NOW + 25 * HOUR_MS }), []);
});

test("an update about the whole field is notable", () => {
  const lock = { kind: "lock", at: GAME_5.at };
  assert.deepEqual(findFor({ after: [lock] }), [[lock]]);
});

test("past a few updates at once, the rest are summed up in one", () => {
  const entries = SNAPSHOT.log.filter((entry) => entry.series === "WS");
  const messages = listNotifications(
    entries.map((entry) => [entry]),
    CONTEXT,
  );
  assert.equal(messages.length, 4);
  assert.equal(messages[0].title, "Blue Jays took Game 1");
  assert.deepEqual(messages[3], {
    title: `${entries.length - 3} more updates`,
    body: "Open the page to see them all.",
    tag: "more:game:WS:4",
  });
  const fourGroups = entries.slice(0, 4).map((entry) => [entry]);
  assert.equal(listNotifications(fourGroups, CONTEXT).length, 4);
});

const RANGERS_LOSS = { team: "TEX", won: false, opp: "MIN", score: [4, 6] };
const ASTROS_CLINCH = {
  kind: "berth",
  team: "HOU",
  what: "division",
  div: "AL West",
  via: [RANGERS_LOSS],
  at: GAME_5.at,
};
const RANGERS_OUT = { kind: "elim", team: "TEX", via: [RANGERS_LOSS], at: GAME_5.at };

test("a clinch and the eliminations it brought are one notification, if any club is in the field", () => {
  const after = [ASTROS_CLINCH, RANGERS_OUT];
  const findIn = (field) =>
    findNotableUpdates({ before: [], after, state: { ...SNAPSHOT, teams: field }, now: NOW });
  assert.deepEqual(findIn({ TEX: {} }), [after]);
  assert.deepEqual(findIn({ HOU: {} }), [after]);
  assert.deepEqual(findIn({ SEA: {} }), []);
  assert.deepEqual(describeNotification(after, CONTEXT), {
    title: "Astros clinch the AL West",
    body: "Rangers eliminated with a 6-4 loss to the Twins",
    tag: "berth:HOU:division",
  });
});
