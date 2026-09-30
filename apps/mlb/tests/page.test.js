import { beforeEach, mock, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { composeState, session } from "../page/js/session.js";
import { renderDivisionBlock, renderFieldBlock, renderNextCell } from "../page/js/standings.js";
import { describeTeamStatus, nameSeries } from "../page/js/bracket.js";
import { describeDrought, listRankedOrder } from "../page/js/clubs.js";
import { describeRace, isSeedFinal } from "../page/js/race.js";
import { renderGameList } from "../page/js/games-view.js";
import { html } from "../../../shared/page/html.js";
import { buildSnapshot } from "../page/js/snapshot.js";
import { formatStampName } from "../page/js/stamp.js";
import { renderEntryText, renderUpdateText } from "../page/js/updates.js";
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
const describeEntry = (entry) => stripTags(String(renderEntryText(entry)).replace(RANK_CHIP, ""));
const describeUpdate = (entries) =>
  stripTags(String(renderUpdateText(entries)).replace(RANK_CHIP, ""))
    .replace(/&mdash;/g, "--")
    .replace(/&#39;/g, "'");

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
    assert.equal(renderCell(null), '<td class="next-cell">&mdash;</td>');
  }));

test("Next column: a club that's out shows only a postseason game", () =>
  checkAt(NOON, () => {
    const renderCell = (next) => normalizeSpaces(renderNextCell({ next }, { isOut: true }));
    const friday = { at: "2026-09-25T23:05:00Z", home: true, opp: "NYY" };
    assert.equal(renderCell(friday), '<td class="next-cell">&mdash;</td>');
    assert.equal(
      renderCell({ ...friday, postseason: true }),
      '<td class="next-cell">Fri 7:05 vs NYY</td>',
    );
  }));

test("Next column: a postseason opponent not yet known", () =>
  checkAt(NOON, () => {
    const next = { at: "2026-09-25T23:05:00Z", home: true, postseason: true };
    assert.equal(
      normalizeSpaces(renderNextCell({ next })),
      '<td class="next-cell">Fri 7:05 vs TBD</td>',
    );
  }));

test("Next column: shown with a dash when no club has a game left", () => {
  const block = String(
    renderDivisionBlock("AL East", [{ id: "NYY", w: 94, l: 68, pct: ".580", gb: "-" }]),
  );
  assert.match(block, /<th class="left next-cell">Next<\/th>/);
  assert.match(block, /<td class="next-cell">&mdash;<\/td>/);
});

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
  assert.equal(nameSeries("NL_DS2"), "NLDS");
  assert.equal(nameSeries("AL_WC1"), "AL Wild Card Series");
  assert.equal(nameSeries("WS"), "World Series");
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

