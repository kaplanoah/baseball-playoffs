/* Checks that MLB's Stats API still answers the page's requests with the
   fields js/snapshot.js reads, and that the connector still answers. The
   requests filter with `fields=`, so a renamed or dropped field comes back as
   nothing at all, and the page would quietly show less.

     node scripts/check-mlb.mjs
     CONNECTOR_URL=https://<worker>/mcp node scripts/check-mlb.mjs */
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const S = require("../js/snapshot.js");

const KNOWN_TEAMS = new Set(Object.values(S.MLB_TEAM));
const POSTSEASON_TYPES = ["F", "D", "L", "W"];
const TIMEOUT_MS = 15000;

const get = (obj, path) => path.split(".").reduce((o, k) => (o == null ? undefined : o[k]), obj);
const isList = Array.isArray;
const isNum = (v) => typeof v === "number" && Number.isFinite(v);
const isStr = (v) => typeof v === "string" && v !== "";
const isBool = (v) => typeof v === "boolean";
const isNumStr = (v) => isStr(v) && Number.isFinite(Number(v));
const isDay = (v) => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);
const isTime = (v) => isStr(v) && !Number.isNaN(Date.parse(v));
const isSet = (v) => v !== undefined && v !== null && v !== "";
const countGames = (n) => `${n} game${n === 1 ? "" : "s"}`;

/* The same reading of a status as gameState in js/snapshot.js: a postponed
   game also reads "Final", with no score. */
function stateOf(status = {}) {
  if (
    /^[CDTU]$/.test(status.codedGameState) ||
    /postpon|cancel|suspend/i.test(status.detailedState || "")
  )
    return "off";
  return { Live: "live", Final: "final" }[status.abstractGameState] || "pre";
}

/* A field rule: `path` must pass `test` on every item `when` applies to, or
   with `some`, on at least one of them. `some` is for fields the code can do
   without on a single game, where only their disappearing everywhere matters. */
const need = (path, test, when = () => true, some = false) => ({ path, test, when, some });

const played = (r) => r.wins + r.losses > 0;
const final = (g) => stateOf(g.status) === "final";
const underway = (g) => ["live", "final"].includes(stateOf(g.status));

export const RULES = {
  standings: [need("records", isList)],
  division: [need("division.id", isNum), need("teamRecords", isList)],
  club: [
    need("team.id", (v) => v in S.MLB_TEAM),
    need("wins", isNum),
    need("losses", isNum),
    need("winningPercentage", isNumStr, played),
    need("divisionRank", isNumStr, played),
    need("leagueRank", isNumStr, played),
    need("divisionGamesBack", isSet, played),
    need("wildCardGamesBack", isSet, played),
    need("eliminationNumber", isSet, played),
    need("wildCardEliminationNumber", isSet, played),
    need("divisionChamp", isBool, played),
    need("divisionLeader", isBool, played),
    need("wildCardRank", isNumStr, (r) => played(r) && r.divisionLeader === false),
    need("clinchIndicator", isStr, (r) => r.divisionChamp === true),
  ],
  schedule: [need("dates", isList)],
  date: [need("date", isDay), need("games", isList)],
  game: [
    need("gamePk", isNum),
    need("gameType", isStr),
    need("gameDate", isTime),
    need("officialDate", isDay),
    need("status.abstractGameState", isStr),
    need("status.detailedState", isStr),
    need("status.codedGameState", isStr),
    need("status.startTimeTBD", isBool),
    need("teams.away.team.id", isNum),
    need("teams.away.team.name", isStr),
    need("teams.home.team.id", isNum),
    need("teams.home.team.name", isStr),
    need("teams.away.score", isNum, final),
    need("teams.home.score", isNum, final),
    need("gameInfo.firstPitch", isTime, final, true),
    need("gameInfo.gameDurationMinutes", isNum, final, true),
  ],
  windowGame: [need("linescore.currentInning", isNum, underway, true)],
  postseasonGame: [
    need("gameType", (v) => POSTSEASON_TYPES.includes(v)),
    need("seriesGameNumber", isNum),
    // The series' league comes from this name.
    need(
      "seriesDescription",
      (v) => /^(AL|NL)\b/.test(v),
      (g) => g.gameType !== "W",
    ),
  ],
};

