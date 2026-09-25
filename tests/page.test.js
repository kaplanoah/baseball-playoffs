import { beforeEach, mock, test } from "node:test";
import assert from "node:assert/strict";
import { session } from "../page/js/session.js";
import { renderDivisionBlock, renderNextCell } from "../page/js/standings.js";
import { describeTeamStatus, seriesLabel } from "../page/js/bracket.js";
import { droughtLabel } from "../page/js/clubs.js";
import { stampName } from "../page/js/stamp.js";
import { entryText } from "../page/js/updates.js";
import { normalizeSpaces, stripTags } from "./text.js";

function withNow(iso, check) {
  mock.timers.enable({ apis: ["Date"], now: Date.parse(iso) });
  try {
    return check();
  } finally {
    mock.timers.reset();
  }
}

const RANK_CHIP = /<span class="rank-slot">.*?<\/span><\/span>/g;
const describeEntry = (entry) => stripTags(entryText(entry).replace(RANK_CHIP, ""));

beforeEach(() => {
  session.state = { teams: {} };
  session.standings = null;
});

const NOON = "2026-09-24T16:00:00Z"; // Thursday, 12:00 PM ET

test("Next column: today, another day, home and away", () =>
  withNow(NOON, () => {
    const cell = (next) => normalizeSpaces(renderNextCell({ next }));
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
  const text = describeEntry({
    kind: "seed",
    team: "SD",
    over: "PHI",
    to: 5,
    from: 6,
    via: [{ team: "PHI", won: false, opp: "MIL", score: [1, 4] }],
  });
  assert.equal(
    text,
    "Padres passed the Phillies for the NL 5 seed &mdash; Phillies lost to the Brewers 4-1",
  );
});

test("series names", () => {
  assert.equal(seriesLabel("NL_DS2"), "NLDS");
  assert.equal(seriesLabel("AL_WC1"), "AL Wild Card Series");
  assert.equal(seriesLabel("WS"), "World Series");
});

test("update log: a field change names the spot and how far back the club that dropped out is", () => {
  session.state = { teams: { TEX: { seed: 3 }, BAL: { seed: 5 } } };
  session.standings = {
    divisions: { "AL West": [{ id: "TEX" }, { id: "HOU" }], "AL East": [{ id: "BAL" }] },
  };
  const say = (entry) => describeEntry({ kind: "field", ...entry });
  assert.equal(
    say({
      in: "TEX",
      out: "HOU",
      spot: "division",
      div: "AL West",
      outBack: "0.5",
      outAlive: true,
    }),
    "Rangers take the AL West lead from the Astros &mdash; Astros \u00bd game back",
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
  assert.equal(describeEntry({ kind: "elim", team: "BAL" }), "Orioles eliminated");
  assert.equal(
    describeEntry({
      kind: "elim",
      team: "BAL",
      via: [{ team: "CWS", won: true, opp: "KC", score: [9, 1] }],
    }),
    "Orioles eliminated &mdash; White Sox beat the Royals 9-1",
  );
  assert.equal(
    describeEntry({
      kind: "elim",
      team: "BAL",
      via: [
        { team: "BAL", won: false, opp: "NYY", score: [2, 4] },
        { team: "CWS", won: true, opp: "KC", score: [9, 1] },
      ],
    }),
    "Orioles eliminated &mdash; lost to the Yankees 4-2 and White Sox beat the Royals 9-1",
  );
});

test("update log: clinches", () => {
  const say = (entry) => describeEntry({ kind: "berth", ...entry });
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
    const cell = (row) => normalizeSpaces(renderNextCell(row));
    const today = { at: "2026-09-24T14:05:00Z", home: true, opp: "MIL" }; // 10:05 AM ET
    const fri = { at: "2026-09-25T17:05:00Z", home: false, opp: "BOS" };
    assert.equal(cell({ next: today, then: fri }), '<td class="next-cell">Fri 1:05 @ BOS</td>');
    assert.equal(cell({ next: today }), '<td class="next-cell"></td>');
  }));

test("division header: a magic number only when there is a number", () => {
  const head = (leader) =>
    renderDivisionBlock("AL Central", [{ id: "CLE", lead: true, ...leader }]);
  assert.match(head({ magic: "3" }), /magic 3/);
  assert.doesNotMatch(head({ magic: "-" }), /magic/);
  assert.doesNotMatch(head({ magic: null }), /magic/);
  assert.match(head({ clinched: true, magic: "3" }), /clinched/);
});

test("text from the shared store or MLB is shown as text, never as markup", () => {
  const markup = '<img src=x onerror="alert(1)">';
  const shown = [
    entryText({ kind: "berth", team: "NYY", what: "division", div: markup }),
    entryText({ kind: "game", won: "NYY", series: markup, game: markup, score: [markup, 1] }),
    entryText({ kind: "seed", team: "NYY", from: markup, to: markup }),
    entryText({ kind: "unknown", text: markup }),
    renderNextCell({ next: { at: "2026-09-25T23:05:00Z", home: true, opp: markup } }),
    renderDivisionBlock("AL East", [{ id: "NYY", w: markup, l: 1, pct: markup, gb: markup }]),
    stampName(markup),
  ];
  for (const html of shown) assert.doesNotMatch(html, /<img/);
});

test("a club that has never won counts its drought from its first season", () => {
  session.trackedTitles = {};
  assert.equal(droughtLabel("TB"), "Since 1998");
  assert.equal(droughtLabel("COL"), "Since 1993");
  assert.equal(droughtLabel("MIL"), "Since 1969");
});

test("a club's status names the round it went out in", () => {
  const teams = {};
  const clubs = {
    AL: ["NYY", "TOR", "SEA", "BOS", "DET", "CLE"],
    NL: ["LAD", "MIL", "PHI", "CHC", "SD", "CIN"],
  };
  for (const [league, ids] of Object.entries(clubs))
    ids.forEach((id, index) => (teams[id] = { league, seed: index + 1 }));
  const state = {
    teams,
    series: { AL_WC2: { winsA: 2, winsB: 0 }, AL_DS1: { winsA: 1, winsB: 3 } },
  };
  assert.deepEqual(describeTeamStatus(state, "DET"), { status: "out", round: "WC" });
  assert.deepEqual(describeTeamStatus(state, "NYY"), { status: "out", round: "DS" });
  assert.deepEqual(describeTeamStatus(state, "BOS"), { status: "alive", round: null });
});
