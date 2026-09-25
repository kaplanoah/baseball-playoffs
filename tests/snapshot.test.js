import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as MLBSnapshot from "../page/js/snapshot.js";

const readFixture = (name) =>
  JSON.parse(readFileSync(`${import.meta.dirname}/fixtures/${name}.json`, "utf8"));
const SEASON_2025 = readFixture("2025-final");
const EVENING = readFixture("2026-09-24-evening");
const buildSnapshot = (fixture, now = Date.parse(fixture.now)) =>
  MLBSnapshot.buildSnapshot(fixture.responses, { season: fixture.season, now });

// Games from `cutoff` on become unplayed, with undecided clubs under MLB's placeholder names.
const PLACEHOLDER = {
  CS: ["Lower Seed", "Higher Seed"],
  WS: ["Lower Seed League Champion", "Higher Seed League Champion"],
};
function rewindFixture(fixture, cutoff, { unsetRounds = [], unsetWildCardWinners = false } = {}) {
  const copy = JSON.parse(JSON.stringify(fixture));
  let placeholderId = 9000;
  for (const day of copy.responses.postseason.dates) {
    for (const game of day.games) {
      if (Date.parse(game.gameDate) < Date.parse(cutoff)) continue;
      game.status = {
        abstractGameState: "Preview",
        codedGameState: "S",
        detailedState: "Scheduled",
        startTimeTBD: false,
      };
      delete game.teams.away.score;
      delete game.teams.home.score;
      delete game.gameInfo;
      const league = game.seriesDescription.slice(0, 2);
      const round = { L: "CS", W: "WS" }[game.gameType];
      if (round && unsetRounds.includes(round)) {
        const [lowerSeed, higherSeed] = PLACEHOLDER[round];
        game.teams.away.team = {
          id: placeholderId++,
          name: round === "WS" ? lowerSeed : `${league} ${lowerSeed}`,
        };
        game.teams.home.team = {
          id: placeholderId++,
          name: round === "WS" ? higherSeed : `${league} ${higherSeed}`,
        };
      }
      if (game.gameType === "D" && unsetWildCardWinners) {
        // The wild card winner isn't known yet: "AL 4/5 Winner at Toronto".
        const wildCardSide = [115, 116, 136, 141, 143, 158].includes(game.teams.home.team.id)
          ? "away"
          : "home";
        const wildCardTeamId = game.teams[wildCardSide].team.id;
        const isFromFourFiveSeries = [147, 111, 112, 135].includes(wildCardTeamId); // NYY, BOS, CHC, SD: the 4/5 series
        game.teams[wildCardSide].team = {
          id: placeholderId++,
          name: `${league} ${isFromFourFiveSeries ? "4/5" : "3/6"} Winner`,
        };
      }
    }
  }
  return copy;
}

test("2025: the official field comes from the postseason schedule, seeded", () => {
  const snapshot = buildSnapshot(SEASON_2025);
  assert.equal(snapshot.projected, false);
  const listSeeds = (league) =>
    Object.entries(snapshot.teams)
      .filter(([, team]) => team.league === league)
      .sort((first, second) => first[1].seed - second[1].seed)
      .map(([id]) => id);
  assert.deepEqual(listSeeds("AL"), ["TOR", "SEA", "CLE", "NYY", "BOS", "DET"]);
  assert.deepEqual(listSeeds("NL"), ["MIL", "PHI", "LAD", "CHC", "SD", "CIN"]);
  assert.deepEqual(snapshot.teams.TOR, { league: "AL", seed: 1, w: 94, l: 68 });
});

test("2025: every series record, and no next game once decided", () => {
  const { series } = buildSnapshot(SEASON_2025);
  const readRecord = (id) => [series[id].winsA, series[id].winsB];
  assert.deepEqual(readRecord("AL_WC1"), [1, 2]);
  assert.deepEqual(readRecord("AL_WC2"), [2, 1]);
  assert.deepEqual(readRecord("AL_DS1"), [3, 1]);
  assert.deepEqual(readRecord("AL_DS2"), [3, 2]);
  assert.deepEqual(readRecord("AL_CS"), [4, 3]);
  assert.deepEqual(readRecord("NL_WC1"), [2, 0]);
  assert.deepEqual(readRecord("NL_DS2"), [1, 3]);
  assert.deepEqual(readRecord("NL_CS"), [0, 4]);
  assert.deepEqual(readRecord("WS"), [3, 4]);
  assert.ok(Object.values(series).every((seriesRecord) => !seriesRecord.next));
});