test("update log: an elimination the club's own win didn't prevent says so", () => {
  assert.equal(
    describeEntry({
      kind: "elim",
      team: "BAL",
      despite: { team: "BAL", won: true, opp: "NYY", score: [4, 2] },
      via: [{ team: "CWS", won: true, opp: "KC", score: [9, 1] }],
    }),
    "Orioles eliminated &mdash; beat the Yankees 4-2, but White Sox beat the Royals 9-1",
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
  assert.equal(
    describeBerth({
      team: "HOU",
      what: "division",
      div: "AL West",
      via: [
        { team: "HOU", won: true, opp: "PHI", score: [1, 0] },
        { team: "TEX", won: false, opp: "NYY", score: [7, 8] },
      ],
    }),
    "Astros clinch the AL West &mdash; beat the Phillies 1-0, Rangers lost to the Yankees 8-7",
  );
});

const AT = "2026-09-27T21:43:00Z";
const createResult = (team, won, opp, score) => ({ team, won, opp, score });
const PHILLIES_WIN = createResult("PHI", true, "TB", [7, 3]);
const PHILLIES_CLINCH = {
  kind: "berth",
  team: "PHI",
  what: "playoff",
  via: [PHILLIES_WIN],
  at: AT,
};
const eliminateDiamondbacks = (fields) => ({ kind: "elim", team: "ARI", at: AT, ...fields });
const DIAMONDBACKS_LOSS = createResult("ARI", false, "SF", [2, 5]);

test("grouped updates: a clinch credits its win with the eliminations it decided", () => {
  assert.equal(
    describeUpdate([PHILLIES_CLINCH, eliminateDiamondbacks({ via: [PHILLIES_WIN] })]),
    "Phillies clinch a playoff spot -- beat the Rays 7-3, eliminating the Diamondbacks",
  );
  const padresLoss = createResult("SD", false, "LAD", [2, 6]);
  const dodgersWin = createResult("LAD", true, "SD", [6, 2]);
  assert.equal(
    describeUpdate([
      {
        kind: "berth",
        team: "LAD",
        what: "division",
        div: "NL West",
        via: [dodgersWin, padresLoss],
      },
      { kind: "elim", team: "SD", via: [padresLoss, dodgersWin], at: AT },
    ]),
    "Dodgers clinch the NL West -- beat the Padres 6-2, eliminating them",
  );
});

test("grouped updates: an eliminated club's own loss says whether it counted and when", () => {
  const describeWithLoss = (fields) =>
    describeUpdate([
      PHILLIES_CLINCH,
      eliminateDiamondbacks({ via: [DIAMONDBACKS_LOSS, PHILLIES_WIN], ...fields }),
    ]);
  assert.equal(
    describeWithLoss({ decider: "PHI" }),
    "Phillies clinch a playoff spot -- beat the Rays 7-3, eliminating the Diamondbacks after their 5-2 loss to the Giants",
  );
  assert.equal(
    describeWithLoss({ decider: "ARI" }),
    "Phillies clinch a playoff spot -- beat the Rays 7-3, Diamondbacks eliminated with a 5-2 loss to the Giants",
  );
  assert.equal(
    describeWithLoss({}),
    "Phillies clinch a playoff spot -- beat the Rays 7-3, eliminating the Diamondbacks, who also lost 5-2 to the Giants",
  );
  assert.equal(
    describeUpdate([
      PHILLIES_CLINCH,
      eliminateDiamondbacks({
        via: [PHILLIES_WIN],
        despite: createResult("ARI", true, "SF", [4, 1]),
      }),
    ]),
    "Phillies clinch a playoff spot -- beat the Rays 7-3, eliminating the Diamondbacks despite their 4-1 win over the Giants",
  );
});

test("grouped updates: a club that clinched without winning, and the losses behind it", () => {
  const rangersLoss = createResult("TEX", false, "MIN", [4, 6]);
  const astrosClinch = (via) => ({
    kind: "berth",
    team: "HOU",
    what: "division",
    div: "AL West",
    via,
  });
  assert.equal(
    describeUpdate([
      astrosClinch([rangersLoss]),
      { kind: "elim", team: "TEX", via: [rangersLoss] },
    ]),
    "Astros clinch the AL West -- Rangers eliminated with a 6-4 loss to the Twins",
  );
  const lateLoss = createResult("TEX", false, "NYY", [7, 8]);
  const astrosWin = createResult("HOU", true, "PHI", [1, 0]);
  assert.equal(
    describeUpdate([
      astrosClinch([astrosWin, lateLoss]),
      { kind: "elim", team: "TEX", via: [lateLoss] },
    ]),
    "Astros clinch the AL West -- beat the Phillies 1-0, Rangers eliminated with an 8-7 loss to the Yankees",
  );
  const marinersWin = createResult("SEA", true, "TB", [3, 2]);
  assert.equal(
    describeUpdate([astrosClinch([]), { kind: "elim", team: "TEX", via: [marinersWin] }]),
    "Astros clinch the AL West -- Rangers eliminated by the Mariners' 3-2 win over the Rays",
  );
});

test("grouped updates: one win that put out two clubs shows the win totals", () => {
  const metsWin = createResult("NYM", true, "ATL", [5, 2]);
  const race = { race: "wildcard", target: 89, at: AT };
  const braves = {
    kind: "elim",
    team: "ATL",
    most: 87,
    via: [createResult("ATL", false, "NYM", [2, 5]), metsWin],
    ...race,
  };
  const reds = { kind: "elim", team: "CIN", most: 88, via: [metsWin], ...race };
  const metsClinch = { kind: "berth", team: "NYM", what: "wildcard", via: [metsWin], at: AT };
  assert.equal(
    describeUpdate([metsClinch, braves, reds]),
    "Mets clinch a wild card spot -- beat the Braves 5-2 for their 89th win, eliminating them (87 wins at most) and the Reds (88 at most)",
  );
  assert.equal(
    describeUpdate([metsClinch, braves, { ...reds, most: 89 }]),
    "Mets clinch a wild card spot -- beat the Braves 5-2 for their 89th win, eliminating them (87 wins at most) and the Reds (89 at most, loses the tiebreaker)",
  );
  assert.equal(
    describeUpdate([metsClinch, braves]),
    "Mets clinch a wild card spot -- beat the Braves 5-2, eliminating them",
  );
});

test("grouped updates: eliminations one game decided, with no clinch", () => {
  const metsWin = createResult("NYM", true, "CHC", [4, 3]);
  const giants = {
    kind: "elim",
    team: "SF",
    race: "wildcard",
    most: 88,
    target: 89,
    via: [metsWin],
  };
  const cubs = {
    kind: "elim",
    team: "CHC",
    race: "wildcard",
    most: 87,
    target: 89,
    via: [createResult("CHC", false, "NYM", [3, 4]), metsWin],
  };
  assert.equal(
    describeUpdate([giants, cubs]),
    "Cubs and Giants eliminated -- Mets beat the Cubs 4-3 for their 89th win, in the last wild card spot; Cubs can reach 87 wins at most, Giants 88",
  );
  const { most, target, ...giantsWithoutCounts } = giants;
  assert.equal(
    describeUpdate([cubs, giantsWithoutCounts]),
    "Cubs and Giants eliminated -- Mets beat the Cubs 4-3",
  );
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
    assert.equal(renderCell({ next: today }), '<td class="next-cell">&mdash;</td>');
  }));

