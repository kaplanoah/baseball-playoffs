export const MAX_LOG = 50;

function rowsById(standings) {
  const out = {};
  for (const [div, clubs] of Object.entries((standings && standings.divisions) || {})) {
    for (const r of clubs) out[r.id] = { ...r, div };
  }
  return out;
}

const outOfIt = (r) => !!r && r.elim === "E" && r.wce === "E";
const gamesBack = (v) => {
  const n = parseFloat(String(v).replace("+", ""));
  return isNaN(n) ? 0 : n;
};

function bestBack(r) {
  const routes = [];
  if (r.elim !== "E") routes.push(gamesBack(r.gb));
  if (r.wce !== "E") routes.push(gamesBack(r.wcgb));
  return routes.length ? Math.min(...routes).toFixed(1) : null;
}

function result(games, club) {
  const g = games.find((x) => x.state === "final" && club && (x.away === club || x.home === club));
  if (!g) return null;
  const [a, h] = g.score;
  const [own, theirs, opp] = g.away === club ? [a, h, g.home] : [h, a, g.away];
  return { team: club, won: own > theirs, opp, score: [own, theirs], end: g.end };
}

// `at` is when the change was noticed, not when its game ended, so a change found after
// the last dismissal still shows as new.
function entry(fields, via, now) {
  const games = via.filter(Boolean);
  const e = { ...fields };
  if (games.length) e.via = games.map(({ end, ...v }) => v);
  e.at = new Date(now).toISOString().replace(".000Z", "Z");
  return e;
}

function lastWildCard(rows, lg) {
  const holders = Object.values(rows)
    .filter((r) => r.div.startsWith(lg) && r.wcrank && !r.lead)
    .sort((a, b) => Number(a.wcrank) - Number(b.wcrank));
  return holders.length >= 3 ? holders[2].id : null;
}

// Seed moves are logged only when the field is unchanged, since a swap moves seeds too,
// and only upward, since every rise implies a fall.
function fieldChanges(oldTeams, newTeams, after, games, now, logSeeds) {
  const out = [];
  for (const lg of ["AL", "NL"]) {
    const league = (teams) => Object.entries(teams).filter(([, t]) => t.league === lg);
    const bySeed = (teams, ids) => ids.sort((a, b) => teams[a].seed - teams[b].seed);
    const ins = bySeed(
      newTeams,
      league(newTeams)
        .map(([id]) => id)
        .filter((id) => !oldTeams[id]),
    );
    const outs = bySeed(
      oldTeams,
      league(oldTeams)
        .map(([id]) => id)
        .filter((id) => !newTeams[id]),
    );

    ins.forEach((id, i) => {
      const gone = outs[i];
      if (!gone) {
        out.push(entry({ kind: "field", in: id }, [], now));
        return;
      }
      const fields = { kind: "field", in: id, out: gone };
      if (newTeams[id].seed <= 3)
        Object.assign(fields, { spot: "division", div: (after[id] || {}).div || "" });
      else fields.spot = "wildcard";
      const r = after[gone];
      if (r) {
        fields.outAlive = !outOfIt(r);
        const back = bestBack(r);
        if (back != null) fields.outBack = back;
      }
      out.push(entry(fields, [result(games, id), result(games, gone)], now));
    });
    outs.slice(ins.length).forEach((id) => out.push(entry({ kind: "field", out: id }, [], now)));

    if (!logSeeds || ins.length || outs.length) continue;
    const moved = league(newTeams).filter(([id, t]) => t.seed < oldTeams[id].seed);
    for (const [id, t] of moved) {
      const fields = { kind: "seed", team: id, from: oldTeams[id].seed, to: t.seed };
      const passed = league(newTeams).filter(
        ([other, o]) =>
          other !== id && oldTeams[other].seed === t.seed && o.seed === oldTeams[id].seed,
      );
      const swapOnly = moved.length === 1 && passed.length === 1;
      if (swapOnly) fields.over = passed[0][0];
      out.push(
        entry(fields, [result(games, id), swapOnly ? result(games, fields.over) : null], now),
      );
    }
  }
  return out;
}

// Each step up MLB's clinch marker is its own news.
const CLINCH = { x: ["playoff", 1], w: ["wildcard", 2], y: ["division", 3], z: ["bye", 4] };

// A stored table without `clinch` can only reveal a division title.
function berthWon(old, r) {
  if ("clinch" in old) {
    const now = CLINCH[r.clinch],
      was = CLINCH[old.clinch];
    return now && now[1] > (was ? was[1] : 0) ? now[0] : null;
  }
  return r.clinched && !old.clinched ? "division" : null;
}

function standingsChanges(before, after, games, now) {
  const out = [];
  const clubs = Object.entries(after).filter(([id]) => before[id]);
  for (const [id, r] of clubs) {
    const what = berthWon(before[id], r);
    if (!what) continue;
    const fields = { kind: "berth", team: id, what };
    if (what === "division") fields.div = r.div;
    const own = result(games, id);
    out.push(entry(fields, [own && own.won ? own : null], now));
  }
  for (const [id, r] of clubs) {
    const old = before[id];
    if (!outOfIt(r) || outOfIt(old)) continue;
    const chasing =
      old.wce !== "E"
        ? lastWildCard(after, r.div.slice(0, 2))
        : old.elim !== "E"
          ? (Object.values(after).find((x) => x.div === r.div && x.lead) || {}).id
          : null;
    const own = result(games, id),
      them = result(games, chasing);
    out.push(
      entry(
        { kind: "elim", team: id },
        [own && !own.won ? own : null, them && them.won ? them : null],
        now,
      ),
    );
  }
  return out;
}

export function between(before, after, now = Date.now()) {
  if (!before || !after) return [];
  const games = (after.slate && after.slate.today && after.slate.today.games) || [];
  const oldTeams = before.teams || {},
    newTeams = after.teams || {};
  const out = [];

  const hadField = Object.keys(oldTeams).length > 0;
  const locked = before.projected !== false && after.projected === false;
  if (locked && hadField) out.push(entry({ kind: "lock" }, [], now));
  if (hadField && (after.projected !== false || locked)) {
    out.push(...fieldChanges(oldTeams, newTeams, rowsById(after.standings), games, now, !locked));
  }
  if (before.standings && before.standings.divisions && after.standings) {
    out.push(
      ...standingsChanges(rowsById(before.standings), rowsById(after.standings), games, now),
    );
  }
  return out;
}

// A field or seed change can recur on a later day, so its key carries the day.
export function key(e) {
  switch (e.kind) {
    case "game":
      return `game:${e.series}:${e.game}`;
    case "clinch":
      return `clinch:${e.series}`;
    case "lock":
      return "lock";
    case "elim":
      return `elim:${e.team}`;
    case "berth":
      return `berth:${e.team}:${e.what}`;
    case "field":
      return `field:${e.in || ""}:${e.out || ""}:${String(e.at).slice(0, 10)}`;
    case "seed":
      return `seed:${e.team}:${e.to}:${String(e.at).slice(0, 10)}`;
    default:
      return `${e.kind}:${e.at}:${e.text || ""}`;
  }
}

export function merge(log, entries) {
  const seen = new Set();
  const all = [...(log || []), ...entries].filter((e) => {
    if (!e || !e.kind) return false;
    const k = key(e);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  all.sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  return all.slice(-MAX_LOG);
}
