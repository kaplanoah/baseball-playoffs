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
const DIVISION_SERIES_HOSTS = [136, 141, 143, 158];
// A division series opponent not yet known is named for both clubs that could be it.
const WILD_CARD_PLACEHOLDERS = {
  147: "NYY/BOS",
  111: "NYY/BOS",
  114: "CLE/DET",
  116: "CLE/DET",
  112: "CHC/SD",
  135: "CHC/SD",
  119: "LAD/CIN",
  113: "LAD/CIN",
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
        const wildCardSide = DIVISION_SERIES_HOSTS.includes(game.teams.home.team.id)
          ? "away"
          : "home";
        const wildCardTeamId = game.teams[wildCardSide].team.id;
        game.teams[wildCardSide].team = {
          id: placeholderId++,
          name: WILD_CARD_PLACEHOLDERS[wildCardTeamId],
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

test("2025: a division tied at the end is won by the club MLB's tiebreaker names", () => {
  const [toronto, yankees] = buildSnapshot(SEASON_2025).standings.divisions["AL East"];
  assert.deepEqual([toronto.id, toronto.w, toronto.l], ["TOR", 94, 68]);
  assert.deepEqual([yankees.id, yankees.w, yankees.l], ["NYY", 94, 68]);
  assert.equal(toronto.clinched, true);
  assert.equal(toronto.magic, null);
  assert.equal(yankees.clinched, false);
});

test("2025: MLB calling a wild card club a division champion doesn't move its series", () => {
  const fixture = JSON.parse(JSON.stringify(SEASON_2025));
  const cubs = fixture.responses.standings.records
    .flatMap((division) => division.teamRecords)
    .find((record) => record.team.id === 112);
  cubs.divisionChamp = true;
  const snapshot = buildSnapshot(fixture);
  assert.equal(snapshot.projected, false);
  assert.deepEqual(snapshot.series, buildSnapshot(SEASON_2025).series);
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

test("a game still live past midnight Eastern is its series' next game", () => {
  const fixture = rewindFixture(SEASON_2025, "2025-10-28T00:00:00Z");
  const game3 = fixture.responses.postseason.dates
    .flatMap((day) => day.games)
    .find((game) => game.gameType === "W" && game.seriesGameNumber === 3);
  game3.status = { abstractGameState: "Live", codedGameState: "I", detailedState: "In Progress" };
  const { series } = buildSnapshot(fixture, Date.parse("2025-10-28T05:30:00Z"));
  assert.equal(series.WS.next.date, "2025-10-27");
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

const indexStandingsRows = (snapshot) =>
  Object.fromEntries(
    Object.values(snapshot.standings.divisions)
      .flat()
      .map((row) => [row.id, row]),
  );

test("a bracket just set: each club's next postseason game, opponent or not", () => {
  const snapshot = buildSnapshot(
    rewindFixture(SEASON_2025, "2025-09-30T00:00:00Z", {
      unsetRounds: ["CS", "WS"],
      unsetWildCardWinners: true,
    }),
    Date.parse("2025-09-29T16:00:00Z"),
  );
  const rows = indexStandingsRows(snapshot);
  assert.deepEqual(rows.DET.next, {
    at: "2025-09-30T17:08:00Z",
    date: "2025-09-30",
    opp: "CLE",
    home: false,
    tbd: false,
    postseason: true,
  });
  assert.deepEqual(rows.TOR.next, {
    at: "2025-10-04T20:08:00Z",
    date: "2025-10-04",
    home: true,
    tbd: false,
    postseason: true,
  });
  assert.equal(rows.KC.next, undefined);
});

// MLB can still list game 3 of a wild card series swept in two.
function addUnneededGame(fixture, date) {
  const [unneeded] = fixture.responses.postseason.dates
    .flatMap((day) => day.games)
    .filter(
      (game) => game.seriesDescription === "NL Wild Card Series" && game.teams.home.team.id === 119,
    )
    .map((game) => ({
      ...game,
      gamePk: 1,
      seriesGameNumber: 3,
      officialDate: date,
      gameDate: `${date}T23:08:00Z`,
    }));
  unneeded.status = {
    abstractGameState: "Preview",
    codedGameState: "S",
    detailedState: "Scheduled",
  };
  fixture.responses.postseason.dates.push({ games: [unneeded] });
}

test("halfway: a decided series' unneeded game isn't next, and a club that's out has none", () => {
  const fixture = rewindFixture(SEASON_2025, "2025-10-08T12:00:00Z", { unsetRounds: ["CS", "WS"] });
  addUnneededGame(fixture, "2025-10-02");
  const rows = indexStandingsRows(buildSnapshot(fixture, Date.parse("2025-10-08T14:00:00Z")));
  assert.deepEqual(rows.LAD.next, {
    at: "2025-10-09T01:08:00Z",
    date: "2025-10-08",
    opp: "PHI",
    home: true,
    tbd: false,
    postseason: true,
  });
  assert.deepEqual(rows.TOR.next, {
    at: "2025-10-08T23:08:00Z",
    date: "2025-10-08",
    opp: "NYY",
    home: false,
    tbd: false,
    postseason: true,
  });
  assert.equal(rows.CLE.next, undefined);
});

test("halfway: a decided series' unneeded game isn't in the list of next games", () => {
  const fixture = rewindFixture(SEASON_2025, "2025-10-08T12:00:00Z", { unsetRounds: ["CS", "WS"] });
  addUnneededGame(fixture, "2025-10-10");
  fixture.responses.schedule = { dates: [] };
  const { slate } = buildSnapshot(fixture, Date.parse("2025-10-08T14:00:00Z"));
  assert.ok(slate.next.some((game) => game.home === "LAD" || game.away === "LAD"));
  assert.ok(slate.next.every((game) => game.home !== "CIN" && game.away !== "CIN"));
  assert.ok(slate.previous.some((game) => game.home === "LAD" && game.away === "CIN"));
});

test("the slate marks a postseason game, and only a postseason game", () => {
  const fixture = rewindFixture(SEASON_2025, "2025-10-08T12:00:00Z");
  fixture.responses.schedule = { dates: [] };
  const { slate } = buildSnapshot(fixture, Date.parse("2025-10-08T14:00:00Z"));
  const isMarked = (game) => "postseason" in game && game.postseason === true;
  assert.ok(slate.previous.length && slate.previous.every(isMarked));
  assert.ok(buildSnapshot(EVENING).slate.today.games.every((game) => !("postseason" in game)));
});

test("2025: no club has a next game once the postseason is over", () => {
  const rows = Object.values(indexStandingsRows(buildSnapshot(SEASON_2025)));
  assert.ok(rows.every((row) => !row.next && !row.then));
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
    date: "2026-09-25",
    opp: "BAL",
    home: true,
    tbd: false,
  });
  assert.deepEqual(east[1].then, {
    at: "2026-09-25T20:10:00Z",
    date: "2026-09-25",
    opp: "BAL",
    home: true,
    tbd: true,
  });
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
  assert.deepEqual(
    slate.today.games.filter((game) => game.state === "live").map((game) => game.half),
    ["top", "bottom", "top", "bottom"],
  );
  assert.deepEqual(
    slate.today.games.filter((game) => game.state === "live").map((game) => game.outs),
    [1, 2, 0, 1],
  );
  assert.equal(slate.nextDay.date, "2026-09-25");
  assert.equal(slate.lastFinal.away, "HOU");
});

test("between halves, a live game says whether it's the middle or end of the inning, with no outs", () => {
  const responses = JSON.parse(JSON.stringify(EVENING.responses));
  const liveGames = responses.schedule.dates
    .flatMap((date) => date.games)
    .filter((game) => game.status.abstractGameState === "Live");
  liveGames[0].linescore = { ...liveGames[0].linescore, inningState: "Middle", outs: 3 };
  liveGames[1].linescore = { ...liveGames[1].linescore, inningState: "End", outs: 3 };
  const { slate } = buildSnapshot({ ...EVENING, responses });
  const live = slate.today.games.filter((game) => game.state === "live");
  assert.deepEqual(
    live.map(({ half, outs }) => ({ half, outs })),
    [
      { half: "middle", outs: undefined },
      { half: "end", outs: undefined },
      { half: "top", outs: 0 },
      { half: "bottom", outs: 1 },
    ],
  );
});

test("before 6am Eastern the day being played is still last night while a game is unfinished", () => {
  const at1am = Date.parse("2026-09-25T05:00:00Z");
  assert.equal(buildSnapshot(EVENING, at1am).slate.today.date, "2026-09-24");
  const at7am = Date.parse("2026-09-25T11:00:00Z");
  const { slate } = buildSnapshot(EVENING, at7am);
  assert.equal(slate.today.date, "2026-09-25");
  assert.equal(slate.lastFinal.state, "final");
});

test("once last night's games are all final, today is the new day even before 6am", () => {
  const fixture = JSON.parse(JSON.stringify(EVENING));
  const lastNight = fixture.responses.schedule.dates.find(
    (scheduleDate) => scheduleDate.date === "2026-09-24",
  );
  for (const game of lastNight.games) {
    game.status = { abstractGameState: "Final", codedGameState: "F", detailedState: "Final" };
  }
  const at1am = Date.parse("2026-09-25T05:00:00Z");
  assert.equal(buildSnapshot(fixture, at1am).slate.today.date, "2026-09-25");
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
  assert.deepEqual(
    slate.today.postponed.map((game) => [game.state, game.detail]),
    [["off", "Postponed"]],
  );
});

test("a game in warmup hasn't started, though MLB calls it live", () => {
  const fixture = JSON.parse(JSON.stringify(EVENING));
  const day = fixture.responses.schedule.dates.find(
    (scheduleDate) => scheduleDate.date === "2026-09-24",
  );
  const warmingUp = day.games.find((game) => game.status.abstractGameState === "Live");
  warmingUp.status = {
    ...warmingUp.status,
    abstractGameState: "Live",
    codedGameState: "P",
    detailedState: "Warmup",
  };
  warmingUp.linescore = { currentInning: 1, inningState: "Top", inningHalf: "Top", outs: 0 };
  const { slate } = buildSnapshot(fixture);
  const game = slate.today.games.find((summary) => summary.start === warmingUp.gameDate);
  assert.equal(game.state, "pre");
  assert.equal(game.inning, undefined);
  assert.equal(game.outs, undefined);
});

test("a delay before or during a game carries its cause", () => {
  const fixture = JSON.parse(JSON.stringify(EVENING));
  const day = fixture.responses.schedule.dates.find(
    (scheduleDate) => scheduleDate.date === "2026-09-24",
  );
  const [upcoming, underway] = [
    day.games.find((game) => game.status.abstractGameState === "Preview"),
    day.games.find((game) => game.status.abstractGameState === "Live"),
  ];
  upcoming.status = {
    ...upcoming.status,
    codedGameState: "P",
    detailedState: "Delayed Start",
    reason: "Rain",
  };
  underway.status = { ...underway.status, codedGameState: "I", detailedState: "Delayed" };
  const { slate } = buildSnapshot(fixture);
  const delays = slate.today.games
    .filter((game) => game.delay)
    .map((game) => [game.state, game.delay]);
  assert.deepEqual(delays.sort(), [
    ["live", "Delayed"],
    ["pre", "Delayed: Rain"],
  ]);
});

const listClubsIn = (games) => games.flatMap((game) => [game.away, game.home]).filter(Boolean);
const describeGame = (game) =>
  `${game.date} ${game.away}@${game.home}` + (game.doubleheader ? ` G${game.doubleheader}` : "");

test("previous and next: every game on the dates of each club's last and first game", () => {
  const { slate } = buildSnapshot(EVENING);
  for (const games of [slate.previous, slate.next]) {
    assert.equal(new Set(listClubsIn(games)).size, 30);
    assert.equal(new Set(games.map(describeGame)).size, games.length);
  }
  assert.ok(slate.previous.every((game) => game.date < "2026-09-24" && game.state === "final"));
  assert.ok(slate.next.every((game) => game.date > "2026-09-24" && game.state === "pre"));
});

test("a date in previous or next lists all its games, not only each club's last or first", () => {
  const { slate } = buildSnapshot(EVENING);
  const previous = slate.previous.map(describeGame);
  assert.ok(previous.includes("2026-09-23 TOR@BAL G1"));
  assert.ok(previous.includes("2026-09-23 TOR@BAL G2"));
  const next = slate.next.map(describeGame);
  for (const doubleheader of ["CHC@BOS", "BAL@NYY"]) {
    assert.ok(next.includes(`2026-09-25 ${doubleheader} G1`));
    assert.ok(next.includes(`2026-09-25 ${doubleheader} G2`));
  }
});

test("a postseason game counts as next before its opponent is known", () => {
  const fixture = JSON.parse(JSON.stringify(EVENING));
  const [firstGame] = fixture.responses.postseason.dates
    .flatMap((day) => day.games)
    .filter((game) => game.gameType === "D");
  firstGame.teams.home.team = { id: 139, name: "Tampa Bay Rays" };
  const now = Date.parse("2026-09-30T16:00:00Z");
  const { slate } = buildSnapshot(fixture, now);
  const next = slate.next.find((game) => game.home === "TB");
  assert.equal(next.away, null);
  assert.equal(next.date, firstGame.officialDate);
  assert.ok(slate.previous.some((game) => listClubsIn([game]).includes("TB")));
});

test("when to ask again: closely during games, otherwise sleep until the next", () => {
  const computePollDelay = (games, now = "2026-09-24T22:00:00Z") =>
    MLBSnapshot.choosePollDelay({ slate: { today: { games }, nextDay: null } }, Date.parse(now));
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
  assert.equal(MLBSnapshot.choosePollDelay({ slate: null }), null);
});

test("a game with no start time doesn't make the next ask come at once", () => {
  const games = [{ state: "pre" }, { state: "pre", start: "2026-09-25T17:05:00Z" }];
  assert.equal(
    MLBSnapshot.choosePollDelay(
      { slate: { today: { games }, nextDay: null } },
      Date.parse("2026-09-24T22:00:00Z"),
    ),
    MLBSnapshot.POLL_CHECK_MS,
  );
});

test("an off day with the page open: one look an hour, not a poll", () => {
  const snapshot = MLBSnapshot.buildSnapshot(EVENING.responses, {
    season: 2026,
    now: Date.parse("2026-09-25T11:00:00Z"),
  });
  assert.equal(
    MLBSnapshot.choosePollDelay(snapshot, Date.parse("2026-09-25T11:00:00Z")),
    MLBSnapshot.POLL_CHECK_MS,
  );
});

test("what to fetch: a past season skips the schedule", () => {
  const now = Date.parse("2026-09-24T22:00:00Z");
  assert.equal(MLBSnapshot.listMlbRequests(2025, now).schedule, null);
  assert.match(
    MLBSnapshot.listMlbRequests(2026, now, "2026-09-27").schedule,
    /startDate=2026-09-20&endDate=2026-09-28/,
  );
});

test("what to fetch: in October the schedule reaches back to the regular season's last days", () => {
  const now = Date.parse("2026-10-20T16:00:00Z");
  assert.match(
    MLBSnapshot.listMlbRequests(2026, now, "2026-09-27").schedule,
    /startDate=2026-09-24&endDate=2026-10-24/,
  );
});

test("fetchSnapshot asks for exactly the requests it builds", async () => {
  const fixture = EVENING;
  const asked = [];
  const regularSeasonEnd = fixture.responses.season.seasons[0].regularSeasonEndDate;
  const requests = MLBSnapshot.listMlbRequests(2026, Date.parse(fixture.now), regularSeasonEnd);
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
  assert.equal(asked[0], requests.season);
  assert.deepEqual(snapshot, buildSnapshot(fixture));
});

// Starters as MLB names them on the schedule, keyed by game, and its answer about them.
function addStarters(fixture, probables, people) {
  const copy = structuredClone(fixture);
  for (const game of copy.responses.schedule.dates.flatMap((date) => date.games)) {
    const [away, home] = probables[game.gamePk] || [];
    if (away) game.teams.away.probablePitcher = { id: away };
    if (home) game.teams.home.probablePitcher = { id: home };
  }
  copy.responses.pitchers = { people };
  return copy;
}
const describePerson = (id, useLastName, hand, era) => ({
  id,
  useLastName,
  pitchHand: { code: hand },
  ...(era && { stats: [{ splits: [{ stat: { era } }] }] }),
});
const findSlateGame = (snapshot, away, home) =>
  [
    ...snapshot.slate.today.games,
    ...(snapshot.slate.nextDay?.games || []),
    ...snapshot.slate.next,
  ].find((game) => game.away === away && game.home === home);

const EVENING_STARTERS = {
  823326: [1, 2], // STL at PIT, final
  824707: [3, 4], // CLE at BOS, live
  823895: [5, null], // SD at LAD, not started
  824703: [6, null], // CHC at BOS, tomorrow
};
const EVENING_PEOPLE = [
  describePerson(1, "Liberatore", "L", "4.10"),
  describePerson(2, "Keller", "R", "3.40"),
  describePerson(3, "Bibee", "R", "3.62"),
  describePerson(4, "Crochet", "L", "2.51"),
  describePerson(5, "King", "R", null),
];

test("starters: a game still to finish names each club's starter, his arm, and his ERA", () => {
  const snapshot = buildSnapshot(addStarters(EVENING, EVENING_STARTERS, EVENING_PEOPLE));
  assert.deepEqual(findSlateGame(snapshot, "CLE", "BOS").starters, [
    { id: 3, name: "Bibee", hand: "R", era: "3.62" },
    { id: 4, name: "Crochet", hand: "L", era: "2.51" },
  ]);
  assert.deepEqual(findSlateGame(snapshot, "SD", "LAD").starters, [
    { id: 5, name: "King", hand: "R", era: null },
    null,
  ]);
  assert.deepEqual(snapshot.missing, []);
});

test("starters: a finished game names none, and one MLB couldn't describe keeps his id", () => {
  const snapshot = buildSnapshot(addStarters(EVENING, EVENING_STARTERS, EVENING_PEOPLE));
  const finished = snapshot.slate.today.games.find(
    (game) => game.away === "STL" && game.home === "PIT",
  );
  assert.equal(finished.state, "final");
  assert.equal(finished.starters, undefined);
  assert.deepEqual(findSlateGame(snapshot, "CHC", "BOS").starters, [{ id: 6 }, null]);
});

test("fetchSnapshot looks up the listed games' starters in one sorted request", async () => {
  const fixture = addStarters(EVENING, EVENING_STARTERS, EVENING_PEOPLE);
  const regularSeasonEnd = fixture.responses.season.seasons[0].regularSeasonEndDate;
  const requests = MLBSnapshot.listMlbRequests(2026, Date.parse(fixture.now), regularSeasonEnd);
  const pitcherRequest = MLBSnapshot.listPitcherRequest(2026, [3, 4, 5, 6]);
  const byPath = {
    ...Object.fromEntries(
      Object.entries(requests).map(([key, path]) => [path, fixture.responses[key]]),
    ),
    [pitcherRequest]: fixture.responses.pitchers,
  };
  const asked = [];
  const snapshot = await MLBSnapshot.fetchSnapshot(
    async (path) => {
      asked.push(path);
      return byPath[path];
    },
    2026,
    Date.parse(fixture.now),
  );
  assert.equal(asked.at(-1), pitcherRequest);
  assert.match(pitcherRequest, /personIds=3,4,5,6&/);
  assert.deepEqual(snapshot, buildSnapshot(fixture));
});

test("fetchSnapshot still builds the games when MLB can't name their starters", async () => {
  const fixture = addStarters(EVENING, EVENING_STARTERS, EVENING_PEOPLE);
  const regularSeasonEnd = fixture.responses.season.seasons[0].regularSeasonEndDate;
  const requests = MLBSnapshot.listMlbRequests(2026, Date.parse(fixture.now), regularSeasonEnd);
  const byPath = Object.fromEntries(
    Object.entries(requests).map(([key, path]) => [path, fixture.responses[key]]),
  );
  const snapshot = await MLBSnapshot.fetchSnapshot(
    async (path) => {
      if (!byPath[path]) throw new Error("MLB Stats API answered 503");
      return byPath[path];
    },
    2026,
    Date.parse(fixture.now),
  );
  assert.deepEqual(findSlateGame(snapshot, "CLE", "BOS").starters, [{ id: 3 }, { id: 4 }]);
  assert.deepEqual(snapshot.missing, []);
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

test("standings missing a division are no standings, and project no field", () => {
  for (const [keep, missing] of [
    [() => false, false],
    [(record) => record.division.id !== 200, true],
  ]) {
    const fixture = JSON.parse(JSON.stringify(EVENING));
    fixture.responses.standings.records = fixture.responses.standings.records.filter(keep);
    const snapshot = buildSnapshot(fixture);
    assert.equal(snapshot.standings, null);
    assert.equal(snapshot.projected, true);
    assert.equal(MLBSnapshot.hasKnownField(snapshot), false);
    assert.equal(snapshot.missing.includes("records"), missing);
  }
  assert.equal(MLBSnapshot.hasKnownField(buildSnapshot(EVENING)), true);
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

test("a division is won only once every other club in it is out of the race, whatever MLB flags", () => {
  const flagged = JSON.parse(JSON.stringify(EVENING));
  const alEast = flagged.responses.standings.records.find((record) => record.division.id === 201);
  const yankees = alEast.teamRecords.find((record) => record.team.id === 147);
  Object.assign(yankees, { divisionChamp: true, clinchIndicator: "y" });
  const [leader, wildCard] = buildSnapshot(flagged).standings.divisions["AL East"];
  assert.deepEqual([leader.id, leader.clinched], ["TB", true]);
  assert.deepEqual([wildCard.id, wildCard.clinched], ["NYY", false]);
  assert.equal(buildSnapshot(EVENING).standings.divisions["AL Central"][0].clinched, false);
});