const MORNING_START = "2026-09-24T15:05:00Z"; // 11:05 AM ET, before NOON

function renderCellDuring(slateGames, row = {}, options = {}) {
  session.state = { teams: {}, slate: { today: { date: "2026-09-24", games: slateGames } } };
  return checkAt(NOON, () =>
    normalizeSpaces(renderNextCell({ id: "DET", ...row }, options)).replace(/&mdash;/g, "--"),
  );
}

test("Next column: a game under way reads as the club up, down or tied, and the inning", () => {
  const game = { away: "DET", home: "CLE", state: "live", start: MORNING_START, inning: 5 };
  assert.equal(
    renderCellDuring([{ ...game, score: [2, 4] }]),
    '<td class="next-cell live">Down 2 @ CLE in the 5th</td>',
  );
  assert.equal(
    renderCellDuring([{ ...game, away: "CLE", home: "DET", score: [2, 4] }]),
    '<td class="next-cell live">Up 2 vs CLE in the 5th</td>',
  );
  assert.equal(
    renderCellDuring([{ ...game, score: [0, 0], inning: 1 }]),
    '<td class="next-cell live">Tied @ CLE in the 1st</td>',
  );
});

test("Next column: a game under way shows in place of the club's next game", () => {
  const friday = { at: "2026-09-25T17:05:00Z", home: false, opp: "BOS" };
  const game = { away: "DET", home: "CLE", state: "live", start: MORNING_START, inning: 7 };
  assert.equal(
    renderCellDuring([{ ...game, score: [3, 2] }], { next: friday }),
    '<td class="next-cell live">Up 1 @ CLE in the 7th</td>',
  );
  assert.equal(
    renderCellDuring([{ ...game, state: "final", score: [3, 2] }], { next: friday }),
    '<td class="next-cell">Fri 1:05 @ BOS</td>',
  );
});

test("Next column: a delay reads after the score", () =>
  assert.equal(
    renderCellDuring([
      {
        away: "HOU",
        home: "DET",
        state: "live",
        start: MORNING_START,
        score: [1, 3],
        inning: 6,
        delay: "Delayed: Rain",
      },
    ]),
    '<td class="next-cell live delayed">Up 2 vs HOU -- Delayed: Rain</td>',
  ));

test("Next column: before first pitch, a game past its start reads as warmup", () => {
  const game = { away: "DET", home: "BAL", state: "pre" };
  assert.equal(
    renderCellDuring([{ ...game, start: MORNING_START }]),
    '<td class="next-cell live">Warmup @ BAL</td>',
  );
  assert.equal(
    renderCellDuring([{ ...game, start: "2026-09-24T17:05:00Z" }], {
      next: { at: "2026-09-24T17:05:00Z", home: false, opp: "BAL" },
    }),
    '<td class="next-cell">Today 1:05 @ BAL</td>',
  );
  assert.equal(
    renderCellDuring([{ ...game, start: MORNING_START, tbd: true }]),
    '<td class="next-cell">--</td>',
  );
});

