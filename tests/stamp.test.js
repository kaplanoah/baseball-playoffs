/* The freshness stamp: "<time> <the newest baseball there is>" and,
   while nothing is on, "Next first pitch ... — <the game>". Each case is a
   real situation from the season, with the exact sentence the page must show.

   Times are Eastern (npm test sets TZ), written as ET wall-clock times and
   converted to the UTC timestamps a snapshot carries. Thursday 24 September
   2026 unless a case says otherwise. `since` is ten minutes before the
   snapshot: a final newer than that leads the line. */
const test = require("node:test");
const assert = require("node:assert/strict");
const { loadPage, plain } = require("./load");

const page = loadPage(["teams.js", "updates.js", "stamp.js"]);

// ET wall clock -> UTC ISO. September and early October are EDT, UTC-4.
const et = (date, hm) => {
  const [h, m] = hm.split(":").map(Number);
  return new Date(Date.UTC(...date.split("-").map((v, i) => i === 1 ? v - 1 : +v), h + 4, m)).toISOString();
};
const DAY = "2026-09-24", PREV = "2026-09-23";

const pre   = (away, home, start, date = DAY) => ({ away, home, start: et(date, start), state: "pre" });
const live  = (away, home, start, score, inning, date = DAY) =>
  ({ away, home, start: et(date, start), state: "live", score, inning });
const final = (away, home, start, score, end, date = DAY, endDate = date) =>
  ({ away, home, start: et(date, start), state: "final", score, end: et(endDate, end) });

// Filler games, all still to come, to make up a slate of any size.
const LATE = [["NYM","TEX"],["MIA","CHC"],["CIN","ATL"],["BOS","NYY"],["CLE","BOS"],
  ["SD","LAD"],["LAA","SEA"],["HOU","ATH"],["MIN","TEX"],["DET","PIT"],["SF","COL"],
  ["TOR","BAL"],["WSH","NYM"],["ARI","SF"],["KC","MIN"],["STL","MIL"]];
const later = (n, from = "19:05", date = DAY) => LATE.slice(0, n).map(([a, h]) => pre(a, h, from, date));

function ctx(opts = {}){
  return {
    ranking: opts.ranking || ["CWS", "MIL", "CHC", "CLE", "TB", "SD", "BOS", "HOU", "LAD", "ATL", "NYY", "PHI"],
    alive: opts.out ? id => !opts.out.includes(id) : () => true,
    seriesNote: opts.seriesNote || (() => ""),
    now: new Date(opts.now || et(DAY, "12:00"))
  };
}
const last = (slate, c = ctx()) => plain(page.run("lastStampText(S, C)", { S: slate, C: c }));
// Round-tripped so an object from the page's sandbox compares with one built here.
const upNext = (slate, c = ctx()) => JSON.parse(JSON.stringify(page.run("upNextText(S, C)", { S: slate, C: c })));

test("the night's last final, with the day's clause", () => {
  // 2:21 AM. Last night's slate is over.
  const slate = {
    since: et(DAY, "01:21"),
    today: { date: PREV, games: [
      final("HOU", "SEA", "21:40", [5, 6], "01:30", PREV, DAY),
      ...later(15, "19:05", PREV).map(g => ({ ...g, state: "final", score: [2, 1], end: et(PREV, "22:00") }))
    ] },
    nextDay: { date: DAY, games: [pre("STL", "PIT", "12:35"), pre("CWS", "KC", "14:10"), ...later(10)] }
  };
  assert.equal(last(slate), "Mariners 6 Astros 5 final at 1:30 AM, slate of 16 over");
  // Next: today's first pitch, and how many games the day holds.
  assert.deepEqual(upNext(slate), { at: et(DAY, "12:35"), tbd: false, text: "Cardinals @ Pirates, first of 12" });
});

