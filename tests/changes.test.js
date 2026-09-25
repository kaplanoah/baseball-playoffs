/* The regular-season update log: what moved between the table the page last
   recorded and a new snapshot. Small tables built from real nights -- the
   Orioles eliminated and the White Sox clinching on one White Sox win, the
   Rangers passing the Astros -- and then the real snapshot of 24 September
   2026, to check the pieces fit together. */
const test = require("node:test");
const assert = require("node:assert/strict");
const S = require("../js/snapshot.js");
const C = require("../js/changes.js");

const NOW = Date.parse("2026-09-25T02:00:00Z");

// One AL table, with only the fields the log reads.
const row = (id, o) => ({ id, gb: "-", wcgb: "-", elim: "-", wce: "-", lead: false, wcrank: null, clinched: false, clinch: null, ...o });
const table = rows => ({ divisions: {
  "AL East":    rows.filter(r => ["TB", "NYY", "BOS", "BAL", "TOR"].includes(r.id)),
  "AL Central": rows.filter(r => ["CLE", "CWS", "MIN"].includes(r.id)),
  "AL West":    rows.filter(r => ["TEX", "HOU", "SEA"].includes(r.id))
} });
const BEFORE = [
  row("TB",  { lead: true, clinched: true, clinch: "z" }),
  row("NYY", { wcrank: "1", clinch: "w", elim: "E" }),
  row("BOS", { wcrank: "2", clinch: "w", elim: "E" }),
  row("CWS", { wcrank: "3", elim: "4", gb: "0.5" }),
  row("BAL", { wcrank: "5", elim: "E", wce: "1", gb: "18.5", wcgb: "3.0" }),
  row("TOR", { wcrank: "6", elim: "E", wce: "E" }),
  row("CLE", { lead: true }),
  row("MIN", { elim: "E", wce: "E" }),
  row("HOU", { lead: true }),
  row("TEX", { wcrank: "4", gb: "0.5", elim: "4", wce: "2", wcgb: "2.5" }),
  row("SEA", { elim: "1", wce: "E", gb: "4.5" })
];
const set = (rows, id, o) => rows.map(r => r.id === id ? { ...r, ...o } : r);
const TEAMS = { TB: { league: "AL", seed: 1 }, CLE: { league: "AL", seed: 2 }, HOU: { league: "AL", seed: 3 },
  NYY: { league: "AL", seed: 4 }, BOS: { league: "AL", seed: 5 }, CWS: { league: "AL", seed: 6 } };
const final = (away, home, score) => ({ away, home, state: "final", score });

/* The log entries from one table to the next, without `at`. */
function changes(oldRows, newRows, oldTeams, newTeams, games = [], projected = true){
  const before = { teams: oldTeams, projected: true, standings: table(oldRows) };
  const after = { teams: newTeams, projected, standings: table(newRows), slate: { today: { games } } };
  return C.between(before, after, NOW).map(({ at, ...e }) => e);
}

test("nothing moved, nothing logged", () => {
  assert.deepEqual(changes(BEFORE, BEFORE, TEAMS, TEAMS), []);
});

test("an empty baseline is the starting point, not news", () => {
  assert.deepEqual(C.between({ teams: {}, projected: true }, { teams: TEAMS, standings: table(BEFORE) }, NOW), []);
  assert.deepEqual(C.between(null, { teams: TEAMS }, NOW), []);
});

test("one White Sox win: the Orioles are out and the White Sox are in", () => {
  let after = set(BEFORE, "BAL", { wce: "E", wcgb: "4.0" });
  after = set(after, "CWS", { clinch: "x" });
  const cws = { team: "CWS", won: true, opp: "KC", score: [9, 1] };
  assert.deepEqual(changes(BEFORE, after, TEAMS, TEAMS, [final("CWS", "KC", [9, 1])]), [
    { kind: "berth", team: "CWS", what: "playoff", via: [cws] },
    { kind: "elim", team: "BAL", via: [cws] }
  ]);
});

test("the Rangers pass the Astros: the spot, how far back, and the game", () => {
  let after = set(BEFORE, "TEX", { lead: true, gb: "-", elim: "-", wce: "-", wcrank: null, wcgb: "-" });
  after = set(after, "HOU", { lead: false, gb: "0.5", elim: "4", wce: "E", wcrank: "4", wcgb: "3.5" });
  after = set(after, "SEA", { elim: "E" });
  const teams = { ...TEAMS, TEX: { league: "AL", seed: 3 } };
  delete teams.HOU;
  const tex = { team: "TEX", won: true, opp: "NYM", score: [3, 1] };
  assert.deepEqual(changes(BEFORE, after, TEAMS, teams, [final("NYM", "TEX", [1, 3])]), [
    { kind: "field", in: "TEX", out: "HOU", via: [tex], spot: "division", div: "AL West", outAlive: true, outBack: "0.5" },
    // The Mariners' last route was the division, closed by the leader's win.
    { kind: "elim", team: "SEA", via: [tex] }
  ]);
});

test("each step up is news: a wild card after a playoff spot, a bye after a division", () => {
  const was = set(set(BEFORE, "CWS", { clinch: "x" }), "CLE", { clinch: "y", clinched: true });
  const now = set(set(was, "CWS", { clinch: "w" }), "CLE", { clinch: "z" });
  assert.deepEqual(changes(was, now, TEAMS, TEAMS), [
    { kind: "berth", team: "CWS", what: "wildcard" },
    { kind: "berth", team: "CLE", what: "bye" }
  ]);
  assert.deepEqual(changes(now, now, TEAMS, TEAMS), []);
});

