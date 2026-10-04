import { beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { session } from "../page/js/session.js";
import { renderTeamSheet } from "../page/js/team-view.js";
import { TEAMS } from "../page/js/teams.js";
import { stripTags } from "../../../tests/text.js";
import { EASTERN, useTimeZone } from "../../../tests/time-zone.js";

// The expected times below are what a viewer in Eastern time sees.
useTimeZone(EASTERN);

const SEPTEMBER_NOON = Date.parse("2026-09-16T16:00:00Z");
const OCTOBER_NOON = Date.parse("2026-10-08T16:00:00Z");

// A sheet's markup as it reads, its pieces apart, each separator a bar, and runs of space one.
const readText = (markup) =>
  String(markup)
    .replace(/<[^>]+>/g, " ")
    .replace(/&bull;/g, "|")
    .replace(/&mdash;/g, "-")
    .replace(/\s+/g, " ")
    .trim();

const readStats = (markup) =>
  [
    ...markup.text.matchAll(/<span class="team-label">(.*?)<\/span><b class="tabular">(.*?)<\/b>/g),
  ].map(([, label, value]) => `${stripTags(label)} ${readText(value)}`);

const listParts = (markup) =>
  [...markup.text.matchAll(/<h3>(.*?)<\/h3>/g)].map(([, title]) => title);

// The text of one titled part, from its title to the next part's.
const readPart = (markup, title) =>
  readText(markup).match(new RegExp(`${title} (.*?)(?= (?:Playoffs|Season|Titles) |$)`))?.[1];

const row = (id, w, l, fields = {}) => ({
  id,
  w,
  l,
  pct: (w / (w + l)).toFixed(3).slice(1),
  ...fields,
});

const NL_FIELD = {
  LAD: { league: "NL", seed: 2 },
  PHI: { league: "NL", seed: 1 },
  CHC: { league: "NL", seed: 5 },
  SD: { league: "NL", seed: 4 },
  MIL: { league: "NL", seed: 3 },
  NYM: { league: "NL", seed: 6 },
};

beforeEach(() => {
  Object.assign(session, {
    currentSeason: 2026,
    activeYear: 2026,
    trackedTitles: {},
    state: { teams: NL_FIELD, series: {}, projected: true, ranking: ["CHC", "PHI", "LAD"] },
    standings: null,
  });
});

const NL_WEST_IN_SEPTEMBER = {
  divisions: {
    "NL West": [
      row("LAD", 89, 61, {
        gb: "-",
        elim: "-",
        lead: true,
        magic: "7",

        next: { at: "2026-09-16T23:10:00Z", home: true, opp: "SD" },
      }),
      row("SD", 83, 67, { gb: "6.0", elim: "7", wcgb: "+2.0", wce: "-", wcrank: "1" }),
    ],
  },
};

test("a division leader in September: its division, seed, record, and percentage, its place, lead, and magic number, its next game, and every title", () => {
  session.standings = NL_WEST_IN_SEPTEMBER;
  const sheet = renderTeamSheet("LAD", { now: SEPTEMBER_NOON });

  assert.equal(readText(sheet.heading), "Dodgers #3");
  assert.equal(readText(sheet.note), "NL West | 2 seed | 89-61 | .593");
  assert.deepEqual(listParts(sheet.body), ["Season", "Titles"]);
  assert.deepEqual(readStats(sheet.body), ["NL West 1st", "Lead +6.0", "M# 7"]);
  assert.match(readPart(sheet.body, "Season"), /^12 left .* Next Today 7:10 vs SD$/);
  assert.equal(readPart(sheet.body, "Titles"), "Defending 9 | 2025, 2024, 2020 and 6 more");
});

test("a club chasing a wild card has a row for each race, each starting with its place, and a club that never won says so", () => {
  session.state.teams = {};
  session.standings = {
    divisions: {
      "AL West": [
        row("HOU", 86, 64, { gb: "-", elim: "-", lead: true, magic: "9" }),
        row("SEA", 81, 69, { gb: "4.5", elim: "8", wcgb: "1.0", wce: "12", wcrank: "4" }),
      ],
    },
  };
  const sheet = renderTeamSheet("SEA", { now: SEPTEMBER_NOON });

  assert.equal(readText(sheet.heading), "Mariners");
  assert.equal(readText(sheet.note), "AL West | 81-69 | .540");
  assert.deepEqual(readStats(sheet.body), [
    "AL West 2nd",
    "GB 4.5",
    "E# 8",
    "Wild card 4th",
    "WCGB 1.0",
    "WCE 12",
  ]);
  assert.equal(readPart(sheet.body, "Titles"), "Since 1977 None yet");
});

test("a race number shows in copper while it counts down, as a gold dash once clinched, and as E once out", () => {
  session.standings = {
    divisions: {
      "AL West": [
        row("HOU", 86, 64, { gb: "-", elim: "-", lead: true, clinched: true }),
        row("SEA", 81, 69, { gb: "4.5", elim: "E", wcgb: "1.0", wce: "12", wcrank: "4" }),
      ],
    },
  };
  const leader = renderTeamSheet("HOU", { now: SEPTEMBER_NOON }).body.text;
  const chaser = renderTeamSheet("SEA", { now: SEPTEMBER_NOON }).body.text;

  assert.match(leader, /<span class="elim-num clinched">&mdash;<\/span>/);
  assert.match(chaser, /<span class="elim-num">E<\/span>/);
  assert.match(chaser, /<span class="elim-num live">12<\/span>/);
});

test("once the season is over, the Season part counts no games left", () => {
  session.standings = {
    divisions: {
      "NL Central": [
        row("MIL", 95, 67, { gb: "-", elim: "-", lead: true, clinched: true }),
        row("CHC", 91, 71, { gb: "4.0", elim: "E", wcgb: "+2.0", wce: "-", wcrank: "1" }),
      ],
    },
  };
  const leader = renderTeamSheet("MIL", { now: OCTOBER_NOON }).body;

  assert.deepEqual(readStats(leader), ["NL Central 1st", "Lead +4.0", "M# -"]);
  assert.doesNotMatch(readPart(leader, "Season"), /left/);
});

test("once the field is set, a game rained out and never made up counts as none left", () => {
  session.state = { ...session.state, projected: false };
  session.standings = {
    divisions: {
      "NL East": [
        row("PHI", 97, 64, { gb: "-", elim: "-", lead: true, clinched: true }),
        row("NYM", 87, 75, { gb: "9.5", elim: "E", wcgb: "-", wce: "-", wcrank: "3" }),
      ],
    },
  };
  const sheet = renderTeamSheet("PHI", { now: OCTOBER_NOON }).body;

  assert.doesNotMatch(readPart(sheet, "Season"), /left/);
});

const NL_CENTRAL_IN_OCTOBER = {
  divisions: {
    "NL Central": [
      row("MIL", 95, 67, { gb: "-", elim: "-", lead: true, clinched: true }),
      row("CHC", 91, 71, {
        gb: "4.0",
        elim: "E",
        wcgb: "+2.0",
        wce: "-",
        wcrank: "1",

        next: { at: "2026-10-08T21:08:00Z", home: false, opp: "PHI", postseason: true },
      }),
    ],
  },
};

test("once the field is set, a club alive in the postseason shows it first, with how each series stands and its next game", () => {
  session.state = {
    ...session.state,
    projected: false,
    series: {
      NL_WC2: { winsA: 1, winsB: 2, started: true },
      NL_DS1: { winsA: 1, winsB: 2, started: true },
    },
  };
  session.standings = NL_CENTRAL_IN_OCTOBER;
  const sheet = renderTeamSheet("CHC", { now: OCTOBER_NOON });

  assert.deepEqual(listParts(sheet.body), ["Playoffs", "Season", "Titles"]);
  assert.equal(
    readPart(sheet.body, "Playoffs"),
    "Alive NL WC Padres Won 2-1 NLDS Phillies Lead 2-1 Next Today 5:08 @ PHI",
  );
  assert.doesNotMatch(readPart(sheet.body, "Season"), /Next/);
  assert.match(sheet.body.text, /<button type="button" class="club team-open" data-team="SD"/);
});

test("a club with a bye shows it, and a series still to start shows no games", () => {
  session.state = { ...session.state, projected: false };
  const playoffs = readPart(renderTeamSheet("LAD", { now: OCTOBER_NOON }).body, "Playoffs");

  assert.equal(playoffs, "Alive NL WC Bye NLDS TBD 0-0");
});

test("a club knocked out says how its series ended, with no next game", () => {
  session.state = {
    ...session.state,
    projected: false,
    series: { NL_WC1: { winsA: 2, winsB: 1, started: true } },
  };
  session.standings = {
    divisions: {
      "NL East": [
        row("PHI", 97, 65, { gb: "-", elim: "-", lead: true, clinched: true }),
        row("NYM", 87, 75, {
          gb: "10.0",
          elim: "E",
          wcgb: "-",
          wce: "-",
          wcrank: "3",

          next: { at: "2026-10-09T21:08:00Z", home: true, opp: "PHI", postseason: true },
        }),
      ],
    },
  };
  const playoffs = readPart(renderTeamSheet("NYM", { now: OCTOBER_NOON }).body, "Playoffs");

  assert.equal(playoffs, "Out NL WC Brewers Lost 1-2");
});

test("a series tied or trailing says so, and a club still in a projected field shows no postseason", () => {
  session.state = {
    ...session.state,
    projected: false,
    series: {
      NL_WC1: { winsA: 1, winsB: 1, started: true },
      NL_WC2: { winsA: 0, winsB: 1, started: true },
    },
  };
  assert.match(readText(renderTeamSheet("MIL", { now: OCTOBER_NOON }).body), /NL WC Mets Tied 1-1/);
  assert.match(readText(renderTeamSheet("SD", { now: OCTOBER_NOON }).body), /NL WC Cubs Trail 0-1/);
  session.state.projected = true;
  assert.deepEqual(listParts(renderTeamSheet("SD", { now: OCTOBER_NOON }).body), ["Titles"]);
});

test("a club the standings don't list yet still shows its league and its titles", () => {
  const sheet = renderTeamSheet("COL", { now: SEPTEMBER_NOON });

  assert.equal(readText(sheet.note), "NL");
  assert.deepEqual(listParts(sheet.body), ["Titles"]);
  assert.equal(readPart(sheet.body, "Titles"), "Since 1993 None yet");
});

test("a season the store tracked adds its champion's title, whether the page kept one year or a list", () => {
  session.currentSeason = 2028;
  session.trackedTitles = { SEA: [2026, 2027] };
  assert.equal(readPart(renderTeamSheet("SEA").body, "Titles"), "Defending 2 | 2027, 2026");
  session.trackedTitles = { SEA: 2027 };
  assert.equal(readPart(renderTeamSheet("SEA").body, "Titles"), "Defending 1 | 2027");
});

test("every World Series since the first, but for 1904 and 1994, has one champion", () => {
  const champions = Object.values(TEAMS)
    .flatMap((team) => team.titles)
    .sort((first, second) => first - second);
  const played = Array.from({ length: 2025 - 1903 + 1 }, (_, index) => 1903 + index).filter(
    (year) => year !== 1904 && year !== 1994,
  );

  assert.deepEqual(champions, played);
});
