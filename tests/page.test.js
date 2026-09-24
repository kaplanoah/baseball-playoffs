/* Smaller pure helpers the page leans on: the Next column in the standings,
   the day words in the stamp, and the update log's sentences. */
const test = require("node:test");
const assert = require("node:assert/strict");
const { loadPage, plain } = require("./load");

const page = loadPage(["teams.js", "bracket.js", "updates.js", "stamp.js", "standings.js"]);
const run = (code, vars) => plain(page.run(code, vars));

// A fixed "now" so Today / Fri come out the same on every run.
const withNow = (iso, fn) => {
  const RealDate = Date;
  const fixed = new RealDate(iso).getTime();
  class FakeDate extends RealDate {
    constructor(...a){ super(...(a.length ? a : [fixed])); }
    static now(){ return fixed; }
  }
  page.run("0", { Date: FakeDate });
  try { return fn(); } finally { page.run("0", { Date: RealDate }); }
};
const NOON = "2026-09-24T16:00:00Z"; // Thursday, 12:00 PM ET

test("Next column: today, another day, home and away", () => withNow(NOON, () => {
  const cell = next => run("nextCell(T)", { T: { next } });
  assert.equal(cell({ at: "2026-09-25T01:40:00Z", home: false, opp: "ATH" }), '<td class="next-cell">Today 9:40 @ ATH</td>');
  assert.equal(cell({ at: "2026-09-25T23:05:00Z", home: true, opp: "NYY" }), '<td class="next-cell">Fri 7:05 vs NYY</td>');
  assert.equal(cell(null), '<td class="next-cell"></td>');
}));

test("stamp day words: yesterday, tomorrow, a weekday", () => withNow(NOON, () => {
  const when = iso => run("stampWhen(new Date(I))", { I: iso });
  assert.equal(when("2026-09-24T17:15:00Z"), "1:15 PM");
  assert.equal(when("2026-09-23T17:15:00Z"), "yesterday 1:15 PM");
  assert.equal(when("2026-09-25T17:15:00Z"), "tomorrow 1:15 PM");
  assert.equal(when("2026-09-27T17:15:00Z"), "Sunday 1:15 PM");
}));

test("update log: a seed pass, with the game behind it", () => {
  // logChip adds rank chips and team tags, which need the page; here only the words matter.
  const name = id => page.run(`TEAMS["${id}"].name`);
  page.run("0", { logChip: name, teamLabel: name });
  const text = run("entryText(E)", { E: {
    kind: "seed", team: "SD", over: "PHI", to: 5, from: 6,
    via: [{ team: "PHI", won: false, opp: "MIL", score: [1, 4] }]
  } });
  assert.equal(text, "Padres passed the Phillies for the NL 5 seed &mdash; Phillies lost to the Brewers 4-1");
});

test("series names", () => {
  assert.equal(run("seriesLabel('NL_DS2')"), "NLDS");
  assert.equal(run("seriesLabel('AL_WC1')"), "AL Wild Card Series");
  assert.equal(run("seriesLabel('WS')"), "World Series");
});
