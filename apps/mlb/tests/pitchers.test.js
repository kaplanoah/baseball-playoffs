import test from "node:test";
import assert from "node:assert/strict";
import {
  buildLeague,
  createPitcherServer,
  describePitcher,
  listLeagueRequest,
  listPitcherRequests,
} from "../worker/src/pitchers.js";

const describeLine = (id, gamesStarted, era, k9, bb9) => ({
  player: { id },
  stat: {
    gamesStarted,
    era,
    strikeoutsPer9Inn: String(k9),
    walksPer9Inn: String(bb9),
  },
});
const describeArsenal = (id, pitches) => ({
  id,
  stats: [
    {
      type: { displayName: "pitchArsenal" },
      splits: pitches.map(([code, percentage, averageSpeed]) => ({
        stat: { percentage, averageSpeed, type: { code, description: code } },
      })),
    },
  ],
});

// Five pitchers: four starters and a reliever with two starts, who isn't one.
const LEAGUE = {
  stats: [
    {
      splits: [
        describeLine(1, 30, "1.95", 11.1, 2.3),
        describeLine(2, 26, "3.03", 10.4, 2.4),
        describeLine(3, 22, "3.03", 6.8, 2.8),
        describeLine(4, 15, "4.50", 8.0, 3.5),
        describeLine(5, 2, "0.90", 12.0, 1.0),
      ],
    },
  ],
};
const SPEEDS = [
  {
    people: [
      describeArsenal(1, [
        ["FF", 0.44, 98.0],
        ["SI", 0.19, 97.8],
      ]),
      describeArsenal(2, [
        ["FF", 0.45, 96.1],
        ["CU", 0.09, 82.9],
      ]),
    ],
  },
  {
    people: [
      describeArsenal(3, [
        ["SI", 0.3, 93.2],
        ["FF", 0.2, 94.3],
      ]),
      describeArsenal(4, [["FC", 0.6, 89.0]]),
    ],
  },
];

const describePerson = (id, pitches, line = LEAGUE.stats[0].splits[id - 1].stat) => ({
  people: [
    {
      id,
      fullName: `Pitcher ${id}`,
      currentAge: 25,
      pitchHand: { code: "R" },
      stats: [
        { type: { displayName: "season" }, splits: line ? [{ stat: line }] : [] },
        describeArsenal(id, pitches).stats[0],
      ],
    },
  ],
});
const describeStart = (date, gamesStarted, opponent, runs = 1) => ({
  date,
  isHome: false,
  opponent: { id: opponent },
  stat: { gamesStarted, inningsPitched: "6.0", runs, strikeOuts: 5 },
});
const STARTS = {
  stats: [
    {
      splits: [
        describeStart("2026-09-13", 1, 121),
        describeStart("2026-09-19", 1, 109),
        describeStart("2026-09-21", 0, 139),
        describeStart("2026-09-24", 1, 139, 2),
        describeStart("2026-09-29", 1, 111, 0),
      ],
    },
  ],
};

test("a starter ranks among the pitchers with at least half the most starts, ties sharing a rank", () => {
  const league = buildLeague(LEAGUE, SPEEDS);
  assert.equal(league.minimum, 15);
  assert.deepEqual(
    league.starters.map((starter) => starter.id),
    [1, 2, 3, 4],
  );
  const pitcher = describePitcher(
    {
      person: describePerson(2, [
        ["FF", 0.45, 96.1],
        ["CU", 0.09, 82.9],
      ]),
      starts: STARTS,
    },
    league,
  );
  assert.deepEqual(pitcher.ranks, {
    era: { rank: 2, of: 4 },
    k9: { rank: 2, of: 4 },
    bb9: { rank: 2, of: 4 },
    speed: { rank: 2, of: 3 },
  });
  assert.deepEqual(pitcher.line, { era: "3.03", k9: 10.4, bb9: 2.4, speed: 96.1 });
  assert.deepEqual(pitcher.starters, { count: 4, minimum: 15 });
});

test("a pitcher's speed is his most-thrown fastball, a four-seamer or a sinker", () => {
  const league = buildLeague(LEAGUE, SPEEDS);
  assert.equal(league.starters.find((starter) => starter.id === 3).speed, 93.2);
  assert.equal(league.starters.find((starter) => starter.id === 4).speed, null);
});

test("a pitcher with too few starts has his numbers but no ranks", () => {
  const pitcher = describePitcher(
    { person: describePerson(5, [["FF", 0.7, 95.0]]), starts: STARTS },
    buildLeague(LEAGUE, SPEEDS),
  );
  assert.equal(pitcher.ranks, null);
  assert.deepEqual(pitcher.line, { era: "0.90", k9: 12, bb9: 1, speed: 95 });
});

test("a pitcher yet to pitch this season has no line, and no ranks", () => {
  const pitcher = describePitcher(
    { person: describePerson(6, [], null), starts: { stats: [{ splits: [] }] } },
    buildLeague(LEAGUE, SPEEDS),
  );
  assert.equal(pitcher.line, null);
  assert.equal(pitcher.ranks, null);
  assert.deepEqual(pitcher.pitches, []);
  assert.deepEqual(pitcher.starts, []);
});

