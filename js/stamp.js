function stampClock(iso) {
  return new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}
function stampName(id) {
  return TEAMS[id] ? TEAMS[id].name : id;
}
function ordinal(n) {
  const s = ["th", "st", "nd", "rd"],
    v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

function finalPhrase(g, day) {
  const [a, h] = g.score || [0, 0];
  const [w, wr, l, lr] = a > h ? [g.away, a, g.home, h] : [g.home, h, g.away, a];
  return `${stampName(w)} ${wr} ${stampName(l)} ${lr} final at ${stampClock(g.end)}${day ? " " + day : ""}`;
}
function livePhrase(g) {
  const [a, h] = g.score || [0, 0];
  return `${stampName(g.away)} @ ${stampName(g.home)} ${a}-${h} in the ${ordinal(g.inning || 1)}`;
}
function firstPitchPhrase(g) {
  return `${stampName(g.away)} @ ${stampName(g.home)} first pitch at ${stampClock(g.start)}`;
}
function gamePhrase(g) {
  return g.state === "final"
    ? finalPhrase(g)
    : g.state === "live"
      ? livePhrase(g)
      : firstPitchPhrase(g);
}

function slateClause(games) {
  if (games.length < 3) return "";
  return games.every((g) => g.state === "final")
    ? `slate of ${games.length} over`
    : `slate of ${games.length} under way`;
}
const withClause = (phrase, clause) => (clause ? `${phrase}, ${clause}` : phrase);

function gameRank(g, ctx) {
  const r = [g.away, g.home].map((id) => ctx.ranking.indexOf(id)).filter((i) => i >= 0);
  return r.length ? Math.min(...r) : Infinity;
}
function gameAlive(g, ctx) {
  return ctx.alive(g.away) || ctx.alive(g.home) ? 0 : 1;
}
const stampMs = (iso) => Date.parse(iso);
function pick(games, ctx, order) {
  const keys = {
    latestEnd: (g) => -stampMs(g.end),
    earliest: (g) => stampMs(g.start),
    latestStart: (g) => -stampMs(g.start),
    rank: (g) => gameRank(g, ctx),
    alive: (g) => gameAlive(g, ctx),
  };
  return games.slice().sort((x, y) => {
    for (const k of order) {
      const d = keys[k](x) - keys[k](y);
      if (d) return d;
    }
    return 0;
  })[0];
}
const PICK_ENDED = ["latestEnd", "rank", "alive"];
const PICK_UNDER_WAY = ["rank", "alive", "latestStart"];
const PICK_STARTS = ["earliest", "rank", "alive"];

function lastStampText(slate, ctx) {
  const games = (slate.today && slate.today.games) || [];
  const started = games.filter((g) => g.state !== "pre");
  if (!started.length) {
    const lf = slate.lastFinal;
    if (!lf || !lf.end) return "";
    const days = dayDiff(new Date(lf.end), ctx.now);
    const when = days <= 1 ? "last night" : DAYS[new Date(lf.start || lf.end).getDay()];
    return `No games since ${finalPhrase(lf, when)}`;
  }
  const note = (g) => (g.state === "final" && ctx.seriesNote && ctx.seriesNote(g)) || "";
  if (games.length <= 2) {
    return started
      .slice()
      .sort((x, y) => stampMs(x.start) - stampMs(y.start))
      .map((g) => gamePhrase(g) + note(g))
      .join(", ");
  }
  const since = slate.since ? stampMs(slate.since) : -Infinity;
  const finals = started.filter((g) => g.state === "final");
  const fresh = finals.filter((g) => stampMs(g.end) > since);
  const live = started.filter((g) => g.state === "live");
  const g = fresh.length
    ? pick(fresh, ctx, PICK_ENDED)
    : live.length
      ? pick(live, ctx, PICK_UNDER_WAY)
      : pick(finals, ctx, PICK_ENDED);
  return withClause(gamePhrase(g) + note(g), slateClause(games));
}

function upNextText(slate, ctx) {
  const days = [slate.today, slate.nextDay].filter(Boolean);
  if (days.some((d) => (d.games || []).some((g) => g.state === "live"))) return null;
  for (const day of days) {
    const games = day.games || [];
    const ahead = games.filter((g) => g.state === "pre");
    if (!ahead.length) continue;
    const g = pick(ahead, ctx, PICK_STARTS);
    const what = `${stampName(g.away)} @ ${stampName(g.home)}`;
    const begun = games.some((x) => x.state !== "pre");
    return {
      at: g.start,
      tbd: !!g.tbd,
      text: !begun && games.length >= 3 ? `${what}, first of ${games.length}` : what,
    };
  }
  return null;
}

function stampWhen(d, now = new Date()) {
  const time = d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  const day = stampDay(d, now);
  return day === "today" ? time : `${day} ${time}`;
}
function stampWhenHtml(d, now = new Date()) {
  return stampWhen(d, now).replace(/^(.*\d)\s*(\D+)$/, '$1<span class="ap">$2</span>');
}
function stampDay(d, now = new Date()) {
  const days = dayDiff(d, now);
  if (days === 0) return "today";
  if (days === 1) return "yesterday";
  if (days === -1) return "tomorrow";
  if (Math.abs(days) < 7) return DAYS[d.getDay()];
  return d.toLocaleDateString([], { month: "short", day: "numeric" });
}
