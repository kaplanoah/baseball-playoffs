/* The freshness stamp: "Last updated ... — <what the run found>" and "Next
   update ... — <what the next check is for>". Each case is a real situation
   from the season, with the exact sentence the page must show.

   Times are Eastern (npm test sets TZ), written as ET wall-clock times and
   converted to the UTC timestamps the routine stores. Thursday 24 September
   2026 unless a case says otherwise. */
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
const next = (slate, nextAt, c = ctx()) => plain(page.run("nextStampText(S, N, C)", { S: slate, N: nextAt, C: c }));
const dedupe = (a, b) => page.run("dedupeSlate(A, B)", { A: a, B: b });

test("the night's last run: the late final, and tomorrow's first pitch, not 'under way'", () => {
  // 2:21 AM. Last night's slate is over; the next check is 1:15 PM today.
  const slate = {
    since: et(DAY, "01:21"),
    today: { date: PREV, games: [
      final("HOU", "SEA", "21:40", [5, 6], "01:30", PREV, DAY),
      ...later(15, "19:05", PREV).map(g => ({ ...g, state: "final", score: [2, 1], end: et(PREV, "22:00") }))
    ] },
    nextDay: { date: DAY, games: [pre("STL", "PIT", "12:35"), pre("CWS", "KC", "14:10"), ...later(10)] }
  };
  assert.equal(last(slate), "Mariners 6 Astros 5 final at 1:30 AM, slate of 16 over");
  assert.equal(next(slate, et(DAY, "13:15")), "slate of 12 starts with Cardinals @ Pirates first pitch at 12:35 PM");
});

test("a morning with nothing on: last night's final, and a routine check before first pitch", () => {
  const slate = {
    since: et(DAY, "02:21"),
    today: { date: DAY, games: [pre("SD", "SF", "16:05"), pre("STL", "PIT", "18:35"), ...later(4)] },
    lastFinal: final("HOU", "SEA", "21:40", [5, 6], "01:30", PREV, DAY)
  };
  assert.equal(last(slate, ctx({ now: et(DAY, "13:17") })), "No games since Mariners 6 Astros 5 final last night");
  assert.equal(next(slate, et(DAY, "14:15")), "routine check, slate of 6 starts with Padres @ Giants first pitch at 4:05 PM");
});

test("early afternoon: one game on, and the next check is for your club's game", () => {
  // 1:17 PM. The White Sox are your #1, and first pitch in KC is 2:10.
  const slate = {
    since: et(DAY, "02:21"),
    today: { date: DAY, games: [live("STL", "PIT", "12:35", [1, 1], 3), pre("CWS", "KC", "14:10"), ...later(10)] }
  };
  const a = last(slate), b = next(slate, et(DAY, "14:15"));
  assert.equal(a, "Cardinals @ Pirates 1-1 in the 3rd, slate of 12 under way");
  assert.equal(b, "White Sox @ Royals first pitch at 2:10 PM, slate of 12 under way");
  // Said once, on the line where the day is still going.
  assert.equal(dedupe(a, b), "Cardinals @ Pirates 1-1 in the 3rd");
});

test("a game already on at the next check is still named by its first pitch", () => {
  // 2:17 PM, next check 4:15. Both games are live; the White Sox are ranked higher.
  const slate = {
    since: et(DAY, "13:17"),
    today: { date: DAY, games: [live("STL", "PIT", "12:35", [3, 2], 6), live("CWS", "KC", "14:10", [2, 0], 1), ...later(10)] }
  };
  assert.equal(last(slate), "White Sox @ Royals 2-0 in the 1st, slate of 12 under way");
  assert.equal(next(slate, et(DAY, "16:15")), "White Sox @ Royals first pitch at 2:10 PM, slate of 12 under way");
});

test("a fresh final outranks the games still going", () => {
  const slate = {
    since: et(DAY, "21:00"),
    today: { date: DAY, games: [
      final("TB", "NYY", "19:05", [2, 5], "21:14"),
      live("CWS", "KC", "19:40", [4, 4], 7),
      final("STL", "PIT", "12:35", [3, 2], "15:40"),   // final, but before the last run
      ...later(9, "19:10").map(g => ({ ...g, state: "live", score: [0, 0], inning: 5 }))
    ] }
  };
  assert.equal(last(slate), "Yankees 5 Rays 2 final at 9:14 PM, slate of 12 under way");
});

