/* The two freshness lines under the title, built from the facts the routine
   records rather than from sentences it writes.

   The routine used to write both lines freehand, following several pages of
   wording rules, and every run could invent a new shape: a bare "White Sox @
   Royals", a slate clause dropped from one line, "under way" for a game hours
   away. Now it writes `slate` -- the day's games with their state, score,
   inning, first pitch and end -- and every sentence is built here, where the
   rules are code and tests/stamp.test.js pins each shape down.

   Pure functions: no DOM, no globals but TEAMS, DAYS and dayDiff. The caller
   passes a context with the user's ranking and who is still alive. */

/* ---------- pieces ---------- */
function stampClock(iso){
  return new Date(iso).toLocaleTimeString([], {hour:"numeric", minute:"2-digit"});
}
function stampName(id){ return TEAMS[id] ? TEAMS[id].name : id; }
function ordinal(n){
  const s = ["th","st","nd","rd"], v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

/* Every game carries its state, and the state carries its clock. */
function finalPhrase(g, when){
  const [a, h] = g.score || [0, 0];
  const [w, wr, l, lr] = a > h ? [g.away, a, g.home, h] : [g.home, h, g.away, a];
  return `${stampName(w)} ${wr} ${stampName(l)} ${lr} final ${when || "at " + stampClock(g.end)}`;
}
function livePhrase(g){
  const [a, h] = g.score || [0, 0];
  return `${stampName(g.away)} @ ${stampName(g.home)} ${a}-${h} in the ${ordinal(g.inning || 1)}`;
}
/* A game that is on, or will be on, at the next check is named by its first
   pitch: its inning isn't known ahead of time, and the first pitch says what
   the check is for whether the game has started yet or not. */
function firstPitchPhrase(g){
  return `${stampName(g.away)} @ ${stampName(g.home)} first pitch at ${stampClock(g.start)}`;
}
function gamePhrase(g){
  return g.state === "final" ? finalPhrase(g) : g.state === "live" ? livePhrase(g) : firstPitchPhrase(g);
}

/* THE NUMBER IS THE WHOLE DAY, and the clause has two states and no more. */
function slateClause(games){
  if(games.length < 3) return "";
  return games.every(g => g.state === "final")
    ? `slate of ${games.length} over`
    : `slate of ${games.length} under way`;
}
const withClause = (phrase, clause) => clause ? `${phrase}, ${clause}` : phrase;

/* ---------- which game to name ----------
   A game counts as the better of its two clubs' places in the user's
   ranking; a game with neither club ranked loses to any game with one. A game
   whose clubs are both out loses to any game with a club still alive. */
function gameRank(g, ctx){
  const r = [g.away, g.home].map(id => ctx.ranking.indexOf(id)).filter(i => i >= 0);
  return r.length ? Math.min(...r) : Infinity;
}
function gameAlive(g, ctx){ return ctx.alive(g.away) || ctx.alive(g.home) ? 0 : 1; }
const stampMs = iso => Date.parse(iso);
function pick(games, ctx, order){
  const keys = {
    latestEnd:   g => -stampMs(g.end),
    earliest:    g => stampMs(g.start),
    latestStart: g => -stampMs(g.start),
    rank:        g => gameRank(g, ctx),
    alive:       g => gameAlive(g, ctx)
  };
  return games.slice().sort((x, y) => {
    for(const k of order){
      const d = keys[k](x) - keys[k](y);
      if(d) return d;
    }
    return 0;
  })[0];
}
const PICK_ENDED = ["latestEnd", "rank", "alive"];
const PICK_UNDER_WAY = ["rank", "alive", "latestStart"];
const PICK_STARTS = ["earliest", "rank", "alive"];

/* ---------- the two lines ---------- */

/* What the last run found: written from then, looking back, so it names only
   baseball that has happened, and never an absence. */
function lastStampText(slate, ctx){
  const games = (slate.today && slate.today.games) || [];
  const started = games.filter(g => g.state !== "pre");
  if(!started.length){
    const lf = slate.lastFinal;
    if(!lf || !lf.end) return "";
    const days = dayDiff(new Date(lf.end), ctx.now);
    const when = days <= 1 ? "last night" : DAYS[new Date(lf.start || lf.end).getDay()];
    return `No games since ${finalPhrase(lf, when)}`;
  }
  const note = g => (g.state === "final" && ctx.seriesNote && ctx.seriesNote(g)) || "";
  if(games.length <= 2){
    return started.slice().sort((x, y) => stampMs(x.start) - stampMs(y.start))
      .map(g => gamePhrase(g) + note(g)).join(", ");
  }
  const since = slate.since ? stampMs(slate.since) : -Infinity;
  const finals = started.filter(g => g.state === "final");
  const fresh = finals.filter(g => stampMs(g.end) > since);
  const live = started.filter(g => g.state === "live");
  const g = fresh.length ? pick(fresh, ctx, PICK_ENDED)
          : live.length  ? pick(live, ctx, PICK_UNDER_WAY)
          :                pick(finals, ctx, PICK_ENDED);
  return withClause(gamePhrase(g) + note(g), slateClause(games));
}

/* What the next check is for: judged at the check, not now. */
function nextStampText(slate, nextAt, ctx){
  if(!nextAt) return "";
  const slot = stampMs(nextAt);
  /* nextDay only counts when it really is a later day than today: a stale
     one left behind by a partial write must not describe tonight. */
  const later = slate.nextDay && slate.today && slate.nextDay.date > slate.today.date;
  const day = later ? slate.nextDay : slate.today;
  const games = (day && day.games) || [];
  if(!games.length) return "routine check, no games today";
  const open = games.filter(g => g.state !== "final");
  const onAtSlot = open.filter(g => stampMs(g.start) <= slot);
  const ahead = open.filter(g => stampMs(g.start) > slot);
  const begun = games.some(g => g.state !== "pre");
  const n = games.length;
  const names = list => list.slice().sort((x, y) => stampMs(x.start) - stampMs(y.start)).map(firstPitchPhrase).join(", ");

  if(onAtSlot.length){
    /* Nothing has started as this is written: the line is read from now
       until the check, often for hours, so it names the day's first pitch
       rather than saying "under way" about a game that isn't yet. */
    if(!begun) return n >= 3 ? `slate of ${n} starts with ${firstPitchPhrase(pick(open, ctx, PICK_STARTS))}` : names(open);
    if(n <= 2) return names(open);
    return `${firstPitchPhrase(pick(onAtSlot, ctx, PICK_UNDER_WAY))}, slate of ${n} under way`;
  }
  /* The check lands where there is nothing to find yet: say so, then give
     the baseball it is waiting on in full. */
  if(ahead.length){
    if(n <= 2) return `routine check, ${names(ahead)}`;
    const g = pick(ahead, ctx, PICK_STARTS);
    return begun
      ? `routine check, ${firstPitchPhrase(g)}, slate of ${n} under way`
      : `routine check, slate of ${n} starts with ${firstPitchPhrase(g)}`;
  }
  return "routine check, nothing left tonight";
}

/* Both lines often close on the same slate clause. Said twice it is noise,
   so it stays on the second line only, which is where the day is still
   going. When the two clauses differ, both keep theirs. */
function dedupeSlate(last, next){
  const SLATE = /, (slate of .+)$/;
  const a = last && last.match(SLATE), b = next && next.match(SLATE);
  return a && b && a[1] === b[1] ? last.replace(SLATE, "") : last;
}