test("a morning with nothing on: last night's final", () => {
  const slate = {
    since: et(DAY, "02:21"),
    today: { date: DAY, games: [pre("SD", "SF", "16:05"), pre("STL", "PIT", "18:35"), ...later(4)] },
    lastFinal: final("HOU", "SEA", "21:40", [5, 6], "01:30", PREV, DAY)
  };
  assert.equal(last(slate, ctx({ now: et(DAY, "13:17") })), "No games since Mariners 6 Astros 5 final at 1:30 AM last night");
  assert.deepEqual(upNext(slate), { at: et(DAY, "16:05"), tbd: false, text: "Padres @ Giants, first of 6" });
});

test("early afternoon: one game on, and no next line while it is", () => {
  const slate = {
    since: et(DAY, "02:21"),
    today: { date: DAY, games: [live("STL", "PIT", "12:35", [1, 1], 3), pre("CWS", "KC", "14:10"), ...later(10)] }
  };
  assert.equal(last(slate), "Cardinals @ Pirates 1-1 in the 3rd, slate of 12 under way");
  assert.equal(upNext(slate), null);
});

test("your club's game leads while games are on", () => {
  // Both games are live; the White Sox are ranked higher.
  const slate = {
    since: et(DAY, "13:17"),
    today: { date: DAY, games: [live("STL", "PIT", "12:35", [3, 2], 6), live("CWS", "KC", "14:10", [2, 0], 1), ...later(10)] }
  };
  assert.equal(last(slate), "White Sox @ Royals 2-0 in the 1st, slate of 12 under way");
});

test("a fresh final outranks the games still going", () => {
  const slate = {
    since: et(DAY, "21:00"),
    today: { date: DAY, games: [
      final("TB", "NYY", "19:05", [2, 5], "21:14"),
      live("CWS", "KC", "19:40", [4, 4], 7),
      final("STL", "PIT", "12:35", [3, 2], "15:40"),   // final, but not fresh
      ...later(9, "19:10").map(g => ({ ...g, state: "live", score: [0, 0], inning: 5 }))
    ] }
  };
  assert.equal(last(slate), "Yankees 5 Rays 2 final at 9:14 PM, slate of 12 under way");
});

test("between the afternoon and the evening: the newest final, then the next first pitch", () => {
  const slate = {
    since: et(DAY, "16:15"),
    today: { date: DAY, games: [
      final("STL", "PIT", "12:35", [3, 2], "15:40"),
      final("MIN", "DET", "13:10", [1, 7], "16:02"),
      ...later(10)
    ] }
  };
  assert.equal(last(slate), "Tigers 7 Twins 1 final at 4:02 PM, slate of 12 under way");
  // Every late game is 7:05, so your ranking breaks the tie: the Cubs are #3.
  // The day has begun, so no "first of".
  assert.deepEqual(upNext(slate), { at: et(DAY, "19:05"), tbd: false, text: "Marlins @ Cubs" });
});

test("ties go to your ranking, then to a club still alive", () => {
  const g1 = live("TOR", "BAL", "19:05", [1, 0], 4), g2 = live("WSH", "DET", "19:05", [2, 2], 4);
  const games = [g1, g2, pre("SD", "LAD", "22:10")];
  const slate = { since: et(DAY, "19:15"), today: { date: DAY, games } };
  // Neither ranked; Nationals and Tigers both out -> Blue Jays @ Orioles.
  assert.equal(last(slate, ctx({ ranking: [], out: ["WSH", "DET"] })), "Blue Jays @ Orioles 1-0 in the 4th, slate of 3 under way");
  // Rank the Tigers and that game wins, out or not.
  assert.equal(last(slate, ctx({ ranking: ["DET"], out: ["WSH", "DET"] })), "Nationals @ Tigers 2-2 in the 4th, slate of 3 under way");
});

test("every game final: the slate is over, and the next line looks to tomorrow", () => {
  const games = [final("SD", "LAD", "22:10", [4, 1], "01:02", DAY, "2026-09-25"),
    ...later(15).map(g => ({ ...g, state: "final", score: [3, 1], end: et(DAY, "22:05") }))];
  const slate = { since: et(DAY, "23:15"), today: { date: DAY, games },
    nextDay: { date: "2026-09-25", games: [pre("NYY", "BAL", "13:05", "2026-09-25"), pre("TB", "TOR", "19:07", "2026-09-25")] } };
  assert.equal(last(slate), "Padres 4 Dodgers 1 final at 1:02 AM, slate of 16 over");
  assert.deepEqual(upNext(slate), { at: et("2026-09-25", "13:05"), tbd: false, text: "Yankees @ Orioles" });
});

