import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as MLBSnapshot from "../page/js/snapshot.js";
import * as LogChanges from "../page/js/changes.js";

const NOW = Date.parse("2026-09-25T02:00:00Z");

const createRow = (id, overrides) => ({
  id,
  gb: "-",
  wcgb: "-",
  elim: "-",
  wce: "-",
  lead: false,
  wcrank: null,
  clinched: false,
  clinch: null,
  ...overrides,
});
const buildTable = (rows) => ({
  divisions: {
    "AL East": rows.filter((row) => ["TB", "NYY", "BOS", "BAL", "TOR"].includes(row.id)),
    "AL Central": rows.filter((row) => ["CLE", "CWS", "MIN"].includes(row.id)),
    "AL West": rows.filter((row) => ["TEX", "HOU", "SEA"].includes(row.id)),
  },
});
const BEFORE = [
  createRow("TB", { lead: true, clinched: true, clinch: "z" }),
  createRow("NYY", { wcrank: "1", clinch: "w", elim: "E" }),
  createRow("BOS", { wcrank: "2", clinch: "w", elim: "E" }),
  createRow("CWS", { wcrank: "3", elim: "4", gb: "0.5" }),
  createRow("BAL", { wcrank: "5", elim: "E", wce: "1", gb: "18.5", wcgb: "3.0" }),
  createRow("TOR", { wcrank: "6", elim: "E", wce: "E" }),
  createRow("CLE", { lead: true }),
  createRow("MIN", { elim: "E", wce: "E" }),
  createRow("HOU", { lead: true }),
  createRow("TEX", { wcrank: "4", gb: "0.5", elim: "4", wce: "2", wcgb: "2.5" }),
  createRow("SEA", { elim: "1", wce: "E", gb: "4.5" }),
];
const updateRow = (rows, id, overrides) =>
  rows.map((row) => (row.id === id ? { ...row, ...overrides } : row));
const TEAMS = {
  TB: { league: "AL", seed: 1 },
  CLE: { league: "AL", seed: 2 },
  HOU: { league: "AL", seed: 3 },
  NYY: { league: "AL", seed: 4 },
  BOS: { league: "AL", seed: 5 },
  CWS: { league: "AL", seed: 6 },
};
const createFinal = (away, home, score) => ({ away, home, state: "final", score });

function findTableChanges(oldRows, newRows, oldTeams, newTeams, games = [], projected = true) {
  const before = { teams: oldTeams, projected: true, standings: buildTable(oldRows) };
  const after = {
    teams: newTeams,
    projected,
    standings: buildTable(newRows),
    slate: { today: { games } },
  };
  return LogChanges.findChanges(before, after, NOW).map(({ at, ...entry }) => entry);
}

test("nothing moved, nothing logged", () => {
  assert.deepEqual(findTableChanges(BEFORE, BEFORE, TEAMS, TEAMS), []);
});

test("an empty baseline is the starting point, not news", () => {
  assert.deepEqual(
    LogChanges.findChanges(
      { teams: {}, projected: true },
      { teams: TEAMS, standings: buildTable(BEFORE) },
      NOW,
    ),
    [],
  );
  assert.deepEqual(LogChanges.findChanges(null, { teams: TEAMS }, NOW), []);
});

test("one White Sox win: the Orioles are out and the White Sox are in", () => {
  let after = updateRow(BEFORE, "BAL", { wce: "E", wcgb: "4.0" });
  after = updateRow(after, "CWS", { clinch: "x" });
  const whiteSoxWin = { team: "CWS", won: true, opp: "KC", score: [9, 1] };
  assert.deepEqual(
    findTableChanges(BEFORE, after, TEAMS, TEAMS, [createFinal("CWS", "KC", [9, 1])]),
    [
      { kind: "berth", team: "CWS", what: "playoff", via: [whiteSoxWin] },
      { kind: "elim", team: "BAL", via: [whiteSoxWin] },
    ],
  );
});

test("the Rangers pass the Astros: the spot, how far back, and the game", () => {
  let after = updateRow(BEFORE, "TEX", {
    lead: true,
    gb: "-",
    elim: "-",
    wce: "-",
    wcrank: null,
    wcgb: "-",
  });
  after = updateRow(after, "HOU", {
    lead: false,
    gb: "0.5",
    elim: "4",
    wce: "E",
    wcrank: "4",
    wcgb: "3.5",
  });
  after = updateRow(after, "SEA", { elim: "E" });
  const teams = { ...TEAMS, TEX: { league: "AL", seed: 3 } };
  delete teams.HOU;
  const rangersWin = { team: "TEX", won: true, opp: "NYM", score: [3, 1] };
  assert.deepEqual(
    findTableChanges(BEFORE, after, TEAMS, teams, [createFinal("NYM", "TEX", [1, 3])]),
    [
      {
        kind: "field",
        in: "TEX",
        out: "HOU",
        via: [rangersWin],
        spot: "division",
        div: "AL West",
        outAlive: true,
        outBack: "0.5",
      },
      { kind: "elim", team: "SEA", via: [rangersWin] },
    ],
  );
});