export const CHECKED_FIELDS = new Set(
  Object.values(RULES).flatMap((rules) => rules.flatMap((r) => r.path.split("."))),
);

function problems(items, rules, noun, idOf = () => null) {
  const out = [];
  for (const { path, test, when, some } of rules) {
    const due = items.filter(when);
    const bad = due.filter((x) => !test(get(x, path)));
    if (!bad.length || (some && bad.length < due.length)) continue;
    const id = idOf(bad[0]);
    out.push(
      `${path} missing or unexpected on ${bad.length} of ${due.length} ${noun}` +
        (id == null ? "" : ` (e.g. ${id})`),
    );
  }
  return out;
}

const ok = (name, detail) => ({ name, status: "ok", detail });
const fail = (name, detail) => ({ name, status: "fail", detail });
const skip = (name, detail) => ({ name, status: "skip", detail });
const verdict = (name, found, detail) =>
  found.length ? fail(name, found.join("; ")) : ok(name, detail);

export function checkStandings(resp, season) {
  const name = "standings fields";
  const top = problems([resp || {}], RULES.standings, "responses");
  if (top.length) return fail(name, top.join("; "));
  if (!resp.records.length) return skip(name, `no ${season} standings yet (preseason)`);
  const clubs = resp.records.flatMap((d) => (isList(d.teamRecords) ? d.teamRecords : []));
  const found = [
    ...problems(resp.records, RULES.division, "divisions"),
    ...problems(clubs, RULES.club, "clubs", (r) => `team ${get(r, "team.id")}`),
  ];
  const divisions = new Set(resp.records.map((d) => get(d, "division.id"))).size;
  const ids = new Set(clubs.map((r) => get(r, "team.id"))).size;
  if (divisions !== 6 || ids !== 30 || clubs.length !== 30)
    found.push(`expected 30 clubs in 6 divisions, got ${clubs.length} in ${divisions}`);
  const detail = `30 clubs in 6 divisions${clubs.some(played) ? "" : ", no games played yet"}`;
  return verdict(name, found, detail);
}

export function checkGames(key, resp) {
  const name = `${key} fields`;
  const top = problems([resp || {}], RULES.schedule, "responses");
  if (top.length) return fail(name, top.join("; "));
  const list = resp.dates.flatMap((d) => (isList(d.games) ? d.games : []));
  const extra = key === "postseason" ? RULES.postseasonGame : RULES.windowGame;
  const found = [
    ...problems(resp.dates, RULES.date, "dates", (d) => d.date),
    ...problems(list, [...RULES.game, ...extra], "games", (g) => `gamePk ${g.gamePk}`),
  ];
  if (!list.length)
    return verdict(
      name,
      found,
      key === "postseason" ? "none scheduled yet" : "no games in the window",
    );
  const count = {};
  for (const g of list) count[stateOf(g.status)] = (count[stateOf(g.status)] || 0) + 1;
  const states = ["final", "live", "pre", "off"]
    .filter((s) => count[s])
    .map((s) => `${count[s]} ${s}`)
    .join(", ");
  return verdict(name, found, `${countGames(list.length)} (${states})`);
}

function seedProblems(teams) {
  const found = [];
  if (Object.keys(teams).length !== 12)
    found.push(`${Object.keys(teams).length} clubs, expected 12`);
  for (const lg of ["AL", "NL"]) {
    const seeds = Object.values(teams)
      .filter((t) => t.league === lg)
      .map((t) => t.seed)
      .sort((a, b) => a - b);
    if (seeds.join() !== "1,2,3,4,5,6") found.push(`${lg} seeds ${seeds.join(",") || "none"}`);
  }
  return found;
}

