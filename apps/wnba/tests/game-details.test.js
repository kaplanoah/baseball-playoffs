import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  createBoxScoreServer,
  describeBoxScore,
  nameBoxScoreRequest,
} from "../worker/src/box-score.js";
import {
  createPreviewServer,
  describePreview,
  listPreviewRequests,
} from "../worker/src/preview.js";

const GAMES = JSON.parse(
  readFileSync(`${import.meta.dirname}/fixtures/2026-10-01-games.json`, "utf8"),
);
const NOW = Date.parse(GAMES.now);
const PREVIEW_REQUESTS = listPreviewRequests(2026);
// Aces at Fever, Game 2, and Valkyries at Wings, Game 2, which went to overtime.
const ACES_AT_FEVER = "1042600122";
const VALKYRIES_AT_WINGS = "1042600112";

/**
 * Answers the league's feeds from the fixture, recording each read, with any feed refused.
 * @param {{ refuse?: Record<string, number | "page" | "empty"> }} [options] a refused feed's status, by URL
 */
function createLeague({ refuse = {} } = {}) {
  const answers = new Map([
    ...Object.entries(GAMES.boxScores).map(
      ([id, box]) => /** @type {[string, any]} */ ([nameBoxScoreRequest(id), box]),
    ),
    ...Object.entries(PREVIEW_REQUESTS).map(
      ([name, url]) => /** @type {[string, any]} */ ([url, GAMES.preview[name]]),
    ),
  ]);
  const reads = [];
  const fetchImpl = async (url, init) => {
    reads.push({ url, init });
    if (refuse[url] === "page") return new Response("<!DOCTYPE html><html></html>");
    if (refuse[url] === "empty") return new Response(JSON.stringify({ meta: { code: 200 } }));
    if (refuse[url]) return new Response("<Error/>", { status: refuse[url] });
    if (!answers.has(url)) return new Response("<Error/>", { status: 403 });
    return new Response(JSON.stringify(answers.get(url)));
  };
  return { reads, fetchImpl };
}

const askBoxScore = (server, query) =>
  server.serveBoxScore(new URL(`https://app.example/k3y/box-score?${query}`));
const askPreview = (server, query) =>
  server.servePreview(new URL(`https://app.example/k3y/preview?${query}`));

test("a box score gives each team's points by quarter, its stats, and the players who got in", () => {
  const box = describeBoxScore(GAMES.boxScores[ACES_AT_FEVER]);

  assert.equal(box.state, "final");
  assert.deepEqual(
    [box.away.team, box.away.score, box.home.team, box.home.score],
    ["LVA", 89, "IND", 99],
  );
  assert.deepEqual(box.home.periods, [18, 30, 24, 27]);
  assert.deepEqual(box.home.stats.fieldGoals, [37, 71]);
  assert.deepEqual(box.home.stats.threePointers, [8, 21]);
  assert.equal(box.home.stats.paintPoints, 58);
  const roster = GAMES.boxScores[ACES_AT_FEVER].game.homeTeam.players;
  const played = roster.filter((player) => player.played === "1");
  assert.ok(played.length < roster.length);
  assert.equal(box.home.players.length, played.length);
  const hull = box.home.players.find((player) => player.lastName === "Hull");
  assert.deepEqual(hull, {
    id: 1631086,
    firstName: "Lexie",
    lastName: "Hull",
    minutes: 26,
    points: 4,
    rebounds: 7,
    assists: 1,
    fouls: 3,
  });
});

test("a box score keeps a fifth period for overtime", () => {
  const box = describeBoxScore(GAMES.boxScores[VALKYRIES_AT_WINGS]);
  assert.deepEqual(box.away.periods, [26, 19, 29, 19, 7]);
  assert.equal(box.period, 5);
});

test("the box score route reads the league's CDN as its own site would, briefly cached", async () => {
  const league = createLeague();
  const server = createBoxScoreServer({ fetchImpl: league.fetchImpl });

  const response = await askBoxScore(server, `id=${ACES_AT_FEVER}`);

  assert.equal(response.status, 200);
  assert.equal((await response.json()).home.team, "IND");
  const [{ url, init }] = league.reads;
  assert.equal(url, nameBoxScoreRequest(ACES_AT_FEVER));
  assert.equal(init.headers.referer, "https://www.wnba.com/");
  assert.equal(init.cf.cacheTtl, 5);
});

