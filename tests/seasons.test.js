import test from "node:test";
import assert from "node:assert/strict";
import { createSeasonParam, serveSeasonSnapshot } from "../shared/worker/seasons.js";

const NOW = Date.parse("2026-09-30T20:00:00Z");

const SEASON_PARAM = createSeasonParam({
  firstSeason: 1997,
  readCurrentSeason: (now) => new Date(now).getUTCFullYear(),
});

const readSeason = (query) => SEASON_PARAM.readSeason(new URLSearchParams(query), NOW);

test("a request's season is the one it names, or the current one when it names none", () => {
  assert.equal(readSeason("season=2024"), 2024);
  assert.equal(readSeason("season=1997"), 1997);
  assert.equal(readSeason("season=2100"), 2100);
  assert.equal(readSeason(""), 2026);
});

test("a season outside the league's years, or not a whole year, isn't one", () => {
  for (const query of ["season=1996", "season=2101", "season=2025.5", "season=next", "season="])
    assert.equal(readSeason(query), null, query);
  assert.equal(SEASON_PARAM.rule, "season must be a whole year between 1997 and 2100");
});

/** @param {string} query @param {(season: number) => Promise<any>} loadSnapshot */
const askSnapshot = (query, loadSnapshot) =>
  serveSeasonSnapshot(new URL(`https://worker.example/key/snapshot?${query}`), {
    seasonParam: SEASON_PARAM,
    loadSnapshot,
    leagueName: "the league",
    now: () => NOW,
  });

test("a snapshot request answers with the season's snapshot", async () => {
  const response = await askSnapshot("season=2025", async (season) => ({ season }));

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.deepEqual(await response.json(), { season: 2025 });
});

test("a snapshot request for a season that isn't one is told the rule", async () => {
  const response = await askSnapshot("season=1900", async () => assert.fail("nothing to load"));

  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { error: SEASON_PARAM.rule });
});

test("a snapshot the league couldn't give names the league and why", async () => {
  const response = await askSnapshot("", async () => {
    throw new Error("The league answered 503");
  });

  assert.equal(response.status, 502);
  assert.deepEqual(await response.json(), {
    error: "Couldn't read the league: The league answered 503",
  });
});