test("one or two games: named, with no slate", () => {
  const two = { since: et(DAY, "19:15"), today: { date: DAY, games: [
    live("CWS", "KC", "19:40", [1, 0], 2), live("TB", "NYY", "19:05", [3, 3], 5)] } };
  assert.equal(last(two), "Rays @ Yankees 3-3 in the 5th, White Sox @ Royals 1-0 in the 2nd");
  const one = { since: et(DAY, "12:15"), today: { date: DAY, games: [pre("HOU", "SEA", "21:40")] } };
  assert.deepEqual(upNext(one), { at: et(DAY, "21:40"), tbd: false, text: "Astros @ Mariners" });
});

test("an off day, and a final from days back", () => {
  const slate = { since: et(DAY, "12:15"), today: { date: DAY, games: [] },
    lastFinal: final("TOR", "BAL", "19:05", [3, 4], "22:01", "2026-09-21") };
  assert.equal(last(slate, ctx({ now: et(DAY, "13:15") })), "No games since Orioles 4 Blue Jays 3 final at 10:01 PM Monday");
  assert.equal(upNext(slate), null);
});

test("a first pitch MLB hasn't timed yet says so", () => {
  const slate = { today: { date: DAY, games: [] },
    nextDay: { date: "2026-09-29", games: [{ ...pre("DET", "CLE", "03:33", "2026-09-29"), tbd: true }] } };
  assert.deepEqual(upNext(slate), { at: et("2026-09-29", "03:33"), tbd: true, text: "Tigers @ Guardians" });
});

test("in October a final says what it did to the series", () => {
  const slate = { since: et(DAY, "23:15"), today: { date: DAY, games: [final("CHC", "MIL", "20:08", [1, 4], "23:41")] } };
  const c = ctx({ seriesNote: g => g.home === "MIL" ? " — Brewers now lead 2-0" : "" });
  assert.equal(last(slate, c), "Brewers 4 Cubs 1 final at 11:41 PM — Brewers now lead 2-0");
});

test("the day words beside a time", () => {
  const now = new Date(et(DAY, "12:00"));
  const when = iso => plain(page.run("stampWhen(new Date(I), N)", { I: iso, N: now }));
  const day = iso => page.run("stampDay(new Date(I), N)", { I: iso, N: now });
  assert.equal(when(et(DAY, "13:15")), "1:15 PM");
  assert.equal(when(et(PREV, "13:15")), "yesterday 1:15 PM");
  assert.equal(when(et("2026-09-25", "13:15")), "tomorrow 1:15 PM");
  assert.equal(when(et("2026-09-27", "13:15")), "Sunday 1:15 PM");
  assert.equal(day(et("2026-09-29", "13:15")), "Tuesday");
});

test("no sentence is ever a bare matchup or 'under way with'", () => {
  const days = [
    [live("STL", "PIT", "12:35", [1, 1], 3), pre("CWS", "KC", "14:10"), ...later(10)],
    [final("STL", "PIT", "12:35", [4, 1], "15:30"), pre("CWS", "KC", "14:10"), ...later(10)],
    [live("CWS", "KC", "14:10", [2, 0], 1), ...later(11)]
  ];
  for(const games of days){
    const line = last({ since: et(DAY, "02:21"), today: { date: DAY, games } });
    assert.doesNotMatch(line, /under way with/, line);
    // Every "Away @ Home" is followed by a score or a first pitch.
    for(const m of line.matchAll(/@ [A-Z][a-zA-Z ]+?(?=,|$| \d| first)/g)){
      const after = line.slice(m.index + m[0].length);
      assert.match(after, /^( \d+-\d+ in the| first pitch at)/, line);
    }
  }
});
