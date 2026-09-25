/* The live snapshot, built from real Stats API responses recorded in
   tests/fixtures: the finished 2025 postseason, and the evening of 24
   September 2026 with games in progress. States in between -- a bracket
   just set, a postseason half played -- are made from the 2025 responses
   by winding the clock back, the way MLB's own schedule looked then. */
const test = require("node:test");
const assert = require("node:assert/strict");
const S = require("../js/snapshot.js");

const fixture = name => JSON.parse(require("fs").readFileSync(`${__dirname}/fixtures/${name}.json`, "utf8"));
const SEASON_2025 = fixture("2025-final");
const EVENING = fixture("2026-09-24-evening");
const build = (f, now = Date.parse(f.now)) => S.buildSnapshot(f.responses, { season: f.season, now });

/* The 2025 postseason as it stood at `cutoff`: later games not yet played,
   and clubs not yet decided back to MLB's placeholder names. */
const PLACEHOLDER = {
  CS:  ["Lower Seed", "Higher Seed"],
  WS:  ["Lower Seed League Champion", "Higher Seed League Champion"]
};
function rewind(f, cutoff, { unsetRounds = [], dsAway = false } = {}){
  const copy = JSON.parse(JSON.stringify(f));
  let fake = 9000;
  for(const day of copy.responses.postseason.dates){
    for(const g of day.games){
      if(Date.parse(g.gameDate) < Date.parse(cutoff)) continue;
      g.status = { abstractGameState: "Preview", codedGameState: "S", detailedState: "Scheduled", startTimeTBD: false };
      delete g.teams.away.score; delete g.teams.home.score; delete g.gameInfo;
      const lg = g.seriesDescription.slice(0, 2);
      const round = { L: "CS", W: "WS" }[g.gameType];
      if(round && unsetRounds.includes(round)){
        const [lo, hi] = PLACEHOLDER[round];
        g.teams.away.team = { id: fake++, name: round === "WS" ? lo : `${lg} ${lo}` };
        g.teams.home.team = { id: fake++, name: round === "WS" ? hi : `${lg} ${hi}` };
      }
      if(g.gameType === "D" && dsAway){
        // The wild card winner isn't known yet: "AL 4/5 Winner at Toronto".
        const host = [115, 116, 136, 141, 143, 158].includes(g.teams.home.team.id) ? "away" : "home";
        const wc = g.teams[host].team.id;
        const fromWc2 = [147, 111, 112, 135].includes(wc); // NYY, BOS, CHC, SD: the 4/5 series
        g.teams[host].team = { id: fake++, name: `${lg} ${fromWc2 ? "4/5" : "3/6"} Winner` };
      }
    }
  }
  return copy;
}

test("2025: the official field comes from the postseason schedule, seeded", () => {
  const snap = build(SEASON_2025);
  assert.equal(snap.projected, false);
  const seeds = lg => Object.entries(snap.teams).filter(([, t]) => t.league === lg)
    .sort((a, b) => a[1].seed - b[1].seed).map(([id]) => id);
  assert.deepEqual(seeds("AL"), ["TOR", "SEA", "CLE", "NYY", "BOS", "DET"]);
  assert.deepEqual(seeds("NL"), ["MIL", "PHI", "LAD", "CHC", "SD", "CIN"]);
  assert.deepEqual(snap.teams.TOR, { league: "AL", seed: 1, w: 94, l: 68 });
});

test("2025: every series record, and no next game once decided", () => {
  const { series } = build(SEASON_2025);
  const rec = id => [series[id].winsA, series[id].winsB];
  assert.deepEqual(rec("AL_WC1"), [1, 2]);   // Tigers over the Guardians
  assert.deepEqual(rec("AL_WC2"), [2, 1]);   // Yankees over the Red Sox
  assert.deepEqual(rec("AL_DS1"), [3, 1]);
  assert.deepEqual(rec("AL_DS2"), [3, 2]);
  assert.deepEqual(rec("AL_CS"),  [4, 3]);
  assert.deepEqual(rec("NL_WC1"), [2, 0]);
  assert.deepEqual(rec("NL_DS2"), [1, 3]);
  assert.deepEqual(rec("NL_CS"),  [0, 4]);
  assert.deepEqual(rec("WS"),     [3, 4]);
  assert.ok(Object.values(series).every(s => !s.next));
});

