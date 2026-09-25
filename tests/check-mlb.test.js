/* scripts/check-mlb.mjs, run against the recorded fixtures instead of MLB:
   what it accepts, and that it notices a field going missing. */
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const S = require("../js/snapshot.js");

const load = import("../scripts/check-mlb.mjs");
const fixture = (name) =>
  JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures", `${name}.json`), "utf8"));
const EVENING = fixture("2026-09-24-evening");
const SEASON_2025 = fixture("2025-final");
const NOW = Date.parse(EVENING.now);
const CONNECTOR = "https://connector.example/mcp";

const reply = (body, status = 200) => new Response(JSON.stringify(body), { status });

/* MLB served from `responses`, and a connector that answers from the same. */
function fakeFetch(responses, { mlbStatus = 200, connectorError = null } = {}) {
  return async (url, init = {}) => {
    if (url === CONNECTOR) {
      const msg = JSON.parse(init.body);
      if (msg.method === "initialize")
        return reply({ jsonrpc: "2.0", id: msg.id, result: { serverInfo: { name: "mlb-live" } } });
      const result = connectorError
        ? { isError: true, content: [{ type: "text", text: connectorError }] }
        : { structuredContent: S.buildSnapshot(responses, { season: 2026, now: NOW }) };
      return reply({ jsonrpc: "2.0", id: msg.id, result });
    }
    const kind = url.includes("/standings")
      ? "standings"
      : url.includes("/postseason")
        ? "postseason"
        : "schedule";
    return reply(responses[kind], kind === "standings" ? mlbStatus : 200);
  };
}

async function run(responses, opts = {}) {
  const { run } = await load;
  const lines = [];
  const passed = await run({
    fetchImpl: fakeFetch(responses, opts),
    now: opts.now || NOW,
    connectorUrl: opts.connectorUrl || "",
    print: (l) => lines.push(l),
    retryMs: 0,
  });
  return { passed, lines, line: (name) => lines.find((l) => l.slice(6).startsWith(name)) };
}

const copy = (x) => JSON.parse(JSON.stringify(x));
const scheduleGames = (resp) => resp.dates.flatMap((d) => d.games);

test("every field the requests ask for is checked", async () => {
  const { CHECKED_FIELDS } = await load;
  const asked = Object.values(S.mlbRequests(2026, NOW)).flatMap((p) =>
    new URL(p, S.MLB_API).searchParams.get("fields").split(","),
  );
  assert.deepEqual(
    asked.filter((f) => !CHECKED_FIELDS.has(f)),
    [],
  );
});

test("the evening of 24 September 2026 passes, connector included", async () => {
  const r = await run(EVENING.responses, { connectorUrl: CONNECTOR });
  assert.equal(r.passed, true, r.lines.join("\n"));
  assert.match(r.line("schedule fields"), /^ok {4}.*107 games \(54 final, 4 live, 48 pre, 1 off\)/);
  assert.match(r.line("snapshot field"), /projected, 12 clubs seeded/);
  assert.match(r.line("connector get_snapshot"), /^ok/);
  assert.equal(r.lines.at(-1), "MLB check passed.");
});

test("the finished 2025 season: an official field and no slate", async () => {
  const { checkStandings, checkGames, checkSnapshot } = await load;
  const { responses, season } = SEASON_2025;
  assert.equal(checkStandings(responses.standings, season).status, "ok");
  assert.equal(checkGames("postseason", responses.postseason).detail, "47 games (47 final)");
  const results = checkSnapshot(responses, { season, now: NOW });
  assert.deepEqual(
    results.filter((r) => r.status !== "ok"),
    [],
  );
  assert.equal(
    results.find((r) => r.name === "snapshot field").detail,
    "official, 12 clubs seeded",
  );
  assert.equal(results.find((r) => r.name === "pollDelay").detail, "never (season over)");
});

test("a field MLB stops sending fails, naming it", async () => {
  const responses = copy(EVENING.responses);
  for (const g of scheduleGames(responses.schedule)) delete g.officialDate;
  for (const d of responses.standings.records) for (const r of d.teamRecords) delete r.wildCardRank;
  const r = await run(responses);
  assert.equal(r.passed, false);
  assert.match(r.line("schedule fields"), /^FAIL {2}.*officialDate missing .* on 107 of 107 games/);
  assert.match(r.line("standings fields"), /^FAIL {2}.*wildCardRank missing .* on 24 of 24 clubs/);
  assert.match(r.lines.at(-1), /^MLB check failed: standings fields, schedule fields/);
});

test("a field the code can do without on one game fails only once it is gone from all", async () => {
  const { checkGames } = await load;
  const resp = copy(EVENING.responses.schedule);
  const finals = scheduleGames(resp).filter((g) => g.status.codedGameState === "F");
  delete finals[0].gameInfo;
  assert.equal(checkGames("schedule", resp).status, "ok");
  finals.forEach((g) => delete g.gameInfo);
  assert.match(checkGames("schedule", resp).detail, /gameInfo.firstPitch missing/);
});

test("a postseason series that stops naming its league fails", async () => {
  const { checkGames } = await load;
  const resp = copy(EVENING.responses.postseason);
  scheduleGames(resp)[0].seriesDescription = "Wild Card Series";
  assert.match(
    checkGames("postseason", resp).detail,
    /seriesDescription missing .* on 1 of 46 games/,
  );
});

test("no games is fine; no `dates` at all is not", async () => {
  const { checkGames } = await load;
  assert.deepEqual(checkGames("schedule", { dates: [] }), {
    name: "schedule fields",
    status: "ok",
    detail: "no games in the window",
  });
  assert.equal(checkGames("schedule", {}).status, "fail");
  assert.equal(checkGames("schedule", { dates: [{ date: "2026-09-24" }] }).status, "fail");
});

test("the offseason, before any standings: passes with notes", async () => {
  const r = await run(
    { standings: { records: [] }, postseason: { dates: [] }, schedule: { dates: [] } },
    { now: Date.parse("2027-01-15T17:00:00Z") },
  );
  assert.equal(r.passed, true, r.lines.join("\n"));
  assert.match(r.line("standings fields"), /^skip {2}.*no 2027 standings yet/);
  assert.match(r.line("snapshot field"), /^skip/);
  assert.match(r.line("connector"), /^skip {2}connector: CONNECTOR_URL not set/);
});

test("a postseason under way with only a projected field fails", async () => {
  const { checkSnapshot } = await load;
  const responses = copy(EVENING.responses);
  const g = scheduleGames(responses.postseason)[0];
  g.status = { ...g.status, abstractGameState: "Live", codedGameState: "I" };
  const field = checkSnapshot(responses, { season: 2026, now: NOW }).find(
    (r) => r.name === "snapshot field",
  );
  assert.equal(field.status, "fail");
});

test("a request MLB refuses, or a connector error, fails the run", async () => {
  const refused = await run(EVENING.responses, { mlbStatus: 404 });
  assert.equal(refused.passed, false);
  assert.match(refused.line("request standings"), /HTTP 404 for \/api\/v1\/standings/);

  const broken = await run(EVENING.responses, {
    connectorUrl: CONNECTOR,
    connectorError: "Couldn't read MLB: timeout",
  });
  assert.equal(broken.passed, false);
  assert.match(broken.line("connector get_snapshot"), /^FAIL {2}.*Couldn't read MLB: timeout/);
});