test("a table saved before clinch markers were kept only yields division titles", () => {
  const old = BEFORE.map(({ clinch, ...r }) => r);
  const now = set(set(BEFORE, "CWS", { clinch: "x" }), "CLE", { clinch: "y", clinched: true });
  assert.deepEqual(changes(old, now, TEAMS, TEAMS), [{ kind: "berth", team: "CLE", what: "division", div: "AL Central" }]);
});

test("a wild card changes hands: the spot, how far back, and both games", () => {
  let after = set(BEFORE, "TEX", { wcrank: "3", wcgb: "-", wce: "-" });
  after = set(after, "CWS", { wcrank: "4", wcgb: "0.5", wce: "3" });
  const teams = { ...TEAMS, TEX: { league: "AL", seed: 6 } };
  delete teams.CWS;
  assert.deepEqual(changes(BEFORE, after, TEAMS, teams, [final("NYM", "TEX", [1, 3]), final("CWS", "KC", [2, 5])]), [{
    kind: "field", in: "TEX", out: "CWS",
    via: [{ team: "TEX", won: true, opp: "NYM", score: [3, 1] }, { team: "CWS", won: false, opp: "KC", score: [2, 5] }],
    spot: "wildcard", outAlive: true, outBack: "0.5"
  }]);
});

test("seeds: a pass inside the field names who was passed and why", () => {
  // The Padres pass the Cubs for the NL 4 seed on a Cubs loss.
  const nl = { SD: { league: "NL", seed: 5 }, CHC: { league: "NL", seed: 4 }, PHI: { league: "NL", seed: 6 } };
  const now = { ...nl, SD: { league: "NL", seed: 4 }, CHC: { league: "NL", seed: 5 } };
  assert.deepEqual(changes(BEFORE, BEFORE, nl, now, [final("MIA", "CHC", [3, 2])]), [{
    kind: "seed", team: "SD", from: 5, to: 4, over: "CHC",
    via: [{ team: "CHC", won: false, opp: "MIA", score: [2, 3] }]
  }]);
});

test("a division lead changes hands inside the field: one seed entry, the club that rose", () => {
  const now = { ...TEAMS, CWS: { league: "AL", seed: 2 }, CLE: { league: "AL", seed: 6 } };
  assert.deepEqual(changes(BEFORE, BEFORE, TEAMS, now, [final("CWS", "KC", [9, 1])]), [{
    kind: "seed", team: "CWS", from: 6, to: 2, over: "CLE",
    via: [{ team: "CWS", won: true, opp: "KC", score: [9, 1] }]
  }]);
});

test("a three-way shuffle names no one club as passed", () => {
  const now = { ...TEAMS, CWS: { league: "AL", seed: 4 }, NYY: { league: "AL", seed: 5 }, BOS: { league: "AL", seed: 6 } };
  assert.deepEqual(changes(BEFORE, BEFORE, TEAMS, now), [{ kind: "seed", team: "CWS", from: 6, to: 4 }]);
});

test("the official bracket: one lock entry, and no seed moves beside it", () => {
  const now = { ...TEAMS, CWS: { league: "AL", seed: 2 }, CLE: { league: "AL", seed: 6 } };
  assert.deepEqual(changes(BEFORE, BEFORE, TEAMS, now, [], false), [{ kind: "lock" }]);
});

test("an entry is logged when it was noticed", () => {
  const after = set(BEFORE, "BAL", { wce: "E" });
  const games = [{ ...final("CWS", "KC", [9, 1]), end: "2026-09-24T20:45:00Z" }];
  const [e] = C.between({ teams: TEAMS, projected: true, standings: table(BEFORE) },
    { teams: TEAMS, projected: true, standings: table(after), slate: { today: { games } } }, NOW);
  // Not 8:45, when the game ended: you may have dismissed the log since.
  assert.equal(e.at, "2026-09-25T02:00:00Z");
  assert.deepEqual(e.via, [{ team: "CWS", won: true, opp: "KC", score: [9, 1] }]);
});

test("the real snapshot of 24 September against itself, and against the night before", () => {
  const f = JSON.parse(require("fs").readFileSync(`${__dirname}/fixtures/2026-09-24-evening.json`, "utf8"));
  const snap = S.buildSnapshot(f.responses, { season: 2026, now: Date.parse(f.now) });
  const stored = { teams: snap.teams, projected: true, standings: snap.standings };
  assert.deepEqual(C.between(stored, snap, NOW), []);
  // The night before, Baltimore still had a wild card route.
  const earlier = JSON.parse(JSON.stringify(stored));
  earlier.standings.divisions["AL East"].find(r => r.id === "BAL").wce = "1";
  const [e, ...rest] = C.between(earlier, snap, NOW);
  assert.equal(rest.length, 0);
  assert.deepEqual({ kind: e.kind, team: e.team, via: e.via },
    { kind: "elim", team: "BAL", via: [{ team: "CWS", won: true, opp: "KC", score: [9, 1] }] });
});

test("the log keeps each piece of news once, oldest first, the newest fifty", () => {
  // The routine logged this elimination; the page noticing it again changes nothing.
  const routineWrote = { at: "2026-09-24T23:20:00Z", kind: "elim", team: "BAL" };
  const pageFound = { at: "2026-09-24T23:21:00Z", kind: "elim", team: "BAL", via: [] };
  assert.deepEqual(C.merge([routineWrote], [pageFound]), [routineWrote]);

  const game = n => ({ at: new Date(Date.UTC(2026, 9, 1, n)).toISOString(), kind: "game", series: "AL_WC1", game: n, won: "TB", score: [1, 0] });
  const merged = C.merge([], Array.from({ length: 60 }, (_, i) => game(i)));
  assert.equal(merged.length, C.MAX_LOG);
  assert.equal(merged[0].game, 10);
  assert.deepEqual(C.merge(merged.slice().reverse(), []), merged);
});
