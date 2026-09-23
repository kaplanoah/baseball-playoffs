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
        return `${logChip(e.in)} take the last ${lg(e.in)} spot from the ${logChip(e.out)}`;
      if(e.in) return `${logChip(e.in)} into the projected field`;
      if(e.out) return `${logChip(e.out)} out of the projected field`;
      return "";
    case "seed": {
      const where = `the ${lg(e.team)} ${e.to} seed`;
      return e.over
        ? `${logChip(e.team)} passed the ${logChip(e.over)} for ${where}`
        : `${logChip(e.team)} up to ${where}, from ${e.from}`;
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
