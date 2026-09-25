/* routine/changes.py: what the routine logs when the standings move. Run
   through python3, the way the routine runs it, on small tables built from
   real nights: the Orioles eliminated and the White Sox clinching on one
   White Sox win, and the Rangers passing the Astros. */
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");

const SCRIPT = path.join(__dirname, "..", "routine", "changes.py");

function changes(oldSt, newSt, oldTeams, newTeams, games, extra = []){
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "changes-"));
  const files = [oldSt, newSt, oldTeams, newTeams, games, ...extra].map((doc, i) => {
    const f = path.join(dir, `${i}.json`);
    fs.writeFileSync(f, JSON.stringify(doc));
    return f;
  });
  return JSON.parse(execFileSync("python3", [SCRIPT, ...files], { encoding: "utf8" }));
}

// One AL table, as the routine writes it, with only the fields the script reads.
const row = (id, o) => ({ id, gb: "-", wcgb: "-", elim: "-", wce: "-", lead: false, wcrank: null, clinched: false, clinch: null, ...o });
const table = rows => ({ divisions: {
  "AL East":    rows.filter(r => ["TB", "NYY", "BOS", "BAL", "TOR"].includes(r.id)),
  "AL Central": rows.filter(r => ["CLE", "CWS", "MIN"].includes(r.id)),
  "AL West":    rows.filter(r => ["TEX", "HOU", "SEA"].includes(r.id))
} });
const before = [
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

test("one White Sox win: the Orioles are out and the White Sox are in", () => {
  let after = set(before, "BAL", { wce: "E", wcgb: "4.0" });
  after = set(after, "CWS", { clinch: "x" });
  const out = changes(table(before), table(after), TEAMS, TEAMS, [final("CWS", "KC", [9, 1])]);
  const cws = { team: "CWS", won: true, opp: "KC", score: [9, 1] };
  assert.deepEqual(out, [
    { kind: "berth", team: "CWS", what: "playoff", via: [cws] },
    { kind: "elim", team: "BAL", via: [cws] }
  ]);
});

test("the Rangers pass the Astros: the spot, how far back, and the game", () => {
  let after = set(before, "TEX", { lead: true, gb: "-", elim: "-", wce: "-", wcrank: null, wcgb: "-" });
  after = set(after, "HOU", { lead: false, gb: "0.5", elim: "4", wce: "E", wcrank: "4", wcgb: "3.5" });
  after = set(after, "SEA", { elim: "E" });
  const teams = { ...TEAMS, TEX: { league: "AL", seed: 3 } };
  delete teams.HOU;
  const out = changes(table(before), table(after), TEAMS, teams, [final("NYM", "TEX", [1, 3])]);
  const tex = { team: "TEX", won: true, opp: "NYM", score: [3, 1] };
  assert.deepEqual(out, [
    { kind: "field", in: "TEX", out: "HOU", via: [tex], spot: "division", div: "AL West", outAlive: true, outBack: "0.5" },
    // The Mariners' last route was the division, closed by the leader's win.
    { kind: "elim", team: "SEA", via: [tex] }
  ]);
});

test("each step up is news: a wild card after a playoff spot, a bye after a division", () => {
  const was = set(set(before, "CWS", { clinch: "x" }), "CLE", { clinch: "y", clinched: true });
  const now = set(set(was, "CWS", { clinch: "w" }), "CLE", { clinch: "z" });
  const out = changes(table(was), table(now), TEAMS, TEAMS, []);
  assert.deepEqual(out, [
    { kind: "berth", team: "CWS", what: "wildcard" },
    { kind: "berth", team: "CLE", what: "bye" }
  ]);
  // Nothing moved: nothing to log.
  assert.deepEqual(changes(table(now), table(now), TEAMS, TEAMS, []), []);
});

test("a table saved before clinch markers were kept only yields division titles", () => {
  const old = before.map(({ clinch, ...r }) => r);
  const now = set(set(before, "CWS", { clinch: "x" }), "CLE", { clinch: "y", clinched: true });
  const out = changes(table(old), table(now), TEAMS, TEAMS, []);
  assert.deepEqual(out, [{ kind: "berth", team: "CLE", what: "division", div: "AL Central" }]);
});

test("a wild card changes hands: the spot, how far back, and both games", () => {
  let after = set(before, "TEX", { wcrank: "3", wcgb: "-", wce: "-" });
  after = set(after, "CWS", { wcrank: "4", wcgb: "0.5", wce: "3" });
  const teams = { ...TEAMS, TEX: { league: "AL", seed: 6 } };
  delete teams.CWS;
  const out = changes(table(before), table(after), TEAMS, teams,
    [final("NYM", "TEX", [1, 3]), final("CWS", "KC", [2, 5])]);
  assert.deepEqual(out, [{ kind: "field", in: "TEX", out: "CWS",
    via: [{ team: "TEX", won: true, opp: "NYM", score: [3, 1] }, { team: "CWS", won: false, opp: "KC", score: [2, 5] }],
    spot: "wildcard", outAlive: true, outBack: "0.5" }]);
});

test("seeds: a pass inside the field names who was passed and why", () => {
  // The Padres pass the Cubs for the NL 4 seed on a Cubs loss.
  const nl = { SD: { league: "NL", seed: 5 }, CHC: { league: "NL", seed: 4 }, PHI: { league: "NL", seed: 6 } };
  const now = { ...nl, SD: { league: "NL", seed: 4 }, CHC: { league: "NL", seed: 5 } };
  const out = changes(table(before), table(before), nl, now, [final("MIA", "CHC", [3, 2])]);
  assert.deepEqual(out, [{ kind: "seed", team: "SD", from: 5, to: 4, over: "CHC",
    via: [{ team: "CHC", won: false, opp: "MIA", score: [2, 3] }] }]);
});

test("a division lead changes hands inside the field: one seed entry, the club that rose", () => {
  // The White Sox pass the Guardians for the AL Central: 6 -> 2, and the Guardians drop to 6.
  const now = { ...TEAMS, CWS: { league: "AL", seed: 2 }, CLE: { league: "AL", seed: 6 } };
  const out = changes(table(before), table(before), TEAMS, now, [final("CWS", "KC", [9, 1])]);
  assert.deepEqual(out, [{ kind: "seed", team: "CWS", from: 6, to: 2, over: "CLE",
    via: [{ team: "CWS", won: true, opp: "KC", score: [9, 1] }] }]);
});

test("the projected field: division leaders by win percentage, then wild cards by rank", () => {
  const st = { divisions: {
    "AL East":    [{ id: "TB", lead: true, pct: ".608", w: 96, l: 62 }, { id: "NYY", wcrank: "1", pct: ".576", w: 91, l: 67 },
                   { id: "BOS", wcrank: "2", pct: ".538", w: 85, l: 73 }, { id: "BAL", wcrank: "5", pct: ".491", w: 78, l: 81 }],
    "AL Central": [{ id: "CLE", lead: true, pct: ".519", w: 82, l: 76 }, { id: "CWS", wcrank: "3", pct: ".516", w: 82, l: 77 }],
    "AL West":    [{ id: "TEX", lead: true, pct: ".497", w: 79, l: 80 }, { id: "HOU", wcrank: "4", pct: ".494", w: 78, l: 80 }]
  } };
  const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "proj-")), "st.json");
  fs.writeFileSync(f, JSON.stringify(st));
  const teams = JSON.parse(execFileSync("python3", [SCRIPT, "project", f], { encoding: "utf8" }));
  const seeds = Object.fromEntries(Object.entries(teams).map(([id, t]) => [id, t.seed]));
  assert.deepEqual(seeds, { TB: 1, CLE: 2, TEX: 3, NYY: 4, BOS: 5, CWS: 6 });
  assert.deepEqual(teams.CWS, { league: "AL", seed: 6, w: 82, l: 77 });
});

test("catch-up: anything MLB shows that the log never recorded is logged, once", () => {
  // Nothing moved on this run, but the log is missing the Blue Jays' elimination
  // and the Yankees' wild card. The Twins were out before the log began.
  const now = set(set(before, "TOR", { elim: "E", wce: "E" }), "NYY", { clinch: "w" });
  const log = { log: [{ kind: "elim", team: "SEA" }, { kind: "berth", team: "TB", what: "bye" }] };
  const baseline = { out: ["MIN"], clinch: { TB: "x", NYY: "x", BOS: "x" } };
  const out = changes(table(now), table(now), TEAMS, TEAMS, [], [log, baseline]);
  assert.deepEqual(out, [
    { kind: "berth", team: "NYY", what: "wildcard", late: true },
    { kind: "berth", team: "BOS", what: "wildcard", late: true },
    { kind: "elim", team: "TOR", late: true }
  ]);
  // Once logged, never again.
  const logged = { log: [...log.log, ...out] };
  assert.deepEqual(changes(table(now), table(now), TEAMS, TEAMS, [], [logged, baseline]), []);
});
