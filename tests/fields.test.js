import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import * as MLBSnapshot from "../page/js/snapshot.js";

const readFixture = (name) =>
  JSON.parse(readFileSync(path.join(import.meta.dirname, "fixtures", `${name}.json`), "utf8"));
const EVENING = readFixture("2026-09-24-evening");
const SEASON_2025 = readFixture("2025-final");
const copy = (value) => JSON.parse(JSON.stringify(value));
const listGames = (schedule) => schedule.dates.flatMap((date) => date.games);
const listClubs = (standings) => standings.records.flatMap((division) => division.teamRecords);

test("every field the requests ask for has a rule", () => {
  const requests = MLBSnapshot.mlbRequests(2026, Date.parse(EVENING.now));
  const requested = Object.values(requests).flatMap((request) =>
    new URL(request, MLBSnapshot.MLB_API).searchParams.get("fields").split(","),
  );
  assert.deepEqual(
    requested.filter((field) => !MLBSnapshot.CHECKED_FIELDS.includes(field)),
    [],
  );
});

test("the recorded seasons have nothing missing", () => {
  for (const fixture of [EVENING, SEASON_2025]) {
    const snapshot = MLBSnapshot.buildSnapshot(fixture.responses, {
      season: fixture.season,
      now: Date.parse(fixture.now),
    });
    assert.deepEqual(snapshot.missing, []);
  }
});

test("a field MLB stops sending is named, once", () => {
  const responses = copy(EVENING.responses);
  for (const game of listGames(responses.schedule)) delete game.officialDate;
  for (const game of listGames(responses.postseason)) delete game.officialDate;
  for (const club of listClubs(responses.standings)) delete club.wildCardRank;
  assert.deepEqual(MLBSnapshot.findMissingFields(responses), ["wildCardRank", "officialDate"]);
});

test("a field the code can do without on one game is missing only once it's gone from all", () => {
  const responses = copy(EVENING.responses);
  const finals = listGames(responses.schedule).filter((game) => game.status.codedGameState === "F");
  delete finals[0].gameInfo;
  assert.deepEqual(MLBSnapshot.findMissingFields(responses), []);
  finals.forEach((game) => delete game.gameInfo);
  assert.deepEqual(MLBSnapshot.findMissingFields(responses), [
    "gameInfo.firstPitch",
    "gameInfo.gameDurationMinutes",
  ]);
});

test("a postseason series that stops naming its league is flagged", () => {
  const responses = copy(EVENING.responses);
  listGames(responses.postseason)[0].seriesDescription = "Wild Card Series";
  assert.deepEqual(MLBSnapshot.findMissingFields(responses), ["seriesDescription"]);
});

test("no games or standings yet is fine; no dates or records at all is not", () => {
  const empty = {
    season: { seasons: [{ springStartDate: "2026-02-20" }] },
    standings: { records: [] },
    postseason: { dates: [] },
    schedule: { dates: [] },
  };
  assert.deepEqual(MLBSnapshot.findMissingFields(empty), []);
  assert.deepEqual(
    MLBSnapshot.findMissingFields({ season: {}, standings: {}, postseason: {}, schedule: null }),
    ["seasons", "records", "dates"],
  );
});
