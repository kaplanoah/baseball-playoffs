import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as WNBASnapshot from "../page/js/snapshot.js";

const AFTERNOON = JSON.parse(
  readFileSync(`${import.meta.dirname}/fixtures/2026-09-30-afternoon.json`, "utf8"),
);
const buildAfternoon = (responses = AFTERNOON.responses) =>
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
  const { series, missing } = buildAfternoon({ ...AFTERNOON.responses, bracket: null });
  assert.deepEqual(missing, ["bracket"]);
  const decided = series.find((record) => record.id === "1-0");
  assert.deepEqual(
    [decided.top, decided.bottom, decided.winner],
    [{ team: "MIN", seed: 1, wins: 0 }, { team: "NYL", seed: 8, wins: 2 }, "NYL"],
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

test("polling waits until 15 minutes before the next set start, and runs every 30 seconds in a game", () => {
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
  assert.equal(WNBASnapshot.choosePollDelay(live, now), WNBASnapshot.POLL_LIVE_MS);
});