test("2025: the log has every game, oldest first, a clinch closing each series", () => {
  const { log } = build(SEASON_2025);
  assert.equal(log.length, 47);
  assert.equal(log.filter(e => e.kind === "clinch").length, 11);
  assert.ok(log.every((e, i) => !i || Date.parse(log[i - 1].at) <= Date.parse(e.at)));
  assert.deepEqual(log[0], { at: "2025-09-30T19:42:00Z", kind: "game", series: "AL_WC1", won: "DET", game: 1, score: [1, 0] });
  const last = log[log.length - 1];
  assert.deepEqual({ ...last, at: undefined }, { at: undefined, kind: "clinch", series: "WS", team: "LAD", over: "TOR", score: [4, 3] });
});

test("a bracket just set: twelve real clubs, division series opponents still placeholders", () => {
  const snap = build(rewind(SEASON_2025, "2025-09-30T00:00:00Z", { unsetRounds: ["CS", "WS"], dsAway: true }),
    Date.parse("2025-09-29T16:00:00Z"));
  assert.equal(snap.projected, false);
  assert.equal(snap.teams.TOR.seed, 1);
  assert.equal(snap.teams.DET.seed, 6);
  assert.deepEqual(snap.log, []);
  assert.deepEqual(snap.series.AL_WC1, { winsA: 0, winsB: 0,
    next: { at: "2025-09-30T17:08:00Z", date: "2025-09-30", tbd: false, game: 1 } });
  // The 4/5 winner goes to the 1 seed: DS1 is Toronto's series.
  assert.equal(snap.series.AL_DS1.next.date, "2025-10-04");
  assert.ok(snap.series.WS.next);
});

test("halfway: division series under way, the next game named, later rounds waiting", () => {
  const snap = build(rewind(SEASON_2025, "2025-10-08T12:00:00Z", { unsetRounds: ["CS", "WS"] }),
    Date.parse("2025-10-08T14:00:00Z"));
  const { series } = snap;
  assert.deepEqual([series.AL_WC1.winsA, series.AL_WC1.winsB], [1, 2]);
  assert.equal(series.AL_WC1.next, undefined);
  // Toronto led the Yankees 2-1 going into Game 4 on 8 October.
  assert.deepEqual([series.AL_DS1.winsA, series.AL_DS1.winsB], [2, 1]);
  assert.equal(series.AL_DS1.next.game, 4);
  assert.deepEqual([series.AL_CS.winsA, series.AL_CS.winsB], [0, 0]);
  assert.equal(snap.log.filter(e => e.kind === "clinch").length, 4);
});

test("September: seeds projected from the standings, placeholders ignored", () => {
  const snap = build(EVENING);
  assert.equal(snap.projected, true);
  assert.deepEqual(snap.teams.TB, { league: "AL", seed: 1, w: 96, l: 62 });
  assert.equal(snap.teams.TEX.seed, 3);   // led the AL West by half a game
  assert.equal(snap.teams.CWS.seed, 6);
  assert.equal(Object.keys(snap.teams).length, 12);
  assert.deepEqual(snap.log, []);
  // Wild card Game 1 is on the calendar before anyone knows who plays it.
  assert.deepEqual(snap.series.AL_WC1.next, { at: "2026-09-29T07:33:00Z", date: "2026-09-29", tbd: true, game: 1 });
});

test("September: the standings table the page draws", () => {
  const { divisions } = build(EVENING).standings;
  assert.deepEqual(Object.keys(divisions).sort(),
    ["AL Central", "AL East", "AL West", "NL Central", "NL East", "NL West"]);
  const east = divisions["AL East"];
  assert.equal(east[0].id, "TB");
  assert.equal(east[0].clinched, true);
  assert.equal(east[0].wcrank, null);
  assert.equal(east[1].id, "NYY");
  assert.equal(east[1].clinched, false);   // clinched a wild card, not the division
  assert.equal(east[1].wcrank, "1");
  assert.deepEqual(Object.keys(east[1]).sort(),
    ["clinched", "elim", "gb", "id", "l", "lead", "magic", "next", "pct", "w", "wce", "wcgb", "wcrank"]);
  assert.deepEqual(east[1].next, { at: "2026-09-24T23:05:00Z", opp: "TB", home: true, tbd: false });
});

