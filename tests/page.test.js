import { beforeEach, mock, test } from "node:test";
import assert from "node:assert/strict";
import { session } from "../page/js/session.js";
import { renderDivisionBlock, renderNextCell } from "../page/js/standings.js";
import { describeTeamStatus, seriesLabel } from "../page/js/bracket.js";
import { droughtLabel } from "../page/js/clubs.js";
import { describeRace } from "../page/js/race.js";
import { renderGameList } from "../page/js/games-view.js";
import { html } from "../page/js/html.js";
import { stampName } from "../page/js/stamp.js";
import { entryText } from "../page/js/updates.js";
import { normalizeSpaces, stripTags } from "./text.js";
import { EASTERN, useTimeZone } from "./time-zone.js";

// The expected times below are what a viewer in Eastern time sees.
useTimeZone(EASTERN);

function checkAt(isoTime, check) {
  mock.timers.enable({ apis: ["Date"], now: Date.parse(isoTime) });
  try {
    return check();
  } finally {
    mock.timers.reset();
  }
}

const RANK_CHIP = /<span class="rank-slot">.*?<\/span><\/span>/g;
const describeEntry = (entry) => stripTags(String(entryText(entry)).replace(RANK_CHIP, ""));

beforeEach(() => {
  session.state = { teams: {} };
  session.standings = null;
});

const NOON = "2026-09-24T16:00:00Z"; // Thursday, 12:00 PM ET

