import { beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { session } from "../page/js/session.js";
import { renderTeamSheet } from "../page/js/team-view.js";
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
    trackedTitles: { LAD: 2025 },
    state: { teams: NL_FIELD, series: {}, projected: true, ranking: ["CHC", "PHI", "LAD"] },
    standings: null,
  });
});

test("a division leader in September: its division, seed, and record, its lead and magic number, its next game, and its titles", () => {
  session.standings = {
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
  const sheet = renderTeamSheet("LAD", { now: SEPTEMBER_NOON });

  assert.equal(readText(sheet.heading), "Dodgers #3");
  assert.equal(readText(sheet.note), "NL West | 2 seed | 89-61");
  assert.deepEqual(readStats(sheet.body), ["PCT .593", "Lead +6.0", "M# 7"]);
  assert.match(readText(sheet.body), /^Season 12 left/);
  assert.match(readText(sheet.body), /Next Today 7:10 vs SD/);
  assert.match(readText(sheet.body), /Titles Last WS 2025 \| Defending/);
  assert.doesNotMatch(sheet.body.text, /Playoffs/);
});

test("a club chasing a wild card shows its division race and its wild card race, and a drought since its first season", () => {
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
  assert.equal(readText(sheet.note), "AL West | 81-69");
  assert.deepEqual(readStats(sheet.body), [
    "PCT .540",
    "GB 4.5",
    "E# 8",
    "WC 4th",
    "WCGB 1.0",
    "WCE 12",
  ]);
  assert.match(readText(sheet.body), /Titles Never won WS \| Since 1977/);
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

test("once the season is over, the grid keeps only where the club finished, with no games left", () => {
  session.standings = {
    divisions: {
      "NL Central": [
        row("MIL", 95, 67, { gb: "-", elim: "-", lead: true, clinched: true }),
        row("CHC", 91, 71, { gb: "4.0", elim: "E", wcgb: "+2.0", wce: "-", wcrank: "1" }),
      ],
    },
  };
  const chaser = renderTeamSheet("CHC", { now: OCTOBER_NOON }).body;
  const leader = renderTeamSheet("MIL", { now: OCTOBER_NOON }).body;

  assert.deepEqual(readStats(chaser), ["PCT .562", "GB 4.0", "WCGB +2.0"]);
  assert.deepEqual(readStats(leader), ["PCT .586", "Lead +4.0"]);
  assert.doesNotMatch(readText(chaser), /left/);
});

test("once the field is set, a club alive in the postseason lists its series, how each stands, and its next game", () => {
  session.state = {
    ...session.state,
    projected: false,
    series: {
      NL_WC2: { winsA: 1, winsB: 2, started: true },
      NL_DS1: { winsA: 1, winsB: 2, started: true },
    },
  };
  session.standings = {
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
  const sheet = renderTeamSheet("CHC", { now: OCTOBER_NOON });
  const text = readText(sheet.body);

  assert.match(text, /Playoffs Alive/);
  assert.match(text, /NL WC Padres Won 2-1/);
  assert.match(text, /NLDS Phillies Lead 2-1/);
  assert.match(text, /Next Today 5:08 @ PHI$/);
  assert.match(sheet.body.text, /<button type="button" class="club team-open" data-team="SD"/);
  assert.doesNotMatch(text.split("Playoffs")[0], /Next/);
});

test("a club with a bye shows it, and a series still to start shows no games", () => {
  session.state = { ...session.state, projected: false };
  const text = readText(renderTeamSheet("LAD", { now: OCTOBER_NOON }).body);

  assert.match(text, /NL WC Bye/);
  assert.match(text, /NLDS TBD 0-0/);
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
  const text = readText(renderTeamSheet("NYM", { now: OCTOBER_NOON }).body);

  assert.match(text, /Playoffs Out NL WC Brewers Lost 1-2$/);
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
  assert.doesNotMatch(renderTeamSheet("SD", { now: OCTOBER_NOON }).body.text, /Playoffs/);
});

test("a club the standings don't list yet still shows its league and its titles", () => {
  const sheet = renderTeamSheet("COL", { now: SEPTEMBER_NOON });

  assert.equal(readText(sheet.note), "NL");
  assert.equal(readText(sheet.body), "Season Titles Never won WS | Since 1993");
});
