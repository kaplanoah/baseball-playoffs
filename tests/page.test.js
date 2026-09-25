const test = require("node:test");
const assert = require("node:assert/strict");
const { loadPage, plain } = require("./load");

const page = loadPage(["teams.js", "bracket.js", "updates.js", "stamp.js", "standings.js"]);
const run = (code, vars) => plain(page.run(code, vars));

const withNow = (iso, fn) => {
  const RealDate = Date;
  const fixed = new RealDate(iso).getTime();
  class FakeDate extends RealDate {
    constructor(...a) {
      super(...(a.length ? a : [fixed]));
    }
    static now() {
      return fixed;
    }
  }
  page.run("0", { Date: FakeDate });
  try {
    return fn();
  } finally {
    page.run("0", { Date: RealDate });
  }
};
const NOON = "2026-09-24T16:00:00Z"; // Thursday, 12:00 PM ET

test("Next column: today, another day, home and away", () =>
  withNow(NOON, () => {
    const cell = (next) => run("nextCell(T)", { T: { next } });
    assert.equal(
      cell({ at: "2026-09-25T01:40:00Z", home: false, opp: "ATH" }),
      '<td class="next-cell">Today 9:40 @ ATH</td>',
    );
    assert.equal(
      cell({ at: "2026-09-25T23:05:00Z", home: true, opp: "NYY" }),
      '<td class="next-cell">Fri 7:05 vs NYY</td>',
    );
    assert.equal(cell(null), '<td class="next-cell"></td>');
  }));

test("update log: a seed pass, with the game behind it", () => {
  // The real logChip and teamLabel need the full page.
  const name = (id) => page.run(`TEAMS["${id}"].name`);
  page.run("0", { logChip: name, teamLabel: name });
  const text = run("entryText(E)", {
    E: {
      kind: "seed",
      team: "SD",
      over: "PHI",
      to: 5,
      from: 6,
      via: [{ team: "PHI", won: false, opp: "MIL", score: [1, 4] }],
    },
  });
  assert.equal(
    text,
    "Padres passed the Phillies for the NL 5 seed &mdash; Phillies lost to the Brewers 4-1",
  );
});

test("series names", () => {
  assert.equal(run("seriesLabel('NL_DS2')"), "NLDS");
  assert.equal(run("seriesLabel('AL_WC1')"), "AL Wild Card Series");
  assert.equal(run("seriesLabel('WS')"), "World Series");
});

test("update log: a field change names the spot and how far back the club that dropped out is", () => {
  const name = (id) => page.run(`TEAMS["${id}"].name`);
  page.run("0", {
    logChip: name,
    teamLabel: name,
    state: { teams: { TEX: { seed: 3 }, BAL: { seed: 5 } } },
    standings: {
      divisions: { "AL West": [{ id: "TEX" }, { id: "HOU" }], "AL East": [{ id: "BAL" }] },
    },
  });
  const say = (e) => run("entryText(E)", { E: { kind: "field", ...e } });
  assert.equal(
    say({
      in: "TEX",
      out: "HOU",
      spot: "division",
      div: "AL West",
      outBack: "0.5",
      outAlive: true,
    }),
    "Rangers take the AL West lead from the Astros &mdash; Astros ½ game back",
  );
  assert.equal(
    say({
      in: "DET",
      out: "BAL",
      spot: "wildcard",
      outBack: "2.0",
      outAlive: true,
      via: [{ team: "DET", won: true, opp: "KC", score: [5, 3] }],
    }),
    "Tigers take an AL wild card spot from the Orioles &mdash; beat the Royals 5-3, Orioles 2 games back",
  );
  // Out altogether: its own "eliminated" entry says so.
  assert.equal(
    say({
      in: "TEX",
      out: "HOU",
      spot: "division",
      div: "AL West",
      outBack: "0.5",
      outAlive: false,
    }),
    "Rangers take the AL West lead from the Astros",
  );
  assert.equal(
    say({
      in: "TEX",
      out: "HOU",
      spot: "division",
      div: "AL West",
      outBack: "0.0",
      outAlive: true,
    }),
    "Rangers take the AL West lead from the Astros &mdash; Astros even, behind on the tiebreaker",
  );
  assert.equal(say({ in: "TEX", out: "HOU" }), "Rangers take the AL West lead from the Astros");
  assert.equal(
    say({ in: "BAL", out: "TOR" }),
    "Orioles take an AL wild card spot from the Blue Jays",
  );
});

test("update log: an elimination is plain words", () => {
  page.run("0", { logChip: (id) => page.run(`TEAMS["${id}"].name`) });
  assert.equal(run("entryText(E)", { E: { kind: "elim", team: "BAL" } }), "Orioles eliminated");
  assert.equal(
    run("entryText(E)", {
      E: { kind: "elim", team: "BAL", via: [{ team: "CWS", won: true, opp: "KC", score: [9, 1] }] },
    }),
    "Orioles eliminated &mdash; White Sox beat the Royals 9-1",
  );
  assert.equal(
    run("entryText(E)", {
      E: {
        kind: "elim",
        team: "BAL",
        via: [
          { team: "BAL", won: false, opp: "NYY", score: [2, 4] },
          { team: "CWS", won: true, opp: "KC", score: [9, 1] },
        ],
      },
    }),
    "Orioles eliminated &mdash; lost to the Yankees 4-2 and White Sox beat the Royals 9-1",
  );
});

test("update log: clinches", () => {
  page.run("0", { logChip: (id) => page.run(`TEAMS["${id}"].name`) });
  const say = (e) => run("entryText(E)", { E: { kind: "berth", ...e } });
  assert.equal(
    say({
      team: "CWS",
      what: "playoff",
      via: [{ team: "CWS", won: true, opp: "KC", score: [9, 1] }],
    }),
    "White Sox clinch a playoff spot &mdash; beat the Royals 9-1",
  );
  assert.equal(say({ team: "NYY", what: "wildcard" }), "Yankees clinch a wild card spot");
  assert.equal(say({ team: "TB", what: "division", div: "AL East" }), "Rays clinch the AL East");
  assert.equal(say({ team: "TB", what: "bye" }), "Rays clinch a first-round bye");
});

test("Next column: a game that has started gives way to the one after it", () =>
  withNow(NOON, () => {
    const cell = (t) => run("nextCell(T)", { T: t });
    const today = { at: "2026-09-24T14:05:00Z", home: true, opp: "MIL" }; // 10:05 AM ET
    const fri = { at: "2026-09-25T17:05:00Z", home: false, opp: "BOS" };
    assert.equal(cell({ next: today, then: fri }), '<td class="next-cell">Fri 1:05 @ BOS</td>');
    assert.equal(cell({ next: today }), '<td class="next-cell"></td>');
  }));

test("division header: a magic number only when there is a number", () => {
  page.run("0", { rankTag: () => "", teamTag: (id) => id, state: { teams: {} } });
  const head = (leader) =>
    run("divisionBlock('AL Central', R)", { R: [{ id: "CLE", lead: true, ...leader }] });
  assert.match(head({ magic: "3" }), /magic 3/);
  assert.doesNotMatch(head({ magic: "-" }), /magic/);
  assert.doesNotMatch(head({ magic: null }), /magic/);
  assert.match(head({ clinched: true, magic: "3" }), /clinched/);
});
