import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as WNBASnapshot from "../page/js/snapshot.js";

const AFTERNOON = JSON.parse(
  readFileSync(`${import.meta.dirname}/fixtures/2026-09-30-afternoon.json`, "utf8"),
);
// The afternoon's recording has no players' averages, so the next day's stand in for them.
const GAMES = JSON.parse(
  readFileSync(`${import.meta.dirname}/fixtures/2026-10-01-games.json`, "utf8"),
);
// Where ESPN says the afternoon's games, and the day before's, were on.
const ESPN_SCOREBOARD = JSON.parse(
  readFileSync(`${import.meta.dirname}/fixtures/2026-09-30-espn-scoreboard.json`, "utf8"),
);
const RESPONSES = { ...AFTERNOON.responses, players: GAMES.preview.players };
const buildAfternoon = (responses = RESPONSES) =>
  WNBASnapshot.buildSnapshot(responses, {
    season: AFTERNOON.season,
    now: Date.parse(AFTERNOON.now),
  });

test("a playoff game's ID names its round, series, and game", () => {
  assert.deepEqual(WNBASnapshot.readPlayoffGameId("1042600132"), { round: 1, series: 3, game: 2 });
  assert.deepEqual(WNBASnapshot.readPlayoffGameId("1042600307"), { round: 3, series: 0, game: 7 });
  assert.equal(WNBASnapshot.readPlayoffGameId("1022600097"), null);
});

test("the clock reads as minutes and seconds, and tenths in the last minute", () => {
  assert.equal(WNBASnapshot.readClock("PT04M32.00S"), "4:32");
  assert.equal(WNBASnapshot.readClock("PT10M00.00S"), "10:00");
  assert.equal(WNBASnapshot.readClock("PT00M42.30S"), "42.3");
  assert.equal(WNBASnapshot.readClock(""), null);
});

test("every playoff game is listed in order, with the scoreboard's word on today's", () => {
  const { games } = buildAfternoon();
  assert.equal(games.length, 28);
  assert.ok(games.every((game, index) => index === 0 || game.start >= games[index - 1].start));
  const opener = games.find((game) => game.id === "1042600101");
  assert.deepEqual(
    {
      series: opener.series,
      number: opener.number,
      state: opener.state,
      away: [opener.away.team, opener.away.seed, opener.away.score],
      home: [opener.home.team, opener.home.seed, opener.home.score],
    },
    { series: "1-0", number: 1, state: "final", away: ["NYL", 8, 91], home: ["MIN", 1, 75] },
  );
  const tonight = games.find((game) => game.id === "1042600132");
  assert.equal(tonight.state, "pre");
  assert.equal(tonight.status, "7:00 pm ET");
  assert.equal(tonight.start, "2026-09-30T23:00:00Z");
});

test("a game still to come or under way says where it's on, and a finished one doesn't", () => {
  const { games } = buildAfternoon({
    ...RESPONSES,
    networks: Object.values(ESPN_SCOREBOARD.answers),
  });
  const watchable = games.filter((game) => game.networks.length);
  assert.deepEqual(
    watchable.map((game) => [game.id, game.state, game.networks]),
    [
      ["1042600132", "pre", ["ESPN"]],
      ["1042600112", "pre", ["ESPN"]],
    ],
  );
  const finished = games.filter((game) => game.state === "final");
  assert.ok(finished.length && finished.every((game) => !game.networks.length));
  assert.ok(buildAfternoon().games.every((game) => !game.networks.length));
});

test("a game's national channels come before a team's own", () => {
  const answers = structuredClone(Object.values(ESPN_SCOREBOARD.answers));
  const [competition] = answers[1].events[0].competitions;
  competition.broadcasts = [
    { market: "home", names: ["Monumental"] },
    { market: "national", names: ["ESPN", "Disney+"] },
    { market: "away", names: ["Peachtree TV", "ESPN"] },
  ];
  const { games } = buildAfternoon({ ...RESPONSES, networks: answers });
  const tonight = games.find((game) => game.id === "1042600132");
  assert.deepEqual(tonight.networks, ["ESPN", "Disney+", "Monumental", "Peachtree TV"]);
});

test("a game still to be scheduled says its time isn't set, and a game that may not be played says so", () => {
  const { games } = buildAfternoon();
  const semifinal = games.find((game) => game.id === "1042600201");
  assert.equal(semifinal.isTimeSet, false);
  const deciding = games.find((game) => game.id === "1042600133");
  assert.equal(deciding.isIfNeeded, true);
});

test("each series names its seeds, its wins, its winner, and its next game", () => {
  const { series } = buildAfternoon();
  assert.equal(series.length, 7);
  const [decided, , , , semifinal, , finals] = series;
  assert.deepEqual(decided, {
    id: "1-0",
    round: 1,
    top: { team: "MIN", seed: 1, wins: 0 },
    bottom: { team: "NYL", seed: 8, wins: 2 },
    winner: "NYL",
    status: "NYL wins 2-0",
    nextGame: null,
  });
  assert.deepEqual(semifinal.top, { team: "NYL", seed: 8, wins: 0 });
  assert.equal(semifinal.bottom, null);
  assert.deepEqual([finals.top, finals.bottom], [null, null]);
});

