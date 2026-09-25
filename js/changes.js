/* What changed between the table the page last recorded and the one MLB
   shows now, as update-log entries: clubs taking a spot in the projected
   field, clubs moving up a seed, division titles, eliminations, and the
   official bracket replacing the projection.

   The postseason needs none of this -- every game and clinch is in MLB's own
   schedule, and snapshot.js reads them straight off it. The regular season is
   different: "the Padres passed the Cubs" is a difference between two tables,
   so it can only be found by keeping the older one. The season and standings
   documents are that older table: the page compares each new snapshot with
   them, logs what moved, and writes the new table back as the next baseline.

   Pure functions. Entries are data; updates.js writes the sentences. */

const LogChanges = (() => {

  const MAX_LOG = 50;

  function rowsById(standings){
    const out = {};
    for(const [div, clubs] of Object.entries((standings && standings.divisions) || {})){
      for(const r of clubs) out[r.id] = { ...r, div };
    }
    return out;
  }

  const outOfIt = r => !!r && r.elim === "E" && r.wce === "E";
  const gamesBack = v => { const n = parseFloat(String(v).replace("+", "")); return isNaN(n) ? 0 : n; };

  /* Games back on the club's best remaining route: its division, or the wild
     card, whichever it is still alive for and closer in. */
  function bestBack(r){
    const routes = [];
    if(r.elim !== "E") routes.push(gamesBack(r.gb));
    if(r.wce !== "E") routes.push(gamesBack(r.wcgb));
    return routes.length ? Math.min(...routes).toFixed(1) : null;
  }

  /* A club's final today as a `via` item, its own runs first. */
  function result(games, club){
    const g = games.find(x => x.state === "final" && club && (x.away === club || x.home === club));
    if(!g) return null;
    const [a, h] = g.score;
    const [own, theirs, opp] = g.away === club ? [a, h, g.home] : [h, a, g.away];
    return { team: club, won: own > theirs, opp, score: [own, theirs], end: g.end };
  }

  /* Build an entry: `via` lists the finals behind it, and `at` is when the
     latest of them ended, so two views that notice the same change a minute
     apart still log it at the same moment. With no game behind it, now. */
  function entry(fields, via, now){
    const games = via.filter(Boolean);
    const e = { ...fields };
    if(games.length) e.via = games.map(({ end, ...v }) => v);
    const ends = games.map(v => Date.parse(v.end)).filter(n => !isNaN(n));
    e.at = new Date(ends.length ? Math.max(...ends) : now).toISOString().replace(".000Z", "Z");
    return e;
  }

  function lastWildCard(rows, lg){
    const holders = Object.values(rows)
      .filter(r => r.div.startsWith(lg) && r.wcrank && !r.lead)
      .sort((a, b) => Number(a.wcrank) - Number(b.wcrank));
    return holders.length >= 3 ? holders[2].id : null;
  }

  /* The field: who came in and who went out, per league, paired in seed
     order. A club that stayed but moved up a seed gets its own entry, only
     when the field itself didn't change -- a swap moves seeds too, and the
     field entry already says why -- and not when the official bracket
     arrives, which the lock entry covers. Only moves UP are logged: every
     move up implies someone moved down. */
  function fieldChanges(oldTeams, newTeams, after, games, now, logSeeds){
    const out = [];
    for(const lg of ["AL", "NL"]){
      const league = teams => Object.entries(teams).filter(([, t]) => t.league === lg);
      const bySeed = (teams, ids) => ids.sort((a, b) => teams[a].seed - teams[b].seed);
      const ins = bySeed(newTeams, league(newTeams).map(([id]) => id).filter(id => !oldTeams[id]));
      const outs = bySeed(oldTeams, league(oldTeams).map(([id]) => id).filter(id => !newTeams[id]));

      ins.forEach((id, i) => {
        const gone = outs[i];
        if(!gone){ out.push(entry({ kind: "field", in: id }, [], now)); return; }
        const fields = { kind: "field", in: id, out: gone };
        if(newTeams[id].seed <= 3) Object.assign(fields, { spot: "division", div: (after[id] || {}).div || "" });
        else fields.spot = "wildcard";
        const r = after[gone];
        if(r){
          fields.outAlive = !outOfIt(r);
          const back = bestBack(r);
          if(back != null) fields.outBack = back;
        }
        out.push(entry(fields, [result(games, id), result(games, gone)], now));
      });
      outs.slice(ins.length).forEach(id => out.push(entry({ kind: "field", out: id }, [], now)));

      if(!logSeeds || ins.length || outs.length) continue;
      const moved = league(newTeams).filter(([id, t]) => t.seed < oldTeams[id].seed);
      for(const [id, t] of moved){
        const fields = { kind: "seed", team: id, from: oldTeams[id].seed, to: t.seed };
        const passed = league(newTeams).filter(([other, o]) => other !== id &&
          oldTeams[other].seed === t.seed && o.seed === oldTeams[id].seed);
        const swapOnly = moved.length === 1 && passed.length === 1;
        if(swapOnly) fields.over = passed[0][0];
        out.push(entry(fields, [result(games, id), swapOnly ? result(games, fields.over) : null], now));
      }
    }
    return out;
  }

  /* Division titles and eliminations that happened since the old table. An
     elimination's `via` is the club's own loss and the win by the club it
     was chasing on the route that just closed. */
  function standingsChanges(before, after, games, now){
    const out = [];
    for(const [id, r] of Object.entries(after)){
      const old = before[id] || {};
      if(r.clinched && !old.clinched){
        const own = result(games, id);
        out.push(entry({ kind: "berth", team: id, what: "division", div: r.div }, [own && own.won ? own : null], now));
      }
      if(outOfIt(r) && before[id] && !outOfIt(old)){
        const lg = r.div.slice(0, 2);
        const chasing = old.wce !== "E" ? lastWildCard(after, lg)
          : old.elim !== "E" ? (Object.values(after).find(x => x.div === r.div && x.lead) || {}).id
          : null;
        const own = result(games, id), them = result(games, chasing);
        out.push(entry({ kind: "elim", team: id },
          [own && !own.won ? own : null, them && them.won ? them : null], now));
      }
    }
    return out;
  }

  /* Everything that changed from `before` (the documents as stored) to
     `after` (a new snapshot). Nothing is logged against an empty baseline:
     the first snapshot a season sees is the starting point, not news. */
  function between(before, after, now = Date.now()){
    if(!before || !after) return [];
    const games = (after.slate && after.slate.today && after.slate.today.games) || [];
    const oldTeams = before.teams || {}, newTeams = after.teams || {};
    const out = [];

    const hadField = Object.keys(oldTeams).length === 12;
    const locked = before.projected !== false && after.projected === false;
    if(locked && hadField) out.push(entry({ kind: "lock" }, [], now));
    if(hadField && (after.projected !== false || locked)){
      out.push(...fieldChanges(oldTeams, newTeams, rowsById(after.standings), games, now, !locked));
    }
    if(before.standings && before.standings.divisions && after.standings){
      out.push(...standingsChanges(rowsById(before.standings), rowsById(after.standings), games, now));
    }
    return out;
  }

  /* One identity per piece of news, so the same change noticed twice -- by
     two open views, or by the page and the retired routine -- is kept once.
     A field or seed change can happen again on a later day, so its identity
     carries the day; a clinch or an elimination happens once a season. */
  function key(e){
    switch(e.kind){
      case "game":   return `game:${e.series}:${e.game}`;
      case "clinch": return `clinch:${e.series}`;
      case "lock":   return "lock";
      case "elim":   return `elim:${e.team}`;
      case "berth":  return `berth:${e.team}:${e.what}`;
      case "field":  return `field:${e.in || ""}:${e.out || ""}:${String(e.at).slice(0, 10)}`;
      case "seed":   return `seed:${e.team}:${e.to}:${String(e.at).slice(0, 10)}`;
      default:       return `${e.kind}:${e.at}:${e.text || ""}`;
    }
  }

  /* The log with `entries` added: once each, oldest first, the newest 50. */
  function merge(log, entries){
    const seen = new Set();
    const all = [...(log || []), ...entries].filter(e => {
      if(!e || !e.kind) return false;
      const k = key(e);
      if(seen.has(k)) return false;
      seen.add(k);
      return true;
    });
    all.sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
    return all.slice(-MAX_LOG);
  }

  return { between, merge, key, MAX_LOG };
})();

if(typeof module !== "undefined" && module.exports) module.exports = LogChanges;