test("2025: the log has every game, oldest first, a clinch closing each series", () => {
  const { log } = buildSnapshot(SEASON_2025);
  assert.equal(log.length, 47);
  assert.equal(log.filter((entry) => entry.kind === "clinch").length, 11);
  assert.ok(
    log.every((entry, index) => !index || Date.parse(log[index - 1].at) <= Date.parse(entry.at)),
  );
  assert.deepEqual(log[0], {
    at: "2025-09-30T19:42:00Z",
    kind: "game",
    series: "AL_WC1",
    won: "DET",
    game: 1,
    score: [1, 0],
  });
  const lastEntry = log[log.length - 1];
  assert.deepEqual(
    { ...lastEntry, at: undefined },
    { at: undefined, kind: "clinch", series: "WS", team: "LAD", over: "TOR", score: [4, 3] },
  );
});

test("a bracket just set: twelve real clubs, division series opponents still placeholders", () => {
  const snapshot = buildSnapshot(
    rewindFixture(SEASON_2025, "2025-09-30T00:00:00Z", {
      unsetRounds: ["CS", "WS"],
      unsetWildCardWinners: true,
    }),
    Date.parse("2025-09-29T16:00:00Z"),
  );
  assert.equal(snapshot.projected, false);
  assert.equal(snapshot.teams.TOR.seed, 1);
  assert.equal(snapshot.teams.DET.seed, 6);
  assert.deepEqual(snapshot.log, []);
  assert.deepEqual(snapshot.series.AL_WC1, {
    winsA: 0,
    winsB: 0,
    next: { at: "2025-09-30T17:08:00Z", date: "2025-09-30", tbd: false, game: 1 },
  });
  // The 4/5 winner goes to the 1 seed: DS1 is Toronto's series.
  assert.equal(snapshot.series.AL_DS1.next.date, "2025-10-04");
  assert.ok(snapshot.series.WS.next);
});

test("halfway: division series under way, the next game named, later rounds waiting", () => {
  const snapshot = buildSnapshot(
    rewindFixture(SEASON_2025, "2025-10-08T12:00:00Z", { unsetRounds: ["CS", "WS"] }),
    Date.parse("2025-10-08T14:00:00Z"),
  );
  const { series } = snapshot;
  assert.deepEqual([series.AL_WC1.winsA, series.AL_WC1.winsB], [1, 2]);
  assert.equal(series.AL_WC1.next, undefined);
  assert.deepEqual([series.AL_DS1.winsA, series.AL_DS1.winsB], [2, 1]);
  assert.equal(series.AL_DS1.next.game, 4);
  assert.deepEqual([series.AL_CS.winsA, series.AL_CS.winsB], [0, 0]);
  assert.equal(snapshot.log.filter((entry) => entry.kind === "clinch").length, 4);
});

test("September: seeds projected from the standings, placeholders ignored", () => {
  const snapshot = buildSnapshot(EVENING);
  assert.equal(snapshot.projected, true);
  assert.deepEqual(snapshot.teams.TB, { league: "AL", seed: 1, w: 96, l: 62 });
  assert.equal(snapshot.teams.TEX.seed, 3);
  assert.equal(snapshot.teams.CWS.seed, 6);
  assert.equal(Object.keys(snapshot.teams).length, 12);
  assert.deepEqual(snapshot.log, []);
  assert.deepEqual(snapshot.series.AL_WC1.next, {
    at: "2026-09-29T07:33:00Z",
    date: "2026-09-29",
    tbd: true,
    game: 1,
  });
});

test("September: the standings table the page draws", () => {
  const { divisions } = buildSnapshot(EVENING).standings;
  assert.deepEqual(Object.keys(divisions).sort(), [
    "AL Central",
    "AL East",
    "AL West",
    "NL Central",
    "NL East",
    "NL West",
  ]);
  const east = divisions["AL East"];
  assert.equal(east[0].id, "TB");
  assert.equal(east[0].clinched, true);
  assert.equal(east[0].wcrank, null);
  assert.equal(east[1].id, "NYY");
  assert.equal(east[1].clinched, false);
  assert.equal(east[1].clinch, "w");

  // MLB's magicNumber reads "-" once a leader clinches a playoff spot, so the
  // magic number comes from the closest chaser's elimination number instead.
  const central = divisions["AL Central"];
  assert.equal(central[0].id, "CLE");
  assert.equal(central[0].magic, "4");
  assert.equal(divisions["AL West"][0].magic, "4");
  assert.equal(east[0].magic, null);
  assert.ok(
    Object.values(divisions)
      .flat()
      .every((row) => row.lead || row.magic === null),
  );
  assert.equal(east[1].wcrank, "1");
  assert.deepEqual(Object.keys(east[1]).sort(), [
    "clinch",
    "clinched",
    "elim",
    "gb",
    "id",
    "l",
    "lead",
    "magic",
    "next",
    "pct",
    "then",
    "w",
    "wce",
    "wcgb",
    "wcrank",
  ]);
  // The in-progress Rays game isn't next. MLB leaves the start of a
  // doubleheader's second game open.
  assert.deepEqual(east[1].next, {
    at: "2026-09-25T20:05:00Z",
    opp: "BAL",
    home: true,
    tbd: false,
  });
  assert.deepEqual(east[1].then, { at: "2026-09-25T20:10:00Z", opp: "BAL", home: true, tbd: true });
});