test("Next column: a delayed start shows before the scheduled time comes", () =>
  assert.equal(
    renderCellDuring([
      {
        away: "DET",
        home: "BAL",
        state: "pre",
        start: "2026-09-24T17:05:00Z",
        delay: "Delayed: Rain",
      },
    ]),
    '<td class="next-cell live delayed">Today @ BAL -- Delayed: Rain</td>',
  ));

test("Next column: in a doubleheader, the game under way counts, not the one that's over", () => {
  const game = { away: "DET", home: "CLE", start: MORNING_START };
  assert.equal(
    renderCellDuring([
      { ...game, state: "final", score: [5, 1] },
      { ...game, state: "live", score: [0, 1], inning: 2, doubleheader: 2 },
    ]),
    '<td class="next-cell live">Down 1 @ CLE in the 2nd</td>',
  );
});

test("Next column: a club that's out shows only a postseason game under way", () => {
  const game = { away: "DET", home: "CLE", state: "live", start: MORNING_START, score: [2, 4] };
  assert.equal(renderCellDuring([game], {}, { isOut: true }), '<td class="next-cell">--</td>');
  assert.equal(
    renderCellDuring([{ ...game, inning: 9, postseason: true }], {}, { isOut: true }),
    '<td class="next-cell live">Down 2 @ CLE in the 9th</td>',
  );
});

test("division header: a magic number only when there is a number", () => {
  const renderHead = (leader) =>
    String(renderDivisionBlock("AL Central", [{ id: "CLE", lead: true, ...leader }]));
  assert.match(renderHead({ magic: "3" }), /magic 3/);
  assert.doesNotMatch(renderHead({ magic: "-" }), /magic/);
  assert.doesNotMatch(renderHead({ magic: null }), /magic/);
  assert.match(renderHead({ clinched: true, magic: "3" }), /clinched/);
});

const AL_SEEDS = { TB: 1, CLE: 2, TEX: 3, NYY: 4, BOS: 5, CWS: 6 };

function buildAlStandings(changes = {}) {
  const row = (id, w, l, fields) => ({
    id,
    w,
    l,
    pct: (w / (w + l)).toFixed(3).slice(1),
    ...fields,
    ...changes[id],
  });
  return {
    "AL East": [
      row("TB", 95, 60, { gb: "-", elim: "-", lead: true, magic: "2", clinch: "x" }),
      row("NYY", 89, 66, { gb: "6.0", elim: "2", wcgb: "+9.5", wce: "-", wcrank: "1" }),
      row("BOS", 84, 72, { gb: "11.5", elim: "E", wcgb: "+4.0", wce: "-", wcrank: "2" }),
      row("TOR", 77, 79, { gb: "18.5", elim: "E", wcgb: "3.0", wce: "3", wcrank: "4" }),
      row("BAL", 75, 81, { gb: "20.5", elim: "E", wcgb: "5.0", wce: "2", wcrank: "6" }),
    ],
    "AL Central": [
      row("CLE", 81, 75, { gb: "-", elim: "-", lead: true, magic: "6" }),
      row("CWS", 80, 76, { gb: "1.0", elim: "6", wcgb: "-", wce: "-", wcrank: "3" }),
      row("MIN", 73, 83, { gb: "8.0", elim: "E", wcgb: "7.0", wce: "E", wcrank: "7" }),
    ],
    "AL West": [
      row("TEX", 78, 78, { gb: "-", elim: "-", lead: true, magic: "2" }),
      row("HOU", 77, 79, { gb: "1.0", elim: "6", wcgb: "3.0", wce: "4", wcrank: "5" }),
    ],
  };
}

const listFieldRows = (rendered) =>
  [
    ...String(rendered).matchAll(/class="team-name">([^<]+)<|>(Wild cards)<|class="(cutline)"/g),
  ].map(([, name, label, cutline]) => name || label || cutline);

test("playoff field: division leaders by seed, then the wild cards, then the clubs still chasing", () => {
  session.state = {
    teams: Object.fromEntries(Object.entries(AL_SEEDS).map(([id, seed]) => [id, { seed }])),
  };
  assert.deepEqual(listFieldRows(renderFieldBlock("AL", buildAlStandings())), [
    "Rays",
    "Guardians",
    "Rangers",
    "Wild cards",
    "Yankees",
    "Red Sox",
    "White Sox",
    "cutline",
    "Blue Jays",
    "Astros",
    "Orioles",
  ]);
});