test("without the bracket, a series counts its wins from its finished games", () => {
  const { series, missing } = buildAfternoon({ ...RESPONSES, bracket: null });
  assert.deepEqual(missing, ["bracket"]);
  const decided = series.find((record) => record.id === "1-0");
  assert.deepEqual(
    [decided.top, decided.bottom, decided.winner],
    [{ team: "MIN", seed: 1, wins: 0 }, { team: "NYL", seed: 8, wins: 2 }, "NYL"],
  );
  const semifinal = series.find((record) => record.id === "2-0");
  assert.deepEqual([semifinal.top, semifinal.bottom], [{ team: "NYL", seed: 8, wins: 0 }, null]);
});

// Moments just after a final, when the bracket still had the series as it was before the game.
const readFinal = (name) => {
  const moment = JSON.parse(readFileSync(`${import.meta.dirname}/fixtures/${name}`, "utf8"));
  const responses = { ...RESPONSES, ...moment.responses };
  return WNBASnapshot.buildSnapshot(responses, {
    season: moment.season,
    now: Date.parse(moment.now),
  });
};

test("a series counts a game that just finished before the bracket does", () => {
  const { series } = readFinal("2026-10-01-atlanta-final.json");
  const settled = series.find((record) => record.id === "1-3");
  assert.deepEqual(
    [settled.top, settled.bottom, settled.winner, settled.nextGame],
    [{ team: "ATL", seed: 4, wins: 2 }, { team: "WAS", seed: 5, wins: 0 }, "ATL", null],
  );
});

test("a series whose next game just finished names the game after it", () => {
  const { series } = readFinal("2026-10-01-dallas-final.json");
  const tied = series.find((record) => record.id === "1-1");
  assert.deepEqual(
    [tied.top.wins, tied.bottom.wins, tied.winner, tied.nextGame?.id],
    [1, 1, null, "1042600113"],
  );
});

test("the standings run 1 to 15 across the league, each with its conference place", () => {
  const { standings } = buildAfternoon();
  assert.equal(standings.length, 15);
  assert.deepEqual(
    standings.map((row) => row.team),
    [
      "MIN",
      "GSV",
      "LVA",
      "ATL",
      "WAS",
      "IND",
      "DAL",
      "NYL",
      "PDX",
      "PHX",
      "CHI",
      "LAS",
      "TOR",
      "CON",
      "SEA",
    ],
  );
  const atlanta = standings[3];
  assert.deepEqual(
    [atlanta.conference, atlanta.place, atlanta.conferencePlace, atlanta.wins, atlanta.losses],
    ["East", 4, 1, 30, 14],
  );
  assert.equal(standings[0].clinch, "x");
  assert.equal(standings[8].clinch, "o");
});

test("each team's standing has its points a game, for and against, and its home and road records", () => {
  const { standings } = buildAfternoon();
  const { pointsFor, pointsAgainst, margin, home, road, lastTen } = standings[0];
  assert.deepEqual(
    { pointsFor, pointsAgainst, margin, home, road, lastTen },
    {
      pointsFor: 90.8,
      pointsAgainst: 83.7,
      margin: 7.2,
      home: "15-7",
      road: "18-4",
      lastTen: "6-4",
    },
  );
});

test("each team's top scorer is the one with the most points a game who played most of its games", () => {
  const { leaders } = buildAfternoon();
  assert.equal(leaders.length, 15);
  const lasVegas = leaders.find((leader) => leader.team === "LVA");
  assert.deepEqual(
    [lasVegas.firstName, lasVegas.lastName, lasVegas.points, lasVegas.rebounds],
    ["A'ja", "Wilson", 26.2, 9.4],
  );
});

test("without the players' averages, there are no top scorers, and the feed is missing", () => {
  const { leaders, missing } = buildAfternoon({ ...RESPONSES, players: null });
  assert.deepEqual([leaders, missing], [[], ["players"]]);
});

test("polling waits until 15 minutes before the next set start, and runs every 15 seconds in a game", () => {
  const snapshot = buildAfternoon();
  const now = Date.parse(AFTERNOON.now);
  assert.equal(
    WNBASnapshot.choosePollDelay(snapshot, now),
    Date.parse("2026-09-30T23:00:00Z") - 15 * 60 * 1000 - now,
  );
  const live = {
    games: snapshot.games.map((game) =>
      game.id === "1042600132" ? { ...game, state: "live" } : game,
    ),
  };
  assert.equal(WNBASnapshot.choosePollDelay(live, now), 15 * 1000);
});
