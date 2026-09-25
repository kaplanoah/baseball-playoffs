const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const MLBSnapshot = require("../page/js/snapshot.js");

const loadChecker = import("../scripts/check-mlb.mjs");
const readFixture = (name) =>
  JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures", `${name}.json`), "utf8"));
const EVENING = readFixture("2026-09-24-evening");
const SEASON_2025 = readFixture("2025-final");
const NOW = Date.parse(EVENING.now);
const CONNECTOR = "https://connector.example/mcp";

const replyWith = (body, status = 200) => new Response(JSON.stringify(body), { status });

function createFakeFetch(responses, { mlbStatus = 200, connectorError = null } = {}) {
  return async (url, init = {}) => {
    if (url === CONNECTOR) {
      const message = JSON.parse(init.body);
      if (message.method === "initialize")
        return replyWith({
          jsonrpc: "2.0",
          id: message.id,
          result: { serverInfo: { name: "mlb-live" } },
        });
      const result = connectorError
        ? { isError: true, content: [{ type: "text", text: connectorError }] }
        : { structuredContent: MLBSnapshot.buildSnapshot(responses, { season: 2026, now: NOW }) };
      return replyWith({ jsonrpc: "2.0", id: message.id, result });
    }
    const kind = url.includes("/standings")
      ? "standings"
      : url.includes("/postseason")
        ? "postseason"
        : "schedule";
    return replyWith(responses[kind], kind === "standings" ? mlbStatus : 200);
  };
}

async function runChecker(responses, options = {}) {
  const { checkMlb } = await loadChecker;
  const lines = [];
  const passed = await checkMlb({
    fetchImpl: createFakeFetch(responses, options),
    now: options.now || NOW,
    connectorUrl: options.connectorUrl || "",
    print: (line) => lines.push(line),
    retryMs: 0,
  });
  const findLine = (name) => lines.find((line) => line.slice(6).startsWith(name));
  return { passed, lines, findLine };
}

const copy = (value) => JSON.parse(JSON.stringify(value));
const listGames = (response) => response.dates.flatMap((date) => date.games);

test("every field the requests ask for is checked", async () => {
  const { CHECKED_FIELDS } = await loadChecker;
  const requested = Object.values(MLBSnapshot.mlbRequests(2026, NOW)).flatMap((request) =>
    new URL(request, MLBSnapshot.MLB_API).searchParams.get("fields").split(","),
  );
  assert.deepEqual(
    requested.filter((field) => !CHECKED_FIELDS.has(field)),
    [],
  );
});

test("the evening of 24 September 2026 passes, connector included", async () => {
  const run = await runChecker(EVENING.responses, { connectorUrl: CONNECTOR });
  assert.equal(run.passed, true, run.lines.join("\n"));
  assert.match(
    run.findLine("schedule fields"),
    /^ok {4}.*107 games \(54 final, 4 live, 48 pre, 1 off\)/,
  );
  assert.match(run.findLine("snapshot field"), /projected, 12 clubs seeded/);
  assert.match(run.findLine("connector get_snapshot"), /^ok/);
  assert.equal(run.lines.at(-1), "MLB check passed.");
});

test("the finished 2025 season: an official field and no slate", async () => {
  const { checkStandings, checkGames, checkSnapshot } = await loadChecker;
  const { responses, season } = SEASON_2025;
  assert.equal(checkStandings(responses.standings, season).status, "ok");
  assert.equal(checkGames("postseason", responses.postseason).detail, "47 games (47 final)");
  const results = checkSnapshot(responses, { season, now: NOW });
  assert.deepEqual(
    results.filter((result) => result.status !== "ok"),
    [],
  );
  const detailOf = (name) => results.find((result) => result.name === name).detail;
  assert.equal(detailOf("snapshot field"), "official, 12 clubs seeded");
  assert.equal(detailOf("pollDelay"), "never (season over)");
});

test("a field MLB stops sending fails, naming it", async () => {
  const responses = copy(EVENING.responses);
  for (const game of listGames(responses.schedule)) delete game.officialDate;
  for (const division of responses.standings.records)
    for (const record of division.teamRecords) delete record.wildCardRank;
  const run = await runChecker(responses);
  assert.equal(run.passed, false);
  assert.match(
    run.findLine("schedule fields"),
    /^FAIL {2}.*officialDate missing .* on 107 of 107 games/,
  );
  assert.match(
    run.findLine("standings fields"),
    /^FAIL {2}.*wildCardRank missing .* on 24 of 24 clubs/,
  );
  assert.match(run.lines.at(-1), /^MLB check failed: standings fields, schedule fields/);
});

test("a field the code can do without on one game fails only once it is gone from all", async () => {
  const { checkGames } = await loadChecker;
  const schedule = copy(EVENING.responses.schedule);
  const finals = listGames(schedule).filter((game) => game.status.codedGameState === "F");
  delete finals[0].gameInfo;
  assert.equal(checkGames("schedule", schedule).status, "ok");
  finals.forEach((game) => delete game.gameInfo);
  assert.match(checkGames("schedule", schedule).detail, /gameInfo.firstPitch missing/);
});

test("a postseason series that stops naming its league fails", async () => {
  const { checkGames } = await loadChecker;
  const postseason = copy(EVENING.responses.postseason);
  listGames(postseason)[0].seriesDescription = "Wild Card Series";
  assert.match(
    checkGames("postseason", postseason).detail,
    /seriesDescription missing .* on 1 of 46 games/,
  );
});

test("no games is fine; no `dates` at all is not", async () => {
  const { checkGames } = await loadChecker;
  assert.deepEqual(checkGames("schedule", { dates: [] }), {
    name: "schedule fields",
    status: "ok",
    detail: "no games in the window",
  });
  assert.equal(checkGames("schedule", {}).status, "fail");
  assert.equal(checkGames("schedule", { dates: [{ date: "2026-09-24" }] }).status, "fail");
});

test("the offseason, before any standings: passes with notes", async () => {
  const run = await runChecker(
    { standings: { records: [] }, postseason: { dates: [] }, schedule: { dates: [] } },
    { now: Date.parse("2027-01-15T17:00:00Z") },
  );
  assert.equal(run.passed, true, run.lines.join("\n"));
  assert.match(run.findLine("standings fields"), /^skip {2}.*no 2027 standings yet/);
  assert.match(run.findLine("snapshot field"), /^skip/);
  assert.match(run.findLine("connector"), /^skip {2}connector: CONNECTOR_URL not set/);
});

test("a postseason under way with only a projected field fails", async () => {
  const { checkSnapshot } = await loadChecker;
  const responses = copy(EVENING.responses);
  const game = listGames(responses.postseason)[0];
  game.status = { ...game.status, abstractGameState: "Live", codedGameState: "I" };
  const field = checkSnapshot(responses, { season: 2026, now: NOW }).find(
    (result) => result.name === "snapshot field",
  );
  assert.equal(field.status, "fail");
});

test("a request MLB refuses, or a connector error, fails the check", async () => {
  const refused = await runChecker(EVENING.responses, { mlbStatus: 404 });
  assert.equal(refused.passed, false);
  assert.match(refused.findLine("request standings"), /HTTP 404 for \/api\/v1\/standings/);

  const broken = await runChecker(EVENING.responses, {
    connectorUrl: CONNECTOR,
    connectorError: "Couldn't read MLB: timeout",
  });
  assert.equal(broken.passed, false);
  assert.match(broken.findLine("connector get_snapshot"), /^FAIL {2}.*Couldn't read MLB: timeout/);
});
