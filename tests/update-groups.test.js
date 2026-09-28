import test from "node:test";
import assert from "node:assert/strict";
import { groupUpdates } from "../page/js/update-groups.js";

const AT = "2026-09-27T21:43:00Z";
const MINUTES_LATER = "2026-09-27T21:48:00Z";
const NEXT_DAY = "2026-09-28T21:43:00Z";

const PHILLIES_WIN = { team: "PHI", won: true, opp: "TB", score: [7, 3] };
const RANGERS_LOSS = { team: "TEX", won: false, opp: "MIN", score: [4, 6] };
const METS_WIN = { team: "NYM", won: true, opp: "CHC", score: [4, 3] };
const CUBS_LOSS = { team: "CHC", won: false, opp: "NYM", score: [3, 4] };

const createBerth = (team, via, at = AT) => ({ kind: "berth", team, what: "playoff", via, at });
const createElimination = (team, via, at = AT) => ({ kind: "elim", team, via, at });

test("a clinch takes the eliminations its win decided, even when MLB posted it later", () => {
  const berth = createBerth("PHI", [PHILLIES_WIN]);
  const elimination = createElimination("ARI", [PHILLIES_WIN]);
  assert.deepEqual(groupUpdates([elimination, berth]), [[berth, elimination]]);
  const postedLater = createBerth("PHI", [PHILLIES_WIN], MINUTES_LATER);
  assert.deepEqual(groupUpdates([elimination, postedLater]), [[postedLater, elimination]]);
  const nextDay = createBerth("PHI", [PHILLIES_WIN], NEXT_DAY);
  assert.deepEqual(groupUpdates([elimination, nextDay]), [[elimination], [nextDay]]);
});

test("a clinch with no game of its own takes the eliminations in its league from its update", () => {
  const berth = createBerth("HOU", []);
  const rangers = createElimination("TEX", [RANGERS_LOSS]);
  const orioles = createElimination("BAL", [], MINUTES_LATER);
  const reds = createElimination("CIN", []);
  assert.deepEqual(groupUpdates([berth, rangers, orioles, reds]), [
    [berth, rangers],
    [orioles],
    [reds],
  ]);
});

test("an elimination goes with the clinch that shares its game, not one with no game", () => {
  const astrosWin = { team: "HOU", won: true, opp: "SEA", score: [4, 1] };
  const yankees = createBerth("NYY", []);
  const astros = { ...createBerth("HOU", [astrosWin]), what: "division" };
  const mariners = createElimination("SEA", [
    { ...astrosWin, team: "SEA", opp: "HOU", won: false, score: [1, 4] },
  ]);
  assert.deepEqual(groupUpdates([yankees, astros, mariners]), [[yankees], [astros, mariners]]);
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
  const giantsNextDay = createElimination("SF", [METS_WIN], NEXT_DAY);
  assert.deepEqual(groupUpdates([cubs, padres, giants]), [[cubs, giants], [padres]]);
  assert.deepEqual(groupUpdates([cubs, giantsNextDay]), [[cubs], [giantsNextDay]]);
});

test("other updates are never grouped", () => {
  const lock = { kind: "lock", at: AT };
  const seed = { kind: "seed", team: "PHI", from: 5, to: 4, via: [PHILLIES_WIN], at: AT };
  const elimination = createElimination("ARI", [PHILLIES_WIN]);
  assert.deepEqual(groupUpdates([lock, seed, elimination]), [[lock], [seed], [elimination]]);
});