test("each step up is news: a wild card after a playoff spot, a bye after a division", () => {
  const was = updateRow(updateRow(BEFORE, "CWS", { clinch: "x" }), "CLE", {
    clinch: "y",
    clinched: true,
  });
  const now = updateRow(updateRow(was, "CWS", { clinch: "w" }), "CLE", { clinch: "z" });
  assert.deepEqual(findTableChanges(was, now, TEAMS, TEAMS), [
    { kind: "berth", team: "CWS", what: "wildcard" },
    { kind: "berth", team: "CLE", what: "bye" },
  ]);
  assert.deepEqual(findTableChanges(now, now, TEAMS, TEAMS), []);
});

test("a table saved before clinch markers were kept only yields division titles", () => {
  const rowsWithoutClinch = BEFORE.map(({ clinch, ...row }) => row);
  const now = updateRow(updateRow(BEFORE, "CWS", { clinch: "x" }), "CLE", {
    clinch: "y",
    clinched: true,
  });
  assert.deepEqual(findTableChanges(rowsWithoutClinch, now, TEAMS, TEAMS), [
    { kind: "berth", team: "CLE", what: "division", div: "AL Central" },
  ]);
});

test("a wild card changes hands: the spot, how far back, and both games", () => {
  let after = updateRow(BEFORE, "TEX", { wcrank: "3", wcgb: "-", wce: "-" });
  after = updateRow(after, "CWS", { wcrank: "4", wcgb: "0.5", wce: "3" });
  const teams = { ...TEAMS, TEX: { league: "AL", seed: 6 } };
  delete teams.CWS;
  assert.deepEqual(
    findTableChanges(BEFORE, after, TEAMS, teams, [
      createFinal("NYM", "TEX", [1, 3]),
      createFinal("CWS", "KC", [2, 5]),
    ]),
    [
      {
        kind: "field",
        in: "TEX",
        out: "CWS",
        via: [
          { team: "TEX", won: true, opp: "NYM", score: [3, 1] },
          { team: "CWS", won: false, opp: "KC", score: [2, 5] },
        ],
        spot: "wildcard",
        outAlive: true,
        outBack: "0.5",
      },
    ],
  );
});

test("seeds: a pass inside the field names who was passed and why", () => {
  const nationalLeagueTeams = {
    SD: { league: "NL", seed: 5 },
    CHC: { league: "NL", seed: 4 },
    PHI: { league: "NL", seed: 6 },
  };
  const now = {
    ...nationalLeagueTeams,
    SD: { league: "NL", seed: 4 },
    CHC: { league: "NL", seed: 5 },
  };
  assert.deepEqual(
    findTableChanges(BEFORE, BEFORE, nationalLeagueTeams, now, [createFinal("MIA", "CHC", [3, 2])]),
    [
      {
        kind: "seed",
        team: "SD",
        from: 5,
        to: 4,
        over: "CHC",
        via: [{ team: "CHC", won: false, opp: "MIA", score: [2, 3] }],
      },
    ],
  );
});

test("a pass names only the games that helped: not the loss of the club that rose", () => {
  const nationalLeagueTeams = {
    PHI: { league: "NL", seed: 5 },
    CHC: { league: "NL", seed: 6 },
  };
  const now = { PHI: { league: "NL", seed: 6 }, CHC: { league: "NL", seed: 5 } };
  assert.deepEqual(
    findTableChanges(BEFORE, BEFORE, nationalLeagueTeams, now, [
      createFinal("CHC", "BOS", [3, 4]),
      createFinal("PHI", "TB", [0, 2]),
    ]),
    [
      {
        kind: "seed",
        team: "CHC",
        from: 6,
        to: 5,
        over: "PHI",
        via: [{ team: "PHI", won: false, opp: "TB", score: [0, 2] }],
      },
    ],
  );
});

test("a wild card taken by a club that lost names only the loss of the club it passed", () => {
  let after = updateRow(BEFORE, "TEX", { wcrank: "3", wcgb: "-", wce: "-" });
  after = updateRow(after, "CWS", { wcrank: "4", wcgb: "0.5", wce: "3" });
  const teams = { ...TEAMS, TEX: { league: "AL", seed: 6 } };
  delete teams.CWS;
  const [entry] = findTableChanges(BEFORE, after, TEAMS, teams, [
    createFinal("TEX", "NYM", [1, 2]),
    createFinal("CWS", "KC", [2, 5]),
  ]);
  assert.deepEqual(entry.via, [{ team: "CWS", won: false, opp: "KC", score: [2, 5] }]);
});

test("a division lead changes hands inside the field: one seed entry, the club that rose", () => {
  const now = { ...TEAMS, CWS: { league: "AL", seed: 2 }, CLE: { league: "AL", seed: 6 } };
  assert.deepEqual(
    findTableChanges(BEFORE, BEFORE, TEAMS, now, [createFinal("CWS", "KC", [9, 1])]),
    [
      {
        kind: "seed",
        team: "CWS",
        from: 6,
        to: 2,
        over: "CLE",
        via: [{ team: "CWS", won: true, opp: "KC", score: [9, 1] }],
      },
    ],
  );
});