test("a game without a box score yet is a 404, and a league that fails is a 502", async () => {
  const notStarted = await askBoxScore(
    createBoxScoreServer({ fetchImpl: createLeague().fetchImpl }),
    "id=1042600123",
  );
  assert.equal(notStarted.status, 404);
  assert.match((await notStarted.json()).error, /no box score for that game yet/);

  const url = nameBoxScoreRequest(ACES_AT_FEVER);
  for (const refusal of /** @type {(number | "page" | "empty")[]} */ ([503, "page", "empty"])) {
    const league = createLeague({ refuse: { [url]: refusal } });
    const response = await askBoxScore(
      createBoxScoreServer({ fetchImpl: league.fetchImpl }),
      `id=${ACES_AT_FEVER}`,
    );
    assert.equal(response.status, 502);
    assert.match((await response.json()).error, /^Couldn't read the WNBA: /);
  }
});

test("a box score id that isn't a game's is refused before reading the league", async () => {
  const league = createLeague();
  const server = createBoxScoreServer({ fetchImpl: league.fetchImpl });
  for (const query of ["", "id=12", "id=../../x", "id=1042600122x"]) {
    assert.equal((await askBoxScore(server, query)).status, 400);
  }
  assert.equal(league.reads.length, 0);
});

test("a preview lists the teams' finished meetings this season, newest first, playoffs included", () => {
  const preview = describePreview(GAMES.preview, { season: 2026, away: "IND", home: "LVA" });

  assert.deepEqual(
    preview.meetings.map(({ round, number, away, home }) => [
      round,
      number,
      `${away.team} ${away.score}`,
      `${home.team} ${home.score}`,
    ]),
    [
      [1, 2, "LVA 89", "IND 99"],
      [1, 1, "IND 85", "LVA 102"],
      [null, null, "LVA 86", "IND 84"],
      [null, null, "IND 109", "LVA 75"],
      [null, null, "IND 84", "LVA 68"],
    ],
  );
});

test("a preview leaves out the preseason, games not yet played, and another season's schedule", () => {
  const schedule = structuredClone(GAMES.preview.schedule);
  const games = schedule.leagueSchedule.gameDates.flatMap((day) => day.games);
  const meetings = describePreview(GAMES.preview, {
    season: 2026,
    away: "DAL",
    home: "GSV",
  }).meetings;
  assert.ok(meetings.every((meeting) => !meeting.id.startsWith("101")));
  assert.ok(!meetings.some((meeting) => meeting.id === "1042600113"));
  assert.ok(games.some((game) => game.gameId === "1042600113" && game.gameStatus === 1));

  schedule.leagueSchedule.seasonYear = "2025";
  const lastSeason = describePreview(
    { ...GAMES.preview, schedule },
    { season: 2026, away: "DAL", home: "GSV" },
  );
  assert.equal(lastSeason.meetings, null);
});

test("a preview compares the two seasons from the standings", () => {
  const preview = describePreview(GAMES.preview, { season: 2026, away: "GSV", home: "DAL" });
  assert.deepEqual(preview.away.season, {
    wins: 32,
    losses: 12,
    pointsFor: 82.2,
    pointsAgainst: 75.1,
    margin: 7,
    home: "17-5",
    road: "15-7",
    lastTen: "7-3",
  });
  assert.equal(preview.home.season.home, "16-6");
});

test("a preview names each team's three leading scorers among its regulars", () => {
  const preview = describePreview(GAMES.preview, { season: 2026, away: "IND", home: "LVA" });
  assert.deepEqual(
    preview.away.leaders.map((leader) => `${leader.firstName} ${leader.lastName}`),
    ["Kelsey Mitchell", "Caitlin Clark", "Aliyah Boston"],
  );
  assert.deepEqual(preview.home.leaders[0], {
    id: 1628932,
    firstName: "A'ja",
    lastName: "Wilson",
    games: 41,
    points: 26.2,
    rebounds: 9.4,
    assists: 3.2,
  });

  const players = structuredClone(GAMES.preview.players);
  const table = players.resultSets[0];
  const column = Object.fromEntries(table.headers.map((header, index) => [header, index]));
  const mitchell = table.rowSet.find((row) => row[column.PLAYER_NAME] === "Kelsey Mitchell");
  mitchell[column.GP] = 10;
  const fewGames = describePreview(
    { ...GAMES.preview, players },
    { season: 2026, away: "IND", home: "LVA" },
  );
  assert.ok(!fewGames.away.leaders.some((leader) => leader.lastName === "Mitchell"));
});

test("the preview route reads its feeds for an hour at a time, each part on its own", async () => {
  const league = createLeague({
    refuse: { [PREVIEW_REQUESTS.players]: 503, [PREVIEW_REQUESTS.standings]: "empty" },
  });
  const server = createPreviewServer({ fetchImpl: league.fetchImpl, now: () => NOW });

  const response = await askPreview(server, "season=2026&away=IND&home=LVA");

  assert.equal(response.status, 200);
  const preview = await response.json();
  assert.equal(preview.meetings.length, 5);
  assert.equal(preview.away.season, null);
  assert.equal(preview.away.leaders, null);
  assert.deepEqual(
    league.reads.map((read) => read.url).sort(),
    Object.values(PREVIEW_REQUESTS).sort(),
  );
  assert.ok(league.reads.every((read) => read.init.cf.cacheTtl === 60 * 60));
});

test("a preview with no feed answering is a 502", async () => {
  const refuse = Object.fromEntries(Object.values(PREVIEW_REQUESTS).map((url) => [url, 503]));
  const server = createPreviewServer({
    fetchImpl: createLeague({ refuse }).fetchImpl,
    now: () => NOW,
  });
  const response = await askPreview(server, "season=2026&away=IND&home=LVA");
  assert.equal(response.status, 502);
});

test("a preview needs two different teams and a season, and is refused before reading otherwise", async () => {
  const league = createLeague();
  const server = createPreviewServer({ fetchImpl: league.fetchImpl, now: () => NOW });
  for (const query of [
    "away=IND",
    "away=IND&home=IND",
    "away=IND&home=XYZ",
    "away=IND&home=LVA&season=x",
  ]) {
    assert.equal((await askPreview(server, query)).status, 400, query);
  }
  assert.equal(league.reads.length, 0);
});