test("playoff field: every live chaser shows, and eliminated clubs fill in to three", () => {
  session.state = {
    teams: Object.fromEntries(Object.entries(AL_SEEDS).map(([id, seed]) => [id, { seed }])),
  };
  const listChasers = (changes) =>
    listFieldRows(renderFieldBlock("AL", buildAlStandings(changes))).slice(8);
  assert.deepEqual(listChasers({ MIN: { wce: "5" } }), ["Blue Jays", "Astros", "Orioles", "Twins"]);
  const withOneAlive = listChasers({ HOU: { wce: "E" }, BAL: { wce: "E" } });
  assert.deepEqual(withOneAlive, ["Blue Jays", "Astros", "Orioles"]);
  const rendered = String(
    renderFieldBlock("AL", buildAlStandings({ HOU: { wce: "E" }, BAL: { wce: "E" } })),
  );
  assert.equal(rendered.match(/<tr class="eliminated">/g)?.length, 2);
});

test("playoff field: each leader's lead over second place and its magic number", () => {
  session.state = {
    teams: Object.fromEntries(Object.entries(AL_SEEDS).map(([id, seed]) => [id, { seed }])),
  };
  // Seed through M#, one entry per cell.
  const describeLeader = (rendered, name) => {
    const row = String(rendered)
      .split("<tr")
      .find((markup) => markup.includes(`>${name}<`));
    return [...row.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)]
      .map(([, cell]) => stripTags(cell).trim())
      .slice(1, 8);
  };
  const rendered = renderFieldBlock("AL", buildAlStandings({ CLE: { clinched: true } }));
  assert.deepEqual(describeLeader(rendered, "Rays"), [
    "1",
    "Rays",
    "95",
    "60",
    ".613",
    "+6.0",
    "2",
  ]);
  assert.deepEqual(describeLeader(rendered, "Guardians"), [
    "2",
    "Guardians",
    "81",
    "75",
    ".519",
    "+1.0",
    "&mdash;",
  ]);
  assert.match(String(rendered), /<td class="elim-num clinched mid">&mdash;<\/td>/);
  const tied = renderFieldBlock("AL", buildAlStandings({ HOU: { gb: "-" } }));
  assert.deepEqual(describeLeader(tied, "Rangers").slice(5), ["&mdash;", "2"]);
});