test("between finals, the newest final with the day's clause", () => {
  // A late-afternoon gap: two finals from before the last run, the rest to come.
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
  assert.equal(next(slate, et(DAY, "17:15")), "routine check, Marlins @ Cubs first pitch at 7:05 PM, slate of 12 under way");
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

test("every game final: the slate is over, and nothing is left tonight", () => {
  const games = [final("SD", "LAD", "22:10", [4, 1], "01:02", DAY, "2026-09-25"),
    ...later(15).map(g => ({ ...g, state: "final", score: [3, 1], end: et(DAY, "22:05") }))];
  const slate = { since: et(DAY, "23:15"), today: { date: DAY, games } };
  assert.equal(last(slate), "Padres 4 Dodgers 1 final at 1:02 AM, slate of 16 over");
  assert.equal(next(slate, et("2026-09-25", "02:15")), "routine check, nothing left tonight");
});

test("one or two games: named, with no slate", () => {
  const two = { since: et(DAY, "19:15"), today: { date: DAY, games: [
    live("CWS", "KC", "19:40", [1, 0], 2), live("TB", "NYY", "19:05", [3, 3], 5)] } };
  assert.equal(last(two), "Rays @ Yankees 3-3 in the 5th, White Sox @ Royals 1-0 in the 2nd");
  assert.equal(next(two, et(DAY, "21:15")), "Rays @ Yankees first pitch at 7:05 PM, White Sox @ Royals first pitch at 7:40 PM");
  const one = { since: et(DAY, "12:15"), today: { date: DAY, games: [pre("HOU", "SEA", "21:40")] } };
  assert.equal(next(one, et(DAY, "13:15")), "routine check, Astros @ Mariners first pitch at 9:40 PM");
});

test("an off day, and a final from days back", () => {
  const slate = { since: et(DAY, "12:15"), today: { date: DAY, games: [] },
    lastFinal: final("TOR", "BAL", "19:05", [3, 4], "22:01", "2026-09-21") };
  assert.equal(last(slate, ctx({ now: et(DAY, "13:15") })), "No games since Orioles 4 Blue Jays 3 final Monday");
  assert.equal(next(slate, et(DAY, "14:15")), "routine check, no games today");
});

test("a leftover nextDay from an earlier night is ignored", () => {
  const slate = { since: et(DAY, "18:15"),
    today: { date: DAY, games: [live("CWS", "KC", "19:40", [1, 0], 2), ...later(11)] },
    nextDay: { date: DAY, games: [pre("STL", "PIT", "12:35")] } };
  assert.equal(next(slate, et(DAY, "20:15")), "White Sox @ Royals first pitch at 7:40 PM, slate of 12 under way");
});

test("the season is over: no next line", () => {
  const slate = { since: null, today: { date: DAY, games: [] } };
  assert.equal(next(slate, null), "");
});

test("in October a final says what it did to the series", () => {
  const slate = { since: et(DAY, "23:15"), today: { date: DAY, games: [final("CHC", "MIL", "20:08", [1, 4], "23:41")] } };
  const c = ctx({ seriesNote: g => g.home === "MIL" ? " — Brewers now lead 2-0" : "" });
  assert.equal(last(slate, c), "Brewers 4 Cubs 1 final at 11:41 PM — Brewers now lead 2-0");
});

test("the slate clause is dropped from the first line only when both lines repeat it", () => {
  assert.equal(dedupe("A, slate of 12 under way", "B, slate of 12 under way"), "A");
  assert.equal(dedupe("A, slate of 16 over", "slate of 12 starts with B"), "A, slate of 16 over");
  assert.equal(dedupe("A", ""), "A");
});

test("no sentence is ever a bare matchup or 'under way with'", () => {
  const all = [];
  const days = [
    [live("STL", "PIT", "12:35", [1, 1], 3), pre("CWS", "KC", "14:10"), ...later(10)],
    [pre("STL", "PIT", "12:35"), pre("CWS", "KC", "14:10"), ...later(10)],
    [live("CWS", "KC", "14:10", [2, 0], 1), ...later(11)]
  ];
  for(const games of days){
    const s = { since: et(DAY, "02:21"), today: { date: DAY, games } };
    for(const slot of ["13:15", "14:15", "16:15", "20:15"]) all.push(next(s, et(DAY, slot)));
    all.push(last(s));
  }
  for(const line of all){
    assert.doesNotMatch(line, /under way with/, line);
    // Every "Away @ Home" is followed by a score or a first pitch.
    for(const m of line.matchAll(/@ [A-Z][a-zA-Z ]+?(?=,|$| \d| first)/g)){
      const after = line.slice(m.index + m[0].length);
      assert.match(after, /^( \d+-\d+ in the| first pitch at)/, line);
    }
  }
});