test("September: the day's games, in the shape the stamp reads", () => {
  const { slate } = build(EVENING);
  assert.equal(slate.today.date, "2026-09-24");
  assert.equal(slate.today.games.length, 12);
  const states = slate.today.games.map(g => g.state);
  assert.deepEqual([...new Set(states)], ["final", "live", "pre"]);
  const [first] = slate.today.games;
  assert.deepEqual(first, { away: "STL", home: "PIT", state: "final",
    start: "2026-09-24T16:35:00Z", score: [1, 2], end: "2026-09-24T19:17:00Z" });
  const live = slate.today.games.find(g => g.state === "live");
  assert.ok(Number.isInteger(live.inning) && live.score.length === 2 && !live.end);
  assert.equal(slate.nextDay.date, "2026-09-25");
  assert.equal(slate.lastFinal.away, "HOU");
});

test("before 6am Eastern the day being played is still last night", () => {
  const at1am = Date.parse("2026-09-25T05:00:00Z");
  assert.equal(build(EVENING, at1am).slate.today.date, "2026-09-24");
  const at7am = Date.parse("2026-09-25T11:00:00Z");
  const { slate } = build(EVENING, at7am);
  assert.equal(slate.today.date, "2026-09-25");
  assert.equal(slate.lastFinal.state, "final");
});

test("a rainout is neither a final nor on the slate", () => {
  const f = JSON.parse(JSON.stringify(EVENING));
  const day = f.responses.schedule.dates.find(d => d.date === "2026-09-24");
  day.games[0].status = { abstractGameState: "Final", codedGameState: "D", detailedState: "Postponed" };
  const { slate } = build(f);
  assert.equal(slate.today.games.length, 11);
});

test("when to ask again: closely during games, otherwise sleep until the next", () => {
  const at = (games, now = "2026-09-24T22:00:00Z") =>
    S.pollDelay({ slate: { today: { games }, nextDay: null } }, Date.parse(now));
  const MIN = 60 * 1000;
  assert.equal(at([{ state: "live" }, { state: "pre", start: "2026-09-25T02:10:00Z" }]), S.POLL_LIVE_MS);
  // First pitch in ten minutes: already inside the fifteen-minute lead.
  assert.equal(at([{ state: "pre", start: "2026-09-24T22:10:00Z" }]), S.POLL_LIVE_MS);
  // Past its start and still "pre": a delay, so keep watching.
  assert.equal(at([{ state: "pre", start: "2026-09-24T21:05:00Z" }]), S.POLL_LIVE_MS);
  // Between the afternoon finals and a 6:40 first pitch: wake at 6:25.
  assert.equal(at([{ state: "final" }, { state: "pre", start: "2026-09-24T22:40:00Z" }]), 25 * MIN);
  // Hours to the next game: check the schedule hourly in the meantime.
  assert.equal(at([{ state: "final" }, { state: "pre", start: "2026-09-25T17:05:00Z" }]), S.POLL_CHECK_MS);
  // An off day, or a first pitch not yet set: hourly.
  assert.equal(at([]), S.POLL_CHECK_MS);
  assert.equal(at([{ state: "pre", start: "2026-09-24T22:05:00Z", tbd: true }]), S.POLL_CHECK_MS);
  // A finished season: never.
  assert.equal(S.pollDelay({ slate: null }), null);
});

test("an off day with the page open: one look an hour, not a poll", () => {
  const snap = S.buildSnapshot(EVENING.responses, { season: 2026, now: Date.parse("2026-09-25T11:00:00Z") });
  // The morning after: first pitch is hours away.
  assert.equal(S.pollDelay(snap, Date.parse("2026-09-25T11:00:00Z")), S.POLL_CHECK_MS);
});

test("what to fetch: a past season skips the schedule", () => {
  const now = Date.parse("2026-09-24T22:00:00Z");
  assert.equal(S.mlbRequests(2025, now).schedule, null);
  assert.match(S.mlbRequests(2026, now).schedule, /startDate=2026-09-20&endDate=2026-09-28/);
});

test("fetchSnapshot asks for exactly the requests it builds", async () => {
  const f = EVENING;
  const asked = [];
  const req = S.mlbRequests(2026, Date.parse(f.now));
  const byPath = Object.fromEntries(Object.entries(req).map(([k, p]) => [p, f.responses[k]]));
  const snap = await S.fetchSnapshot(async p => { asked.push(p); return byPath[p]; }, 2026, Date.parse(f.now));
  assert.equal(asked.length, 3);
  assert.deepEqual(snap, build(f));
});

test("a snapshot is small enough to poll", () => {
  assert.ok(JSON.stringify(build(EVENING)).length < 20000);
});
