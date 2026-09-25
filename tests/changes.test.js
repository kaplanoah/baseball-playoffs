/* The regular-season update log: what moved between the table the page last
   recorded and a new snapshot. Each case starts from the real snapshot of
   24 September 2026 and turns the stored baseline back to how it stood
   before one change. */
const test = require("node:test");
const assert = require("node:assert/strict");
const S = require("../js/snapshot.js");
const C = require("../js/changes.js");

const f = JSON.parse(require("fs").readFileSync(`${__dirname}/fixtures/2026-09-24-evening.json`, "utf8"));
const NOW = Date.parse(f.now);
const AFTER = S.buildSnapshot(f.responses, { season: 2026, now: NOW });
const copy = x => JSON.parse(JSON.stringify(x));

// The baseline as stored: the season document's field, and the standings document.
function baseline(edit = () => {}){
  const before = { teams: copy(AFTER.teams), projected: true, standings: copy(AFTER.standings) };
  edit(before);
  return before;
}
const row = (b, id) => Object.values(b.standings.divisions).flat().find(r => r.id === id);
const withoutAt = entries => entries.map(({ at, ...e }) => e);

test("no change, no entries", () => {
  assert.deepEqual(C.between(baseline(), AFTER, NOW), []);
});

test("an empty baseline is the starting point, not news", () => {
  assert.deepEqual(C.between({ teams: {}, projected: true }, AFTER, NOW), []);
  assert.deepEqual(C.between(null, AFTER, NOW), []);
});

test("a club takes a division lead: the spot, the game behind it, how far back the other is", () => {
  const before = baseline(b => {
    delete b.teams.TEX;
    b.teams.HOU = { league: "AL", seed: 3, w: 78, l: 80 };
  });
  const [e, ...rest] = C.between(before, AFTER, NOW);
  assert.equal(rest.length, 0);
  assert.deepEqual({ ...e, at: undefined }, {
    at: undefined, kind: "field", in: "TEX", out: "HOU", spot: "division", div: "AL West",
    outAlive: true, outBack: "0.5",
    via: [{ team: "TEX", won: true, opp: "NYM", score: [3, 1] }]
  });
  // Logged when the game behind it ended, not when a page happened to notice.
  assert.equal(e.at, "2026-09-24T21:06:00Z");
});

test("two clubs swap seeds: one entry, for the club that moved up", () => {
  const before = baseline(b => { b.teams.SD.seed = 5; b.teams.CHC.seed = 4; });
  // San Diego's game hadn't started; the Cubs' final is the only one to cite.
  assert.deepEqual(withoutAt(C.between(before, AFTER, NOW)), [{
    kind: "seed", team: "SD", from: 5, to: 4, over: "CHC",
    via: [{ team: "CHC", won: true, opp: "MIA", score: [2, 1] }]
  }]);
});

test("a three-way shuffle names no one club as passed", () => {
  const before = baseline(b => { b.teams.SD.seed = 6; b.teams.CHC.seed = 4; b.teams.PHI.seed = 5; });
  const [e] = C.between(before, AFTER, NOW);
  assert.deepEqual({ kind: e.kind, team: e.team, from: e.from, to: e.to, over: e.over },
    { kind: "seed", team: "SD", from: 6, to: 4, over: undefined });
});

test("a division title and an elimination", () => {
  const before = baseline(b => {
    row(b, "TB").clinched = false;
    Object.assign(row(b, "BAL"), { wce: "3" });
  });
  const entries = C.between(before, AFTER, NOW);
  assert.deepEqual(entries.map(e => e.kind).sort(), ["berth", "elim"]);
  const berth = entries.find(e => e.kind === "berth");
  assert.deepEqual({ kind: berth.kind, team: berth.team, what: berth.what, div: berth.div },
    { kind: "berth", team: "TB", what: "division", div: "AL East" });
  const elim = entries.find(e => e.kind === "elim");
  assert.equal(elim.team, "BAL");
  // Baltimore was chasing the last wild card, and the White Sox won 9-1.
  assert.deepEqual(elim.via, [{ team: "CWS", won: true, opp: "KC", score: [9, 1] }]);
});

test("the official bracket: one lock entry, and no seed moves beside it", () => {
  const before = baseline(b => { b.teams.SD.seed = 5; b.teams.CHC.seed = 4; });
  const official = { ...copy(AFTER), projected: false };
  assert.deepEqual(C.between(before, official, NOW).map(e => e.kind), ["lock"]);
});

test("the log keeps each piece of news once, oldest first, the newest fifty", () => {
  const routineWrote = { at: "2026-09-24T23:20:00Z", kind: "elim", team: "BAL" };
  const pageFound = { at: "2026-09-24T23:21:00Z", kind: "elim", team: "BAL", via: [] };
  const game = n => ({ at: new Date(Date.UTC(2026, 9, 1, n)).toISOString(), kind: "game", series: "AL_WC1", game: n, won: "TB", score: [1, 0] });
  assert.deepEqual(C.merge([routineWrote], [pageFound]), [routineWrote]);

  const many = Array.from({ length: 60 }, (_, i) => game(i));
  const merged = C.merge([], many);
  assert.equal(merged.length, C.MAX_LOG);
  assert.equal(merged[0].game, 10);
  assert.deepEqual(C.merge(merged.slice().reverse(), []), merged);
});
