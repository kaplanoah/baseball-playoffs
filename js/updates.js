/* The change log: what moved since you last looked. The routine appends
   structured entries; all of the wording is built here. */

/* ---------- what's changed since you last looked ---------- */
/* The routine appends structured entries — which team, which seed, which
   series — and the wording is built here, so the log reads the same every
   time and can be restyled without touching the job that writes it. */
function seriesLabel(id){
  if(id === "WS") return "World Series";
  const [lg, key] = String(id).split("_");
  if(!key) return id;
  if(key === "CS") return `${lg}CS`;
  if(key.startsWith("DS")) return `${lg}DS`;
  return `${lg} Wild Card Series`;
}
function logChip(id){
  return TEAMS[id] ? `${teamDot(id)}<b>${teamLabel(id)}</b>` : "";
}
function score(s){ return Array.isArray(s) && s.length === 2 ? `${s[0]}&ndash;${s[1]}` : ""; }

/* Why a team moved, from the games behind it. `via` entries are
   { team, won, opp, score:[own, opp] } -- own score first however it ends, so
   a loss just reads its pair backwards ("lost to the Dodgers 4-1" is the
   Dodgers' 4 before the Padres' 1). Four shapes, because the reader's first
   question is which of the two clubs actually played:
     beat the Mets 6-2
     Padres lost to the Dodgers 4-1
     beat the Mets 6-2 and Padres lost to the Dodgers 4-1
     beat them 6-2                        (the two met)
   The mover is the subject of the sentence this tails, so its verb needs no
   subject; the other club is always named. */
function pair(n){ return Array.isArray(n) && n.length === 2 ? `${n[0]}-${n[1]}` : ""; }
function viaText(e, mover, other){
  const v = Array.isArray(e.via) ? e.via : [];
  const mine = v.find(x => x && x.team === mover);
  const theirs = v.find(x => x && x.team === other);
  if(mine && mine.won && mine.opp === other) return `beat them ${pair(mine.score)}`;
  const parts = [];
  if(mine && TEAMS[mine.opp]){
    parts.push(mine.won
      ? `beat the ${teamLabel(mine.opp)} ${pair(mine.score)}`
      : `lost to the ${teamLabel(mine.opp)} ${pair([mine.score[1], mine.score[0]])}`);
  }
  if(theirs && TEAMS[theirs.opp] && TEAMS[other]){
    parts.push(`${teamLabel(other)} ${theirs.won
      ? `beat the ${teamLabel(theirs.opp)} ${pair(theirs.score)}`
      : `lost to the ${teamLabel(theirs.opp)} ${pair([theirs.score[1], theirs.score[0]])}`}`);
  }
  return parts.join(" and ");
}
function withVia(sentence, e, mover, other){
  const why = viaText(e, mover, other);
  return why ? `${sentence} &mdash; ${why}` : sentence;
}

function entryText(e){
  const lg = id => (TEAMS[id] ? TEAMS[id].league : "");
  switch(e.kind){
    /* "in, out" read as elimination. Nothing in the line said what they were
       in and out OF, and a club can leave the projected field while sitting in
       first place -- the Rangers did, at 78-79 and tied for the AL West lead.
       Naming the spot makes it a position changing hands, which is all that
       happened. The one-sided cases below always said "the projected field";
       the swap was the only branch that dropped it. */
    case "field":
      if(e.in && e.out)
        return withVia(`${logChip(e.in)} take the last ${lg(e.in)} spot from the ${logChip(e.out)}`, e, e.in, e.out);
      if(e.in) return `${logChip(e.in)} into the projected field`;
      if(e.out) return `${logChip(e.out)} out of the projected field`;
      return "";
    case "seed": {
      const where = `the ${lg(e.team)} ${e.to} seed`;
      return e.over
        ? withVia(`${logChip(e.team)} passed the ${logChip(e.over)} for ${where}`, e, e.team, e.over)
        : withVia(`${logChip(e.team)} up to ${where}, from ${e.from}`, e, e.team, null);
    }
    case "game": {
      const g = e.game ? `Game ${e.game}` : "a game";
      const st = Array.isArray(e.score)
        ? (e.score[0] > e.score[1] ? "lead" : e.score[0] === e.score[1] ? "even" : "trail")
        : "";
      const tail = st ? ` &mdash; ${st} the ${seriesLabel(e.series)} ${score(e.score)}` : ` of the ${seriesLabel(e.series)}`;
      return `${logChip(e.won)} took ${g}${tail}`;
    }
    case "clinch": {
      const over = e.over ? ` over the ${logChip(e.over)}` : "";
      const sc = score(e.score) ? `, ${score(e.score)}` : "";
      return `${logChip(e.team)} win the ${seriesLabel(e.series)}${sc}${over}`;
    }
    case "lock": return "The official bracket is set";
    default: return e.text || "";
  }
}

/* Recent entries want the day, older ones the date — "Sunday" stops meaning
   anything once it could be one of several Sundays. */
const DAYS = ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];
function dayDiff(then, now){
  const a = new Date(then.getFullYear(), then.getMonth(), then.getDate());
  const b = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((b - a) / 86400000);
}
function whenLabel(iso, now = new Date()){
  const d = new Date(iso);
  if(isNaN(d)) return "";
  const days = dayDiff(d, now);
  if(days <= 0) return d.toLocaleTimeString([], {hour:"numeric", minute:"2-digit"});
  if(days === 1) return "Yesterday";
  if(days < 7) return DAYS[d.getDay()];
  return d.toLocaleDateString([], {month:"short", day:"numeric"});
}
function sinceLabel(iso, now = new Date()){
  const d = new Date(iso);
  if(isNaN(d)) return "";
  const days = dayDiff(d, now);
  if(days <= 0) return "since earlier today";
  if(days === 1) return "since yesterday";
  if(days < 7) return `since ${DAYS[d.getDay()]}`;
  return `since ${d.toLocaleDateString([], {month:"short", day:"numeric"})}`;
}

const MAX_SHOWN = 12;
function renderUpdates(){
  const el = document.getElementById("updates");
  const seen = state.seenAt ? Date.parse(state.seenAt) : 0;
  const fresh = (state.log || [])
    .filter(e => e && (!seen || Date.parse(e.at) > seen))
    .sort((a,b) => Date.parse(b.at) - Date.parse(a.at));

  if(!fresh.length){ el.hidden = true; el.innerHTML = ""; return; }
  el.hidden = false;

  const shown = fresh.slice(0, MAX_SHOWN);
  const extra = fresh.length - shown.length;
  const head = `${fresh.length} update${fresh.length === 1 ? "" : "s"}` +
    (state.seenAt ? ` ${sinceLabel(state.seenAt)}` : "");

  el.innerHTML = `
    <div class="updates-head">
      <span class="updates-count">${head}</span>
      <button class="updates-x" id="dismissUpdates" aria-label="Dismiss updates" title="Dismiss">&times;</button>
    </div>
    <ul class="updates-list">
      ${shown.map(e => {
        const text = entryText(e);
        return text ? `<li><span class="when">${whenLabel(e.at)}</span><span class="what">${text}</span></li>` : "";
      }).join("")}
      ${extra > 0 ? `<li class="more">and ${extra} more</li>` : ""}
    </ul>`;
  document.getElementById("dismissUpdates").addEventListener("click", dismissUpdates);
}