test("standings rows keep room for a rank tag whether or not the club is ranked", () => {
  session.state = { teams: { TB: { seed: 1 } }, ranking: ["TB"] };
  const rendered = String(renderDivisionBlock("AL East", buildAlStandings()["AL East"]));
  assert.equal(rendered.match(/<td class="rank-cell"><span class="rank-slot">/g)?.length, 5);
  assert.equal(rendered.match(/class="rank-tag/g)?.length, 1);
});

test("text from the shared store or MLB is shown as text, never as markup", () => {
  const markup = '<img src=x onerror="alert(1)">';
  const shown = [
    renderEntryText({ kind: "berth", team: "NYY", what: "division", div: markup }),
    renderEntryText({ kind: "game", won: "NYY", series: markup, game: markup, score: [markup, 1] }),
    renderEntryText({ kind: "seed", team: "NYY", from: markup, to: markup }),
    renderEntryText({ kind: "unknown", text: markup }),
    renderNextCell({ next: { at: "2026-09-25T23:05:00Z", home: true, opp: markup } }),
    renderDivisionBlock("AL East", [{ id: "NYY", w: markup, l: 1, pct: markup, gb: markup }]),
    html`<span>${formatStampName(markup)}</span>`,
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
  assert.equal(describeDrought("TB"), "Since 1998");
  assert.equal(describeDrought("COL"), "Since 1993");
  assert.equal(describeDrought("MIL"), "Since 1969");
});

test("a live answer without standings leaves the saved field showing", () => {
  const saved = { NYY: { league: "AL", seed: 4 } };
  const { activeYear } = session;
  const live = { season: 2026, asOf: "2026-09-24T22:00:00Z", slate: null, log: [] };
  try {
    Object.assign(session, { activeYear: 2026, readings: null });
    session.seasonDoc = { year: 2026, teams: saved, series: {}, ranking: [], log: [] };
    session.live = { ...live, projected: true, standings: null, teams: {}, series: {} };
    composeState();
    assert.deepEqual(session.state.teams, saved);
    const teams = { TOR: { league: "AL", seed: 1 } };
    session.live = { ...live, projected: true, standings: { divisions: {} }, teams, series: {} };
    composeState();
    assert.deepEqual(session.state.teams, teams);
  } finally {
    Object.assign(session, { activeYear, live: null, seasonDoc: null });
  }
});

test("each series keeps whichever of the saved and live records has counted more games", () => {
  const teams = { CWS: { league: "AL", seed: 6 }, HOU: { league: "AL", seed: 3 } };
  const gameTwo = { at: "2026-10-01T00:08:00Z", date: "2026-09-30", tbd: false, game: 2 };
  const gameOne = { ...gameTwo, at: "2026-09-30T00:08:00Z", date: "2026-09-29", game: 1 };
  const savedSeries = {
    AL_WC1: { winsA: 0, winsB: 1, next: gameTwo },
    AL_WC2: { winsA: 0, winsB: 0, next: gameOne },
  };
  const liveSeries = {
    AL_WC1: { winsA: 0, winsB: 0, next: gameOne },
    AL_WC2: { winsA: 1, winsB: 0, next: gameTwo },
  };
  const { activeYear } = session;
  const live = { season: 2026, asOf: "2026-09-30T00:23:00Z", slate: null, log: [] };
  try {
    Object.assign(session, { activeYear: 2026, readings: null });
    session.seasonDoc = { year: 2026, teams, series: savedSeries, ranking: [], log: [] };
    session.live = { ...live, projected: false, standings: null, teams, series: liveSeries };
    composeState();
    assert.deepEqual(session.state.series, {
      AL_WC1: savedSeries.AL_WC1,
      AL_WC2: liveSeries.AL_WC2,
    });
    const otherField = { ...teams, NYY: { league: "AL", seed: 4 } };
    session.live = { ...session.live, teams: otherField };
    composeState();
    assert.deepEqual(session.state.series, liveSeries);
  } finally {
    Object.assign(session, { activeYear, live: null, seasonDoc: null });
  }
});

test("last year's champion is defending while this year's is undecided, whatever year is shown", () => {
  const final2025 = JSON.parse(
    readFileSync(`${import.meta.dirname}/fixtures/2025-final.json`, "utf8"),
  );
  const shown2025 = buildSnapshot(final2025.responses, {
    season: 2025,
    now: Date.parse(final2025.now),
  });
  const { currentSeason, activeYear } = session;
  try {
    Object.assign(session, { currentSeason: 2026, trackedTitles: { LAD: 2025 } });
    Object.assign(session, { activeYear: 2025, state: shown2025 });
    assert.equal(describeDrought("LAD"), "Defending");
    Object.assign(session, { activeYear: 2026, state: { teams: {}, series: {} } });
    assert.equal(describeDrought("LAD"), "Defending");
  } finally {
    Object.assign(session, { currentSeason, activeYear, trackedTitles: {} });
  }
});

test("clubs never dragged into place follow the ranked ones by league and seed", () => {
  session.state = {
    teams: {
      ATL: { league: "NL", seed: 1 },
      NYY: { league: "AL", seed: 4 },
      SEA: { league: "AL", seed: 2 },
      TB: { league: "AL", seed: 1 },
    },
    ranking: ["SEA"],
  };
  assert.deepEqual(listRankedOrder(), ["SEA", "TB", "NYY", "ATL"]);
});

// Detroit went out in the Wild Card Series and New York in the Division Series.
function buildPostseasonState() {
  const teams = {};
  const clubs = {
    AL: ["NYY", "TOR", "SEA", "BOS", "DET", "CLE"],
    NL: ["LAD", "MIL", "PHI", "CHC", "SD", "CIN"],
  };
  for (const [league, ids] of Object.entries(clubs))
    ids.forEach((id, index) => (teams[id] = { league, seed: index + 1 }));
  return {
    teams,
    series: { AL_WC2: { winsA: 2, winsB: 0 }, AL_DS1: { winsA: 1, winsB: 3 } },
  };
}

test("a club is out whichever round it lost in, and alive until then", () => {
  const state = buildPostseasonState();
  assert.equal(describeTeamStatus(state, "DET"), "out");
  assert.equal(describeTeamStatus(state, "NYY"), "out");
  assert.equal(describeTeamStatus(state, "BOS"), "alive");
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
    "Orioles 4 - 2 Final Yankees",
    "Orioles After 1st game Yankees",
    "Blue Jays Postponed Orioles",
    "Guardians 1 - 0 Bot 7th Red Sox",
  ]);
  assert.deepEqual(describeGameList(slate, "next"), ["Sat, Oct 3", "TBD 1:08 PM Rays"]);
  assert.deepEqual(describeGameList(slate, "previous"), ["No earlier games this season"]);
});

test("games list: a game still to play names its starters, with their arm and ERA", () => {
  const slate = {
    today: {
      date: "2026-09-29",
      games: [
        {
          away: "BOS",
          home: "NYY",
          state: "pre",
          start: "2026-09-30T00:08:00Z",
          starters: [
            { id: 801139, name: "Tolle", hand: "L", era: "3.03" },
            { id: 693645, name: "Schlittler", hand: "R", era: "1.95" },
          ],
        },
        {
          away: "CHC",
          home: "SD",
          state: "pre",
          start: "2026-09-30T02:08:00Z",
          starters: [{ id: 571510 }, { id: 650633, name: "King", hand: "R", era: null }],
        },
      ],
    },
  };
  assert.deepEqual(describeGameList(slate, "today"), [
    "Tue, Sep 29",
    "Red Sox 8:08 PM Yankees Tolle L 3.03 ERA Schlittler R 1.95 ERA",
    "Cubs 10:08 PM Padres King R",
  ]);
  const rendered = String(renderGameList(slate, "today"));
  assert.match(rendered, /title="Throws left-handed">L</);
  assert.match(rendered, /<span class="starter home" title="Starting pitcher">/);
  assert.equal(rendered.match(/class="game-row pre with-starters"/g)?.length, 2);
});

test("games list: a game without a named starter keeps its row as it was", () => {
  const slate = {
    today: {
      date: "2026-09-29",
      games: [
        {
          away: "CHC",
          home: "SD",
          state: "pre",
          start: "2026-09-30T02:08:00Z",
          starters: [{ id: 571510 }, null],
        },
      ],
    },
  };
  const rendered = String(renderGameList(slate, "today"));
  assert.match(rendered, /class="game-row pre"/);
  assert.doesNotMatch(rendered, /class="starter/);
});

test("games list: an empty list says so without a closing period", () => {
  const slate = { today: { date: "2026-09-29", games: [] }, previous: [], next: [] };
  assert.deepEqual(describeGameList(slate, "previous"), ["No earlier games this season"]);
  assert.deepEqual(describeGameList(slate, "today"), ["No games today"]);
  assert.deepEqual(describeGameList(slate, "next"), ["No games scheduled yet"]);
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

test("games list: each club's seed, record, and race, without its rank", () => {
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
    "Orioles 79-82 3 - 7 Final Yankees 4 seed 93-68 w",
  ]);
  const rendered = String(renderGameList(slate, "today"));
  assert.doesNotMatch(rendered, /rank-tag/);
  assert.equal(rendered.match(/class="seed-lock"/g)?.length, 1);
  assert.match(rendered, /title="Clinched a wild card spot">w</);
});

const listSideClasses = (rendered) =>
  [...String(rendered).matchAll(/class="game-side ([^"]*)"/g)].map(([, classes]) =>
    classes.split(/\s+/).filter(Boolean),
  );

test("games list: a finished game marks its winner and dims only the losing score", () => {
  const slate = {
    today: {
      date: "2026-09-26",
      games: [
        { away: "BAL", home: "NYY", state: "final", start: "2026-09-26T17:05:00Z", score: [3, 7] },
        {
          away: "TB",
          home: "BOS",
          state: "live",
          start: "2026-09-26T17:10:00Z",
          score: [5, 1],
          inning: 6,
          half: "top",
        },
      ],
    },
  };
  const rendered = renderGameList(slate, "today");
  assert.deepEqual(listSideClasses(rendered), [["away"], ["home", "won"], ["away"], ["home"]]);
  assert.match(String(rendered), /<span class="lost">3<\/span>/);
});

test("games list: a club out of the race or knocked out of the postseason shows as out", () => {
  session.state = buildPostseasonState();
  session.standings = {
    divisions: {
      "AL East": [
        { id: "BAL", w: 75, l: 87, gb: "19.0", wcgb: "9.0", elim: "E", wce: "E", wcrank: "8" },
      ],
    },
  };
  const slate = {
    today: {
      date: "2026-10-01",
      games: [
        { away: "DET", home: "BOS", state: "final", start: "2026-10-01T17:05:00Z", score: [1, 4] },
        { away: "BAL", home: "TOR", state: "pre", start: "2026-10-01T23:07:00Z" },
      ],
    },
  };
  assert.deepEqual(listSideClasses(renderGameList(slate, "today")), [
    ["away", "out"],
    ["home", "won"],
    ["away", "out"],
    ["home"],
  ]);
});

test("a club's race: clinched, still racing, or out", () => {
  const describe = (row) => describeRace({ gb: "-", wcgb: "-", elim: "-", wce: "-", ...row });
  assert.deepEqual(describe({ clinch: "z", clinched: true, lead: true }), {
    label: "z",
    standing: "clinched",
  });
  assert.equal(describe({ clinch: "y", clinched: true, lead: true }).label, "y");
  assert.equal(describe({ clinched: true, lead: true }).label, "y");
  assert.equal(describe({ clinch: "x", lead: true, magic: "3" }).label, "x");
  assert.equal(
    describe({ gb: "5.0", wcgb: "+10.0", elim: "E", clinch: "w", wcrank: "1" }).label,
    "w",
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

// The last day of 2026: one game left each, so a club's wins can grow by one at most.
const FINAL_DAY_STANDINGS = {
  divisions: {
    "AL East": [
      { id: "TB", w: 98, l: 63, elim: "-", wce: "-", clinch: "z", clinched: true, lead: true },
      { id: "NYY", w: 93, l: 68, elim: "E", wce: "-", clinch: "w" },
    ],
    "AL Central": [
      { id: "CLE", w: 85, l: 76, elim: "-", wce: "-", clinch: "y", clinched: true, lead: true },
      { id: "CWS", w: 83, l: 78, elim: "E", wce: "-", clinch: "w" },
    ],
    "AL West": [
      { id: "HOU", w: 80, l: 81, elim: "-", wce: "-", lead: true },
      { id: "TEX", w: 80, l: 81, elim: "-", wce: "E" },
    ],
    "NL Central": [
      { id: "CHC", w: 88, l: 73, elim: "E", wce: "-", clinch: "w" },
      { id: "MIL", w: 102, l: 59, elim: "-", wce: "-", clinch: "z", clinched: true, lead: true },
    ],
    "NL East": [
      { id: "PHI", w: 87, l: 74, elim: "E", wce: "-" },
      { id: "ATL", w: 94, l: 67, elim: "-", wce: "-", clinch: "y", clinched: true, lead: true },
    ],
  },
};

test("a seed is final only once no club can still pass or tie it", () => {
  const seeds = { TB: 1, CLE: 2, HOU: 3, NYY: 4, CWS: 6, MIL: 1, ATL: 3, CHC: 5, PHI: 6 };
  session.state = {
    teams: Object.fromEntries(Object.entries(seeds).map(([id, seed]) => [id, { seed }])),
  };
  session.standings = FINAL_DAY_STANDINGS;
  assert.equal(isSeedFinal("TB"), true);
  assert.equal(isSeedFinal("CLE"), true);
  assert.equal(isSeedFinal("NYY"), true);
  assert.equal(isSeedFinal("CHC"), false, "the Phillies can still tie the Cubs");
  assert.equal(isSeedFinal("HOU"), false, "not clinched");
  assert.equal(isSeedFinal("PHI"), false, "not clinched");
  assert.equal(isSeedFinal("TEX"), false, "not in the field");

  session.state = { ...session.state, projected: false };
  assert.equal(isSeedFinal("CHC"), true, "MLB has set the bracket");
});

test("games list: a season with no live data says why", () => {
  const { activeYear, currentSeason } = session;
  try {
    session.currentSeason = 2026;
    session.activeYear = 2025;
    assert.deepEqual(describeGameList(null, "today"), ["Games show for the current season only"]);
    session.activeYear = 2026;
    assert.deepEqual(describeGameList(null, "today"), [
      "Games appear here as soon as the page can reach MLB",
    ]);
  } finally {
    Object.assign(session, { activeYear, currentSeason });
  }
});