test("a three-way shuffle names no one club as passed", () => {
  const now = {
    ...TEAMS,
    CWS: { league: "AL", seed: 4 },
    NYY: { league: "AL", seed: 5 },
    BOS: { league: "AL", seed: 6 },
  };
  assert.deepEqual(findTableChanges(BEFORE, BEFORE, TEAMS, now), [
    { kind: "seed", team: "CWS", from: 6, to: 4 },
  ]);
});

test("the official bracket: one lock entry, and no seed moves beside it", () => {
  const now = { ...TEAMS, CWS: { league: "AL", seed: 2 }, CLE: { league: "AL", seed: 6 } };
  assert.deepEqual(findTableChanges(BEFORE, BEFORE, TEAMS, now, [], false), [{ kind: "lock" }]);
});

test("an entry is logged when it was noticed", () => {
  const after = updateRow(BEFORE, "BAL", { wce: "E" });
  const games = [{ ...createFinal("CWS", "KC", [9, 1]), end: "2026-09-24T20:45:00Z" }];
  const [entry] = LogChanges.findChanges(
    { teams: TEAMS, projected: true, standings: buildTable(BEFORE) },
    { teams: TEAMS, projected: true, standings: buildTable(after), slate: { today: { games } } },
    NOW,
  );
  // Stamped now, not when the game ended: the reader may have dismissed the log since.
  assert.equal(entry.at, "2026-09-25T02:00:00Z");
  assert.deepEqual(entry.via, [{ team: "CWS", won: true, opp: "KC", score: [9, 1] }]);
  assert.equal(entry.ended, "2026-09-24T20:45:00Z");
});

test("a change two games made happened when the later one ended", () => {
  let after = updateRow(BEFORE, "TEX", { wcrank: "3", wcgb: "-", wce: "-" });
  after = updateRow(after, "CWS", { wcrank: "4", wcgb: "0.5", wce: "3" });
  const teams = { ...TEAMS, TEX: { league: "AL", seed: 6 } };
  delete teams.CWS;
  const games = [
    { ...createFinal("NYM", "TEX", [1, 3]), end: "2026-09-24T21:06:00Z" },
    { ...createFinal("CWS", "KC", [2, 5]), end: "2026-09-25T00:41:00Z" },
  ];
  const [entry] = LogChanges.findChanges(
    { teams: TEAMS, projected: true, standings: buildTable(BEFORE) },
    { teams, projected: true, standings: buildTable(after), slate: { today: { games } } },
    NOW,
  );
  assert.equal(entry.ended, "2026-09-25T00:41:00Z");
  assert.equal(entry.at, "2026-09-25T02:00:00Z");
});

test("the real snapshot of 24 September against itself, and against the night before", () => {
  const fixture = JSON.parse(
    readFileSync(`${import.meta.dirname}/fixtures/2026-09-24-evening.json`, "utf8"),
  );
  const snapshot = MLBSnapshot.buildSnapshot(fixture.responses, {
    season: 2026,
    now: Date.parse(fixture.now),
  });
  const stored = { teams: snapshot.teams, projected: true, standings: snapshot.standings };
  assert.deepEqual(LogChanges.findChanges(stored, snapshot, NOW), []);
  // The night before, Baltimore still had a wild card route.
  const earlier = JSON.parse(JSON.stringify(stored));
  earlier.standings.divisions["AL East"].find((row) => row.id === "BAL").wce = "1";
  const [entry, ...rest] = LogChanges.findChanges(earlier, snapshot, NOW);
  assert.equal(rest.length, 0);
  assert.deepEqual(
    { kind: entry.kind, team: entry.team, via: entry.via },
    { kind: "elim", team: "BAL", via: [{ team: "CWS", won: true, opp: "KC", score: [9, 1] }] },
  );
});

test("the log keeps each piece of news once, oldest first, the newest fifty", () => {
  const routineWrote = { at: "2026-09-24T23:20:00Z", kind: "elim", team: "BAL" };
  const pageFound = { at: "2026-09-24T23:21:00Z", kind: "elim", team: "BAL", via: [] };
  assert.deepEqual(LogChanges.mergeLog([routineWrote], [pageFound]), [routineWrote]);

  const createGameEntry = (gameNumber) => ({
    at: new Date(Date.UTC(2026, 9, 1, gameNumber)).toISOString(),
    kind: "game",
    series: "AL_WC1",
    game: gameNumber,
    won: "TB",
    score: [1, 0],
  });
  const merged = LogChanges.mergeLog(
    [],
    Array.from({ length: 60 }, (_, index) => createGameEntry(index)),
  );
  assert.equal(merged.length, LogChanges.MAX_LOG);
  assert.equal(merged[0].game, 10);
  assert.deepEqual(LogChanges.mergeLog(merged.slice().reverse(), []), merged);
});