function teamIds(snap) {
  const ids = Object.keys(snap.teams || {});
  for (const rows of Object.values((snap.standings && snap.standings.divisions) || {})) {
    for (const r of rows) ids.push(r.id, ...[r.next, r.then].filter(Boolean).map((n) => n.opp));
  }
  const slate = snap.slate || {};
  const games = [slate.today, slate.nextDay]
    .filter(Boolean)
    .flatMap((d) => d.games)
    .concat(slate.lastFinal || []);
  for (const g of games) ids.push(g.away, g.home);
  for (const e of snap.log || []) ids.push(...[e.team, e.over, e.won].filter(Boolean));
  return ids;
}

function standingsProblems(snap) {
  const divisions = Object.values(snap.standings.divisions);
  const clubs = new Set(divisions.flat().map((r) => r.id));
  return divisions.length === 6 && divisions.every((d) => d.length === 5) && clubs.size === 30
    ? []
    : [`expected 30 clubs in 6 divisions of 5, got ${clubs.size} in ${divisions.length}`];
}

function unknownIds(snap) {
  const unknown = [...new Set(teamIds(snap).filter((id) => !KNOWN_TEAMS.has(id)))];
  return unknown.length ? [`unknown team ids: ${unknown.join(", ")}`] : [];
}

export function checkSnapshot(responses, { season, now }) {
  let snap;
  try {
    snap = S.buildSnapshot(responses, { season, now });
  } catch (e) {
    return [fail("snapshot builds", (e && e.stack) || String(e))];
  }
  const out = [ok("snapshot builds", `${JSON.stringify(snap).length} bytes`)];

  const clubs = ((responses.standings && responses.standings.records) || []).flatMap(
    (d) => d.teamRecords || [],
  );
  out.push(
    clubs.length
      ? verdict("snapshot standings", standingsProblems(snap), "30 clubs in 6 divisions")
      : skip("snapshot standings", "no standings yet"),
  );

  const started = ((responses.postseason && responses.postseason.dates) || [])
    .flatMap((d) => d.games || [])
    .some(underway);
  if (!snap.projected) {
    out.push(verdict("snapshot field", seedProblems(snap.teams), "official, 12 clubs seeded"));
  } else if (started) {
    out.push(fail("snapshot field", "the postseason has started but the field is still projected"));
  } else if (!clubs.length) {
    out.push(skip("snapshot field", "no standings yet"));
  } else if (clubs.length === 30 && clubs.every(played)) {
    out.push(verdict("snapshot field", seedProblems(snap.teams), "projected, 12 clubs seeded"));
  } else {
    out.push(skip("snapshot field", "not every club has played yet"));
  }

  const ids = teamIds(snap);
  out.push(verdict("snapshot team ids", unknownIds(snap), `${new Set(ids).size} clubs, all known`));

  if (responses.schedule) {
    const s = snap.slate;
    out.push(
      s && s.today && isDay(s.today.date) && isList(s.today.games)
        ? ok("snapshot slate", `${countGames(s.today.games.length)} on ${s.today.date}`)
        : fail("snapshot slate", "missing for the current season"),
    );
  }

  const delay = S.pollDelay(snap, now);
  out.push(
    delay === null || (isNum(delay) && delay >= 0)
      ? ok("pollDelay", delay === null ? "never (season over)" : duration(delay))
      : fail("pollDelay", `returned ${delay}`),
  );
  return out;
}

const duration = (ms) =>
  ms >= 60000 ? `${Math.round(ms / 60000)} min` : `${Math.round(ms / 1000)} s`;

async function getJson(fetchImpl, url, init = {}, { retries = 1, retryMs = 2000 } = {}) {
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await fetchImpl(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });
      if (!res.ok) {
        const err = new Error(`HTTP ${res.status}`);
        err.retry = res.status >= 500 || res.status === 429;
        throw err;
      }
      return await res.json();
    } catch (e) {
      if (attempt >= retries || e.retry === false) throw e;
      await new Promise((r) => setTimeout(r, retryMs));
    }
  }
}

