export const MAX_LOG = 50;

function indexRows(standings) {
  const rowsById = {};
  for (const [division, clubs] of Object.entries((standings && standings.divisions) || {})) {
    for (const row of clubs) rowsById[row.id] = { ...row, div: division };
  }
  return rowsById;
}

const isOutOfIt = (row) => !!row && row.elim === "E" && row.wce === "E";
const parseGamesBack = (value) => {
  const games = parseFloat(String(value).replace("+", ""));
  return isNaN(games) ? 0 : games;
};

function findClosestRoute(row) {
  const routes = [];
  if (row.elim !== "E") routes.push(parseGamesBack(row.gb));
  if (row.wce !== "E") routes.push(parseGamesBack(row.wcgb));
  return routes.length ? Math.min(...routes).toFixed(1) : null;
}

function findResult(games, club) {
  const game = games.find(
    (candidate) =>
      candidate.state === "final" && club && (candidate.away === club || candidate.home === club),
  );
  if (!game) return null;
  const [awayScore, homeScore] = game.score;
  const [own, theirs, opponent] =
    game.away === club ? [awayScore, homeScore, game.home] : [homeScore, awayScore, game.away];
  return { team: club, won: own > theirs, opp: opponent, score: [own, theirs], end: game.end };
}

// `at` is when the change was noticed, not when its game ended, so a change found after
// the last dismissal still shows as new.
function createEntry(fields, results, now) {
  const games = results.filter(Boolean);
  const entry = { ...fields };
  if (games.length) entry.via = games.map(({ end, ...result }) => result);
  entry.at = new Date(now).toISOString().replace(".000Z", "Z");
  return entry;
}

function findLastWildCard(rows, league) {
  const holders = Object.values(rows)
    .filter((row) => row.div.startsWith(league) && row.wcrank && !row.lead)
    .sort((first, second) => Number(first.wcrank) - Number(second.wcrank));
  return holders.length >= 3 ? holders[2].id : null;
}

function describeSwap(id, gone, newTeams, rows, games, now) {
  const fields = { kind: "field", in: id, out: gone };
  if (newTeams[id].seed <= 3)
    Object.assign(fields, { spot: "division", div: (rows[id] || {}).div || "" });
  else fields.spot = "wildcard";
  const goneRow = rows[gone];
  if (goneRow) {
    fields.outAlive = !isOutOfIt(goneRow);
    const back = findClosestRoute(goneRow);
    if (back != null) fields.outBack = back;
  }
  return createEntry(fields, [findResult(games, id), findResult(games, gone)], now);
}

function findSeedRises(leagueTeams, oldTeams, games, now) {
  const moved = leagueTeams.filter(([id, team]) => team.seed < oldTeams[id].seed);
  return moved.map(([id, team]) => {
    const fields = { kind: "seed", team: id, from: oldTeams[id].seed, to: team.seed };
    const passed = leagueTeams.filter(
      ([other, otherTeam]) =>
        other !== id && oldTeams[other].seed === team.seed && otherTeam.seed === oldTeams[id].seed,
    );
    const isSwapOnly = moved.length === 1 && passed.length === 1;
    if (isSwapOnly) fields.over = passed[0][0];
    const overResult = isSwapOnly ? findResult(games, fields.over) : null;
    return createEntry(fields, [findResult(games, id), overResult], now);
  });
}

// Seed moves are logged only when the field is unchanged, since a swap moves seeds too,
// and only upward, since every rise implies a fall.
function findFieldChanges(oldTeams, newTeams, rows, games, now, logSeeds) {
  const changes = [];
  for (const league of ["AL", "NL"]) {
    const listLeague = (teams) =>
      Object.entries(teams).filter(([, team]) => team.league === league);
    const sortBySeed = (teams, ids) =>
      ids.sort((first, second) => teams[first].seed - teams[second].seed);
    const arrivals = sortBySeed(
      newTeams,
      listLeague(newTeams)
        .map(([id]) => id)
        .filter((id) => !oldTeams[id]),
    );
    const departures = sortBySeed(
      oldTeams,
      listLeague(oldTeams)
        .map(([id]) => id)
        .filter((id) => !newTeams[id]),
    );

    arrivals.forEach((id, index) => {
      const gone = departures[index];
      changes.push(
        gone
          ? describeSwap(id, gone, newTeams, rows, games, now)
          : createEntry({ kind: "field", in: id }, [], now),
      );
    });
    for (const id of departures.slice(arrivals.length))
      changes.push(createEntry({ kind: "field", out: id }, [], now));

    if (logSeeds && !arrivals.length && !departures.length)
      changes.push(...findSeedRises(listLeague(newTeams), oldTeams, games, now));
  }
  return changes;
}