test("September: the day's games, in the shape the stamp reads", () => {
  const { slate } = buildSnapshot(EVENING);
  assert.equal(slate.today.date, "2026-09-24");
  assert.equal(slate.today.games.length, 12);
  const states = slate.today.games.map((game) => game.state);
  assert.deepEqual([...new Set(states)], ["final", "live", "pre"]);
  const [first] = slate.today.games;
  assert.deepEqual(first, {
    away: "STL",
    home: "PIT",
    state: "final",
    start: "2026-09-24T16:35:00Z",
    score: [1, 2],
    end: "2026-09-24T19:17:00Z",
  });
  const liveGame = slate.today.games.find((game) => game.state === "live");
  assert.ok(Number.isInteger(liveGame.inning) && liveGame.score.length === 2 && !liveGame.end);
  assert.equal(slate.nextDay.date, "2026-09-25");
  assert.equal(slate.lastFinal.away, "HOU");
});

test("before 6am Eastern the day being played is still last night", () => {
  const at1am = Date.parse("2026-09-25T05:00:00Z");
  assert.equal(buildSnapshot(EVENING, at1am).slate.today.date, "2026-09-24");
  const at7am = Date.parse("2026-09-25T11:00:00Z");
  const { slate } = buildSnapshot(EVENING, at7am);
  assert.equal(slate.today.date, "2026-09-25");
  assert.equal(slate.lastFinal.state, "final");
});

test("a rainout is neither a final nor on the slate", () => {
  const fixture = JSON.parse(JSON.stringify(EVENING));
  const day = fixture.responses.schedule.dates.find(
    (scheduleDate) => scheduleDate.date === "2026-09-24",
  );
  day.games[0].status = {
    abstractGameState: "Final",
    codedGameState: "D",
    detailedState: "Postponed",
  };
  const { slate } = buildSnapshot(fixture);
  assert.equal(slate.today.games.length, 11);
});

test("when to ask again: closely during games, otherwise sleep until the next", () => {
  const computePollDelay = (games, now = "2026-09-24T22:00:00Z") =>
    MLBSnapshot.pollDelay({ slate: { today: { games }, nextDay: null } }, Date.parse(now));
  const MINUTE_MS = 60 * 1000;
  assert.equal(
    computePollDelay([{ state: "live" }, { state: "pre", start: "2026-09-25T02:10:00Z" }]),
    MLBSnapshot.POLL_LIVE_MS,
  );
  assert.equal(
    computePollDelay([{ state: "pre", start: "2026-09-24T22:10:00Z" }]),
    MLBSnapshot.POLL_LIVE_MS,
  );
  // Past its start and still "pre" means a delay.
  assert.equal(
    computePollDelay([{ state: "pre", start: "2026-09-24T21:05:00Z" }]),
    MLBSnapshot.POLL_LIVE_MS,
  );
  // 6:00 PM ET now, 6:40 first pitch: wake fifteen minutes early, at 6:25.
  assert.equal(
    computePollDelay([{ state: "final" }, { state: "pre", start: "2026-09-24T22:40:00Z" }]),
    25 * MINUTE_MS,
  );
  assert.equal(
    computePollDelay([{ state: "final" }, { state: "pre", start: "2026-09-25T17:05:00Z" }]),
    MLBSnapshot.POLL_CHECK_MS,
  );
  assert.equal(computePollDelay([]), MLBSnapshot.POLL_CHECK_MS);
  assert.equal(
    computePollDelay([{ state: "pre", start: "2026-09-24T22:05:00Z", tbd: true }]),
    MLBSnapshot.POLL_CHECK_MS,
  );
  assert.equal(MLBSnapshot.pollDelay({ slate: null }), null);
});