export async function checkConnector(url, season, fetchImpl, opts) {
  let id = 0;
  const rpc = async (method, params) => {
    const body = await getJson(
      fetchImpl,
      url,
      {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: ++id, method, params }),
      },
      opts,
    );
    if (body.error) throw new Error(`JSON-RPC error ${body.error.code}: ${body.error.message}`);
    return body.result;
  };
  const out = [];
  try {
    const init = await rpc("initialize", {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "check-mlb", version: "1.0.0" },
    });
    const info = init.serverInfo || {};
    out.push(
      info.name
        ? ok("connector initialize", `${info.name} ${info.version || ""}`.trim())
        : fail("connector initialize", "no serverInfo in the reply"),
    );
  } catch (e) {
    out.push(fail("connector initialize", e.message));
  }
  try {
    const result = await rpc("tools/call", { name: "get_snapshot", arguments: { season } });
    const text = get(result, "content.0.text");
    if (result.isError) {
      out.push(fail("connector get_snapshot", text || "isError"));
    } else {
      const snap = result.structuredContent || JSON.parse(text);
      const found = [];
      if (snap.season !== season) found.push(`season ${snap.season}, expected ${season}`);
      if (snap.version !== 1) found.push(`version ${snap.version}`);
      if (Object.keys(get(snap, "standings.divisions") || {}).length)
        found.push(...standingsProblems(snap));
      found.push(...unknownIds(snap));
      out.push(verdict("connector get_snapshot", found, `${season} snapshot as of ${snap.asOf}`));
    }
  } catch (e) {
    out.push(fail("connector get_snapshot", e.message));
  }
  return out;
}

const line = (r) =>
  `${{ ok: "ok  ", fail: "FAIL", skip: "skip" }[r.status]}  ${r.name}: ${r.detail}`;

export async function run({
  fetchImpl = fetch,
  now = Date.now(),
  connectorUrl = "",
  print = console.log,
  retryMs,
} = {}) {
  const season = S.easternDay(now).year;
  const results = [];
  const report = (...rs) =>
    rs.forEach((r) => {
      results.push(r);
      print(line(r));
    });
  print(`MLB check, ${season} season, ${new Date(now).toISOString()}`);

  const req = S.mlbRequests(season, now);
  const keys = Object.keys(req).filter((k) => req[k]);
  const headers = { accept: "application/json", "user-agent": "baseball-playoffs-check" };
  const fetched = await Promise.allSettled(
    keys.map((k) => getJson(fetchImpl, S.MLB_API + req[k], { headers }, { retryMs })),
  );
  const responses = { schedule: null };
  keys.forEach((k, i) => {
    const f = fetched[i];
    if (f.status === "fulfilled") {
      responses[k] = f.value;
      report(ok(`request ${k}`, `${JSON.stringify(f.value).length} bytes`));
    } else {
      report(fail(`request ${k}`, `${f.reason.message} for ${req[k].split("?")[0]}`));
    }
  });
  if (fetched.every((f) => f.status === "fulfilled")) {
    report(checkStandings(responses.standings, season));
    report(checkGames("postseason", responses.postseason));
    if (responses.schedule) report(checkGames("schedule", responses.schedule));
    report(...checkSnapshot(responses, { season, now }));
  }

  if (connectorUrl) report(...(await checkConnector(connectorUrl, season, fetchImpl, { retryMs })));
  else report(skip("connector", "CONNECTOR_URL not set"));

  const failed = results.filter((r) => r.status === "fail");
  print(
    failed.length
      ? `MLB check failed: ${failed.map((r) => r.name).join(", ")}`
      : "MLB check passed.",
  );
  return failed.length === 0;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const passed = await run({ connectorUrl: process.env.CONNECTOR_URL });
  process.exitCode = passed ? 0 : 1;
}
