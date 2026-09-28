import test from "node:test";
import assert from "node:assert/strict";
import { groupUpdates } from "../page/js/update-groups.js";

const AT = "2026-09-27T21:43:00Z";
const LATER = "2026-09-27T22:10:00Z";

const PHILLIES_WIN = { team: "PHI", won: true, opp: "TB", score: [7, 3] };
const RANGERS_LOSS = { team: "TEX", won: false, opp: "MIN", score: [4, 6] };
const METS_WIN = { team: "NYM", won: true, opp: "CHC", score: [4, 3] };
const CUBS_LOSS = { team: "CHC", won: false, opp: "NYM", score: [3, 4] };

const createBerth = (team, via, at = AT) => ({ kind: "berth", team, what: "playoff", via, at });
const createElimination = (team, via, at = AT) => ({ kind: "elim", team, via, at });

test("a clinch takes the eliminations its win decided", () => {
  const berth = createBerth("PHI", [PHILLIES_WIN]);
  const elimination = createElimination("ARI", [PHILLIES_WIN]);
  assert.deepEqual(groupUpdates([elimination, berth]), [[berth, elimination]]);
});

test("a clinch with no game of its own takes the eliminations in its league from its update", () => {
  const berth = createBerth("HOU", []);
  const rangers = createElimination("TEX", [RANGERS_LOSS]);
  const orioles = createElimination("BAL", [], LATER);
  const reds = createElimination("CIN", []);
  assert.deepEqual(groupUpdates([berth, rangers, orioles, reds]), [
    [berth, rangers],
    [orioles],
    [reds],
  ]);
});

test("a clinch with its own game leaves an elimination that shares none with it", () => {
  const berth = createBerth("PHI", [PHILLIES_WIN]);
  const elimination = createElimination("ARI", [RANGERS_LOSS]);
  assert.deepEqual(groupUpdates([berth, elimination]), [[berth], [elimination]]);
});

test("eliminations one game decided read as one, and others stay apart", () => {
  const cubs = createElimination("CHC", [CUBS_LOSS, METS_WIN]);
  const giants = createElimination("SF", [METS_WIN]);
  const padres = createElimination("SD", [{ team: "SD", won: false, opp: "LAD", score: [1, 2] }]);
  const giantsLater = createElimination("SF", [METS_WIN], LATER);
  assert.deepEqual(groupUpdates([cubs, padres, giants]), [[cubs, giants], [padres]]);
  assert.deepEqual(groupUpdates([cubs, giantsLater]), [[cubs], [giantsLater]]);
});

test("other updates are never grouped", () => {
  const lock = { kind: "lock", at: AT };
  const seed = { kind: "seed", team: "PHI", from: 5, to: 4, via: [PHILLIES_WIN], at: AT };
  const elimination = createElimination("ARI", [PHILLIES_WIN]);
  assert.deepEqual(groupUpdates([lock, seed, elimination]), [[lock], [seed], [elimination]]);
});