test("Next column: today, another day, home and away", () =>
  checkAt(NOON, () => {
    const renderCell = (next) => normalizeSpaces(renderNextCell({ next }));
    assert.equal(
      renderCell({ at: "2026-09-25T01:40:00Z", home: false, opp: "ATH" }),
      '<td class="next-cell">Today 9:40 @ ATH</td>',
    );
    assert.equal(
      renderCell({ at: "2026-09-25T23:05:00Z", home: true, opp: "NYY" }),
      '<td class="next-cell">Fri 7:05 vs NYY</td>',
    );
    assert.equal(renderCell(null), '<td class="next-cell"></td>');
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
  const describeFieldChange = (entry) => describeEntry({ kind: "field", ...entry });
  assert.equal(
    describeFieldChange({
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
    describeFieldChange({
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
    describeFieldChange({
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
    describeFieldChange({
      in: "TEX",
      out: "HOU",
      spot: "division",
      div: "AL West",
      outBack: "0.0",
      outAlive: true,
    }),
    "Rangers take the AL West lead from the Astros &mdash; Astros even, behind on the tiebreaker",
  );
  assert.equal(
    describeFieldChange({ in: "TEX", out: "HOU" }),
    "Rangers take the AL West lead from the Astros",
  );
  assert.equal(
    describeFieldChange({ in: "BAL", out: "TOR" }),
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
  const describeBerth = (entry) => describeEntry({ kind: "berth", ...entry });
  assert.equal(
    describeBerth({
      team: "CWS",
      what: "playoff",
      via: [{ team: "CWS", won: true, opp: "KC", score: [9, 1] }],
    }),
    "White Sox clinch a playoff spot &mdash; beat the Royals 9-1",
  );
  assert.equal(describeBerth({ team: "NYY", what: "wildcard" }), "Yankees clinch a wild card spot");
  assert.equal(
    describeBerth({ team: "TB", what: "division", div: "AL East" }),
    "Rays clinch the AL East",
  );
  assert.equal(describeBerth({ team: "TB", what: "bye" }), "Rays clinch a first-round bye");
});

test("Next column: a game that has started gives way to the one after it", () =>
  checkAt(NOON, () => {
    const renderCell = (row) => normalizeSpaces(renderNextCell(row));
    const today = { at: "2026-09-24T14:05:00Z", home: true, opp: "MIL" }; // 10:05 AM ET
    const friday = { at: "2026-09-25T17:05:00Z", home: false, opp: "BOS" };
    assert.equal(
      renderCell({ next: today, then: friday }),
      '<td class="next-cell">Fri 1:05 @ BOS</td>',
    );
    assert.equal(renderCell({ next: today }), '<td class="next-cell"></td>');
  }));

test("division header: a magic number only when there is a number", () => {
  const renderHead = (leader) =>
    String(renderDivisionBlock("AL Central", [{ id: "CLE", lead: true, ...leader }]));
  assert.match(renderHead({ magic: "3" }), /magic 3/);
  assert.doesNotMatch(renderHead({ magic: "-" }), /magic/);
  assert.doesNotMatch(renderHead({ magic: null }), /magic/);
  assert.match(renderHead({ clinched: true, magic: "3" }), /clinched/);
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
    html`<span>${stampName(markup)}</span>`,
  ];
  for (const rendered of shown) assert.doesNotMatch(String(rendered), /<img/);
});

test("html escapes every value except markup it built", () => {
  const club = html`<b>${"Red Sox & Co."}</b>`;
  assert.equal(String(club), "<b>Red Sox &amp; Co.</b>");
  assert.equal(
    String(html`<li>${club} ${'"quoted" <tag>'}</li>`),
    "<li><b>Red Sox &amp; Co.</b> &quot;quoted&quot; &lt;tag&gt;</li>",
  );
  assert.equal(String(html`<ul>${["<a>", html`<i>b</i>`]}</ul>`), "<ul>&lt;a&gt;<i>b</i></ul>");
  assert.equal(String(html`[${false}${null}${undefined}${0}]`), "[0]");
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

// One line of text per game, with a space wherever a tag was.
const describeGameList = (slate, list) =>
  String(renderGameList(slate, list))
    .split(/<li|<h3/)
    .map((part) =>
      normalizeSpaces(part.replace(/<[^>]*>|^[^>]*>/g, " "))
        .replace(/\s+/g, " ")
        .trim(),
    )
    .filter(Boolean);

test("games list: live halves, a doubleheader in game order, a postponement, an unknown opponent", () => {
  const slate = {
    today: {
      date: "2026-09-25",
      games: [
        {
          away: "BAL",
          home: "NYY",
          state: "pre",
          start: "2026-09-25T20:10:00Z",
          tbd: true,
          doubleheader: 2,
        },
        {
          away: "BAL",
          home: "NYY",
          state: "final",
          start: "2026-09-25T17:05:00Z",
          score: [4, 2],
          doubleheader: 1,
        },
        {
          away: "CLE",
          home: "BOS",
          state: "live",
          start: "2026-09-25T22:45:00Z",
          score: [1, 0],
          inning: 7,
          half: "bottom",
        },
      ],
      postponed: [
        {
          away: "TOR",
          home: "BAL",
          state: "off",
          start: "2026-09-25T22:35:00Z",
          detail: "Postponed",
        },
      ],
    },
    next: [
      { date: "2026-10-03", away: null, home: "TB", state: "pre", start: "2026-10-03T17:08:00Z" },
    ],
  };
  assert.deepEqual(describeGameList(slate, "today"), [
    "Fri, Sep 25",
    "Orioles 4 - 2 Final Game 1 Yankees",
    "Orioles After Game 1 Game 2 Yankees",
    "Blue Jays Postponed Orioles",
    "Guardians 1 - 0 Bot 7th Red Sox",
  ]);
  assert.deepEqual(describeGameList(slate, "next"), ["Sat, Oct 3", "TBD 1:08 PM Rays"]);
  assert.deepEqual(describeGameList(slate, "previous"), ["No earlier games this season."]);
});

test("games list: a delay shows under the start time or the score", () => {
  const slate = {
    today: {
      date: "2026-09-27",
      games: [
        {
          away: "BAL",
          home: "NYY",
          state: "pre",
          start: "2026-09-27T17:05:00Z",
          delay: "Delayed: Rain",
        },
        {
          away: "TB",
          home: "PHI",
          state: "live",
          start: "2026-09-27T17:35:00Z",
          score: [0, 4],
          inning: 3,
          half: "bottom",
          delay: "Delayed",
        },
      ],
    },
  };
  assert.deepEqual(describeGameList(slate, "today"), [
    "Sun, Sep 27",
    "Orioles 1:05 PM Delayed: Rain Yankees",
    "Rays 0 - 4 Delayed Phillies",
  ]);
  assert.match(String(renderGameList(slate, "today")), /class="game-row pre delayed"/);
});

test("games list: each club's rank, seed, record, and race", () => {
  session.state = { teams: { NYY: { league: "AL", seed: 4 } }, ranking: ["NYY"] };
  session.standings = {
    divisions: {
      "AL East": [
        {
          id: "NYY",
          w: 93,
          l: 68,
          gb: "5.0",
          wcgb: "+10.0",
          elim: "E",
          wce: "-",
          clinch: "w",
          wcrank: "1",
        },
        { id: "BAL", w: 79, l: 82, gb: "19.0", wcgb: "4.0", elim: "E", wce: "E", wcrank: "5" },
      ],
    },
  };
  const slate = {
    today: {
      date: "2026-09-26",
      games: [
        { away: "BAL", home: "NYY", state: "final", start: "2026-09-26T17:05:00Z", score: [3, 7] },
      ],
    },
  };
  assert.deepEqual(describeGameList(slate, "today"), [
    "Sat, Sep 26",
    "Orioles 79-82 3 - 7 Final Yankees #1 4 seed 93-68 WC1",
  ]);
});

test("a club's race: clinched, still racing, or out", () => {
  const describe = (row) => describeRace({ gb: "-", wcgb: "-", elim: "-", wce: "-", ...row });
  assert.deepEqual(describe({ clinch: "z", clinched: true, lead: true }), {
    label: "Bye",
    standing: "clinched",
  });
  assert.equal(describe({ clinch: "y", clinched: true, lead: true }).label, "Div");
  assert.equal(describe({ gb: "6.5", elim: "E", clinch: "y", wcrank: "3" }).label, "In");
  assert.equal(
    describe({ gb: "5.0", wcgb: "+10.0", elim: "E", clinch: "w", wcrank: "1" }).label,
    "WC1",
  );
  assert.deepEqual(describe({ lead: true, magic: "2" }), { label: "M#2", standing: "racing" });
  assert.equal(describe({ lead: true }).label, "1st");
  assert.equal(describe({ wcgb: "3.0", wce: "E" }).label, "Tied");
  assert.equal(describe({ gb: "3.5", elim: "12" }).label, "3.5 GB");
  assert.equal(describe({ gb: "7.0", elim: "E", wcrank: "3" }).label, "WC3");
  assert.equal(describe({ gb: "9.0", wcgb: "+1.0", elim: "E", wcrank: "2" }).label, "WC2");
  assert.deepEqual(describe({ gb: "13.0", wcgb: "1.0", elim: "E", wce: "1" }), {
    label: "1.0 WC",
    standing: "racing",
  });
  assert.deepEqual(describe({ gb: "19.0", wcgb: "4.0", elim: "E", wce: "E" }), {
    label: null,
    standing: "out",
  });
  assert.equal(describeRace(null), null);
});

test("games list: a season with no live data says why", () => {
  const { activeYear, currentSeason } = session;
  try {
    session.currentSeason = 2026;
    session.activeYear = 2025;
    assert.deepEqual(describeGameList(null, "today"), ["Games show for the current season only."]);
    session.activeYear = 2026;
    assert.deepEqual(describeGameList(null, "today"), [
      "Games appear here as soon as the page can reach MLB.",
    ]);
  } finally {
    Object.assign(session, { activeYear, currentSeason });
  }
});