// Each step up MLB's clinch marker is its own news.
const CLINCH = { x: ["playoff", 1], w: ["wildcard", 2], y: ["division", 3], z: ["bye", 4] };

// A stored table without `clinch` can only reveal a division title.
function findBerthWon(oldRow, row) {
  if ("clinch" in oldRow) {
    const now = CLINCH[row.clinch];
    const was = CLINCH[oldRow.clinch];
    return now && now[1] > (was ? was[1] : 0) ? now[0] : null;
  }
  return row.clinched && !oldRow.clinched ? "division" : null;
}

function findChaser(oldRow, row, after) {
  if (oldRow.wce !== "E") return findLastWildCard(after, row.div.slice(0, 2));
  if (oldRow.elim !== "E")
    return (Object.values(after).find((other) => other.div === row.div && other.lead) || {}).id;
  return null;
}

function findStandingsChanges(before, after, games, now) {
  const changes = [];
  const clubs = Object.entries(after).filter(([id]) => before[id]);
  for (const [id, row] of clubs) {
    const berth = findBerthWon(before[id], row);
    if (!berth) continue;
    const fields = { kind: "berth", team: id, what: berth };
    if (berth === "division") fields.div = row.div;
    const own = findResult(games, id);
    changes.push(createEntry(fields, [own && own.won ? own : null], now));
  }
  for (const [id, row] of clubs) {
    const oldRow = before[id];
    if (!isOutOfIt(row) || isOutOfIt(oldRow)) continue;
    const own = findResult(games, id);
    const chaser = findResult(games, findChaser(oldRow, row, after));
    changes.push(
      createEntry(
        { kind: "elim", team: id },
        [own && !own.won ? own : null, chaser && chaser.won ? chaser : null],
        now,
      ),
    );
  }
  return changes;
}

export function findChanges(before, after, now = Date.now()) {
  if (!before || !after) return [];
  const games = (after.slate && after.slate.today && after.slate.today.games) || [];
  const oldTeams = before.teams || {};
  const newTeams = after.teams || {};
  const changes = [];

  const hadField = Object.keys(oldTeams).length > 0;
  const locked = before.projected !== false && after.projected === false;
  if (locked && hadField) changes.push(createEntry({ kind: "lock" }, [], now));
  if (hadField && (after.projected !== false || locked)) {
    const rows = indexRows(after.standings);
    changes.push(...findFieldChanges(oldTeams, newTeams, rows, games, now, !locked));
  }
  if (before.standings && before.standings.divisions && after.standings) {
    changes.push(
      ...findStandingsChanges(indexRows(before.standings), indexRows(after.standings), games, now),
    );
  }
  return changes;
}

// A field or seed change can recur on a later day, so its key carries the day.
function describeKey(entry) {
  const day = String(entry.at).slice(0, 10);
  switch (entry.kind) {
    case "game":
      return `game:${entry.series}:${entry.game}`;
    case "clinch":
      return `clinch:${entry.series}`;
    case "lock":
      return "lock";
    case "elim":
      return `elim:${entry.team}`;
    case "berth":
      return `berth:${entry.team}:${entry.what}`;
    case "field":
      return `field:${entry.in || ""}:${entry.out || ""}:${day}`;
    case "seed":
      return `seed:${entry.team}:${entry.to}:${day}`;
    default:
      return `${entry.kind}:${entry.at}`;
  }
}

export function mergeLog(log, entries) {
  const seen = new Set();
  const merged = [...(log || []), ...entries].filter((entry) => {
    if (!entry || !entry.kind) return false;
    const key = describeKey(entry);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  merged.sort((first, second) => Date.parse(first.at) - Date.parse(second.at));
  return merged.slice(-MAX_LOG);
}