test("his last three starts come newest first, postseason included, relief outings left out", () => {
  const pitcher = describePitcher(
    { person: describePerson(1, [["FF", 0.44, 98.0]]), starts: STARTS },
    buildLeague(LEAGUE, SPEEDS),
  );
  assert.deepEqual(pitcher.starts, [
    { date: "2026-09-29", opp: "BOS", home: false, ip: "6.0", runs: 0, k: 5 },
    { date: "2026-09-24", opp: "TB", home: false, ip: "6.0", runs: 2, k: 5 },
    { date: "2026-09-19", opp: "ARI", home: false, ip: "6.0", runs: 1, k: 5 },
  ]);
});

test("each pitch keeps MLB's code and name, with its share and speed rounded", () => {
  const pitcher = describePitcher(
    {
      person: describePerson(1, [
        ["FF", 0.44491944, 98.01831171840368],
        ["CU", 0.09766524, 86.2556325117845],
      ]),
      starts: STARTS,
    },
    buildLeague(LEAGUE, SPEEDS),
  );
  assert.deepEqual(pitcher.pitches, [
    { code: "FF", name: "FF", share: 0.445, mph: 98 },
    { code: "CU", name: "CU", share: 0.098, mph: 86.3 },
  ]);
});

function createFakeMlb({ status = 200 } = {}) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    const path = url.replace("https://statsapi.mlb.com", "");
    let body;
    if (path.startsWith("/api/v1/stats?")) body = LEAGUE;
    else if (path.startsWith("/api/v1/people?")) {
      const ids = new URL(url).searchParams.get("personIds").split(",").map(Number);
      body = {
        people: SPEEDS.flatMap((batch) => batch.people).filter((person) => ids.includes(person.id)),
      };
    } else if (path.includes("/stats?stats=gameLog")) body = STARTS;
    else body = describePerson(Number(/people\/(\d+)/.exec(path)[1]), [["FF", 0.44, 98.0]]);
    return new Response(JSON.stringify(body), { status });
  };
  return { fetchImpl, calls };
}

function createTestServer(options) {
  const mlb = createFakeMlb(options);
  let now = Date.parse("2026-09-30T16:00:00Z");
  const server = createPitcherServer({ fetchImpl: mlb.fetchImpl, now: () => now });
  return {
    mlb,
    requestPitcher: (query) =>
      server.servePitcher(new URL(`https://mlb-live.example/k3y/pitcher${query}`)),
    advanceClock: (milliseconds) => {
      now += milliseconds;
    },
  };
}

test("the route asks MLB for the pitcher, his starts, and the league, caching each at the edge", async () => {
  const { mlb, requestPitcher } = createTestServer();
  const response = await requestPitcher("?id=1&season=2026");
  assert.equal(response.status, 200);
  assert.equal((await response.json()).name, "Pitcher 1");
  const requests = listPitcherRequests(1, 2026);
  const cacheFor = (path) => mlb.calls.find((call) => call.url.endsWith(path))?.init.cf.cacheTtl;
  assert.equal(cacheFor(requests.person), 600);
  assert.equal(cacheFor(requests.starts), 600);
  assert.equal(cacheFor(listLeagueRequest(2026)), 6 * 60 * 60);
  const speedCalls = mlb.calls.filter((call) => call.url.includes("/api/v1/people?"));
  assert.deepEqual(
    speedCalls.map((call) => new URL(call.url).searchParams.get("personIds")),
    ["1,2,3,4"],
  );
});

test("sheets opened the same day rank against one read of the league", async () => {
  const { mlb, requestPitcher, advanceClock } = createTestServer();
  const countLeagueCalls = () =>
    mlb.calls.filter((call) => call.url.includes("/api/v1/stats?")).length;
  await requestPitcher("?id=1&season=2026");
  await requestPitcher("?id=2&season=2026");
  assert.equal(countLeagueCalls(), 1);
  advanceClock(6 * 60 * 60 * 1000);
  await requestPitcher("?id=1&season=2026");
  assert.equal(countLeagueCalls(), 2);
});

test("an id or season that isn't one is refused before anything is fetched", async () => {
  const { mlb, requestPitcher } = createTestServer();
  for (const query of ["", "?id=abc", "?id=-4", "?id=1.5", "?id=1&season=1800"]) {
    assert.equal((await requestPitcher(query)).status, 400, query);
  }
  assert.equal(mlb.calls.length, 0);
});

test("MLB failing is reported", async () => {
  const { requestPitcher } = createTestServer({ status: 503 });
  const response = await requestPitcher("?id=1&season=2026");
  assert.equal(response.status, 502);
  assert.match((await response.json()).error, /MLB Stats API answered 503/);
});

test("the speeds of a full league of starters come in batches of 30", async () => {
  const calls = [];
  const lines = Array.from({ length: 65 }, (_, index) => describeLine(index + 1, 30, "3.00", 8, 3));
  const fetchImpl = async (url) => {
    calls.push(url);
    if (url.includes("/api/v1/stats?")) return Response.json({ stats: [{ splits: lines }] });
    if (url.includes("/api/v1/people?")) return Response.json({ people: [] });
    if (url.includes("gameLog")) return Response.json(STARTS);
    return Response.json(describePerson(1, [["FF", 0.5, 95.0]]));
  };
  const server = createPitcherServer({ fetchImpl, now: () => 0 });
  await server.servePitcher(new URL("https://mlb-live.example/k3y/pitcher?id=1&season=2026"));
  const batches = calls
    .filter((url) => url.includes("/api/v1/people?"))
    .map((url) => new URL(url).searchParams.get("personIds").split(",").length);
  assert.deepEqual(batches, [30, 30, 5]);
});