test("an off day with the page open: one look an hour, not a poll", () => {
  const snapshot = MLBSnapshot.buildSnapshot(EVENING.responses, {
    season: 2026,
    now: Date.parse("2026-09-25T11:00:00Z"),
  });
  assert.equal(
    MLBSnapshot.pollDelay(snapshot, Date.parse("2026-09-25T11:00:00Z")),
    MLBSnapshot.POLL_CHECK_MS,
  );
});

test("what to fetch: a past season skips the schedule", () => {
  const now = Date.parse("2026-09-24T22:00:00Z");
  assert.equal(MLBSnapshot.mlbRequests(2025, now).schedule, null);
  assert.match(
    MLBSnapshot.mlbRequests(2026, now).schedule,
    /startDate=2026-09-20&endDate=2026-09-28/,
  );
});

test("fetchSnapshot asks for exactly the requests it builds", async () => {
  const fixture = EVENING;
  const asked = [];
  const requests = MLBSnapshot.mlbRequests(2026, Date.parse(fixture.now));
  const byPath = Object.fromEntries(
    Object.entries(requests).map(([key, path]) => [path, fixture.responses[key]]),
  );
  const snapshot = await MLBSnapshot.fetchSnapshot(
    async (path) => {
      asked.push(path);
      return byPath[path];
    },
    2026,
    Date.parse(fixture.now),
  );
  assert.equal(asked.length, 4);
  assert.deepEqual(snapshot, buildSnapshot(fixture));
});

test("a snapshot is small enough to poll", () => {
  assert.ok(JSON.stringify(buildSnapshot(EVENING)).length < 20000);
});

test("a set bracket still builds when a club is missing from the standings", () => {
  const full = buildSnapshot(SEASON_2025);
  const responses = JSON.parse(JSON.stringify(SEASON_2025.responses));
  for (const division of responses.standings.records)
    division.teamRecords = division.teamRecords.filter((record) => record.team.id !== 113);
  const snapshot = MLBSnapshot.buildSnapshot(responses, {
    season: 2025,
    now: Date.parse(SEASON_2025.now),
  });
  assert.equal(snapshot.projected, false);
  assert.deepEqual(snapshot.teams.CIN, { league: "NL", seed: full.teams.CIN.seed });
  assert.deepEqual(snapshot.series, full.series);
});

test("the bracket walk seats seeds and advances winners, 1 against the 4/5 winner", () => {
  const teams = {};
  for (const league of ["AL", "NL"])
    for (let seed = 1; seed <= 6; seed++) teams[`${league}${seed}`] = { league, seed };
  const bracket = MLBSnapshot.resolveBracket(teams, (_, __, teamA) => teamA);
  assert.deepEqual([bracket.AL_WC2.teamA, bracket.AL_WC2.teamB], ["AL4", "AL5"]);
  assert.deepEqual([bracket.AL_DS1.teamA, bracket.AL_DS1.teamB], ["AL1", "AL4"]);
  assert.deepEqual([bracket.AL_DS2.teamA, bracket.AL_DS2.teamB], ["AL2", "AL3"]);
  assert.deepEqual([bracket.WS.teamA, bracket.WS.teamB], ["AL1", "NL1"]);
  assert.equal(MLBSnapshot.findFeederSeries("NL_DS1", 1), "NL_WC2");
  assert.equal(MLBSnapshot.findFeederSeries("NL_DS1", 0), null);
  assert.equal(MLBSnapshot.findFeederSeries("WS", 1), "NL_CS");
});

test("a snapshot carries the day spring training starts", () => {
  assert.equal(buildSnapshot(EVENING).springStart, "2026-02-20");
  assert.equal(buildSnapshot(SEASON_2025).springStart, "2025-02-20");
});

test("a division tied at the top still has a magic number: a tie at the end doesn't clinch", () => {
  const tied = JSON.parse(JSON.stringify(EVENING));
  const alWest = tied.responses.standings.records.find((record) => record.division.id === 200);
  const astros = alWest.teamRecords.find((record) => record.team.id === 117);
  Object.assign(astros, { wins: 79, losses: 80, eliminationNumber: "-", divisionGamesBack: "-" });
  const [leader, chaser] = buildSnapshot(tied).standings.divisions["AL West"];
  assert.deepEqual([leader.id, chaser.id, chaser.elim], ["TEX", "HOU", "-"]);
  assert.equal(leader.magic, "4");
  assert.equal(buildSnapshot(EVENING).standings.divisions["AL West"][0].magic, "4");
});
