/* Divisions and the wild card race, plus the freshness stamp, all of it from
   the standings document the routine writes alongside the season. */

/* ---------- standings ---------- */
const DIV_ORDER = ["AL East","AL Central","AL West","NL East","NL Central","NL West"];
const E_TITLE = "Division elimination number: combined wins by the division leader and losses by this team that would end its division chances. A dash means clinched, E means out.";
const WC_TITLE = "Wild card elimination number: combined wins by the team holding the last spot and losses by this team that would end its wild card chances. A dash means clinched, E means out.";

function elimCell(v){
  if(v === "E") return `<td class="elim-num mid">E</td>`;
  if(v == null || v === "-") return `<td class="elim-num clinched mid">&mdash;</td>`;
  return `<td class="elim-num live tabular mid">${v}</td>`;
}

/* "Today 8:05 vs HOU" — short enough for a column, and the opponent as an id
   rather than a name, since the club's own name is two cells to the left. */
function nextCell(t){
  const n = t.next;
  if(!n || !n.at) return `<td class="next-cell"></td>`;
  const d = new Date(n.at);
  if(isNaN(d)) return `<td class="next-cell"></td>`;
  const days = dayDiff(d, new Date());
  const day = days === 0 ? "Today" : DAYS[d.getDay()].slice(0, 3);
  const time = n.tbd ? "" : " " + d.toLocaleTimeString([], {hour:"numeric", minute:"2-digit"})
    .replace(/\s?[AP]M$/i, "");
  return `<td class="next-cell">${day}${time} ${n.home ? "vs" : "@"} ${n.opp || ""}</td>`;
}

/* Each table asks one question, so each has one kind of elimination: the
   division tables mean out of the division, the wild card tables mean out of
   the wild card. A club still in the race reads at full strength whether or
   not it's in the projected field; a club that's out goes dim. One green. */
function standRow(t, cells, opts = {}){
  const seed = state.teams[t.id] && state.teams[t.id].seed;
  const cls = opts.out ? "eliminated" : "alive";
  const row = `<tr class="${cls} ${opts.cut ? "cut" : ""}">
    ${opts.lead || ""}<td class="rank-cell">${rankTag(t.id)}</td>
    <td class="seed-cell">${seed || ""}</td>
    <td class="team"><span class="st-team">${teamDot(t.id)}<span class="name">${teamLabel(t.id)}</span></span></td>
    ${cells}
  </tr>`;
  // One cell spanning the table, so the dashes run at a single even pitch.
  return opts.cut
    ? `${row}<tr class="cutline"><td colspan="${opts.cols}"></td></tr>`
    : row;
}

function divisionBlock(name, rows){
  const lg = name.slice(0, 2);
  const leader = rows[0] || {};
  const tag = leader.clinched
    ? `<span class="clinch-tag">clinched</span>`
    : (leader.magic ? `<span class="magic-tag">magic ${leader.magic}</span>` : "");
  const anyNext = rows.some(t => t.next && t.next.at);
  return `<div class="div-block">
    <div class="div-title">
      <span class="${lg}">${name}</span><span class="title-right">${tag}</span>
    </div>
    <table class="st">
      <thead><tr>
        <th></th><th>Seed</th><th class="left">Team</th><th class="mid">W</th><th class="mid">L</th><th class="mid pct">PCT</th><th>GB</th>
        <th class="mid" title="${E_TITLE}">E#</th>${anyNext ? '<th class="left next-cell">Next</th>' : ""}
      </tr></thead>
      <tbody>${rows.map(t => standRow(t,
        `<td class="tabular mid">${t.w ?? ""}</td><td class="tabular mid">${t.l ?? ""}</td>` +
        `<td class="tabular mid">${t.pct ?? ""}</td><td class="tabular">${t.gb ?? ""}</td>` +
        elimCell(t.elim) +
        (anyNext ? (t.elim === "E" ? `<td class="next-cell"></td>` : nextCell(t)) : ""),
        { out: t.elim === "E" }
      )).join("")}</tbody>
    </table>
  </div>`;
}

/* The wild card race is the same clubs minus the three division leaders, in
   MLB's own order, with a line where the field cuts off. */
function wildCardBlock(lg, all){
  const pool = DIV_ORDER.filter(d => d.startsWith(lg))
    .flatMap(d => (all[d] || []).filter(t => !t.lead))
    .sort((a,b) => Number(a.wcrank || 99) - Number(b.wcrank || 99))
    .slice(0, 7);
  if(!pool.length) return "";
  const anyNext = pool.some(t => t.next && t.next.at);
  const cols = 9 + (anyNext ? 1 : 0);
  return `<div class="div-block">
    <div class="div-title"><span class="${lg}">${lg} Wild Card</span></div>
    <table class="st">
      <thead><tr>
        <th></th><th></th><th>Seed</th><th class="left">Team</th><th class="mid">W</th><th class="mid">L</th><th class="mid pct">PCT</th><th>WCGB</th>
        <th class="mid" title="${WC_TITLE}">WCE</th>${anyNext ? '<th class="left next-cell">Next</th>' : ""}
      </tr></thead>
      <tbody>${pool.map((t, i) => standRow(t,
        `<td class="tabular mid">${t.w ?? ""}</td><td class="tabular mid">${t.l ?? ""}</td>` +
        `<td class="tabular mid">${t.pct ?? ""}</td><td class="tabular">${t.wcgb ?? ""}</td>` +
        elimCell(t.wce) +
        (anyNext ? (t.wce === "E" ? `<td class="next-cell"></td>` : nextCell(t)) : ""),
        { cut: i === 2, cols, out: t.wce === "E", lead: `<td class="wc-num tabular">${t.wcrank || ""}</td>` }
      )).join("")}</tbody>
    </table>
  </div>`;
}

function renderStandings(){
  const wrap = document.getElementById("standingsWrap");
  const divs = standings && standings.divisions;
  if(!divs || !Object.keys(divs).length){
    wrap.innerHTML = `<p class="stand-empty">The scheduled update hasn't filed a standings table for
      this season yet. It arrives with the next run.</p>`;
    return;
  }
  const blocks = DIV_ORDER.filter(d => divs[d] && divs[d].length)
    .map(d => divisionBlock(d, divs[d])).join("");
  const races = ["AL","NL"].map(lg => wildCardBlock(lg, divs)).join("");
  wrap.innerHTML = `
    <div class="stand-head">Divisions</div>
    <div class="div-grid">${blocks}</div>
    ${races ? `<div class="stand-head second">Wild Card</div><div class="wc-grid">${races}</div>` : ""}`;
}

/* Two lines: when the routine last ran and what it found, then when it runs
   next and what it will be looking at. The reasons are the routine's own
   words for the games involved, so a quiet stretch explains itself. */
function stampLine(label, iso, why){
  const t = iso ? Date.parse(iso) : NaN;
  if(isNaN(t)) return "";
  /* .stamp is a flex column, so each line needs an element of its own. */
  return `<span>${label} <b>${stampWhen(new Date(t))}</b>${
    why ? ` &mdash; ${why}` : ""}</span>`;
}

/* The stamp points both ways, so unlike the log -- where every entry is in the
   past and the day alone is enough -- a time here keeps its clock and names
   its day when that isn't today. Without this, a check at 2pm tomorrow read
   as plain "2:00 PM" and the routine had to smuggle the day into its reason. */
function stampWhen(d, now = new Date()){
  const time = d.toLocaleTimeString([], {hour:"numeric", minute:"2-digit"});
  const days = dayDiff(d, now);          // positive in the past, negative ahead
  if(days === 0) return time;
  if(days === 1) return `yesterday ${time}`;
  if(days === -1) return `tomorrow ${time}`;
  if(Math.abs(days) < 7) return `${DAYS[d.getDay()]} ${time}`;
  return `${d.toLocaleDateString([], {month:"short", day:"numeric"})} ${time}`;
}
/* The second line names a time that passes while the page sits open, so it has
   three states rather than one: a promise, the few minutes the run should be
   taking, and the point where it plainly is not coming. A run takes three or
   four minutes, so ten is a generous grace. */
const RUN_GRACE_MS = 10 * 60 * 1000;

function nextLine(iso, why){
  const t = iso ? Date.parse(iso) : NaN;
  if(isNaN(t)) return "";
  if(Date.now() < t) return stampLine("Next update", iso, why);
  /* The routine wrote this reason in the future tense, for a check that has
     now started. "starts with" is the only verb the wording rules produce
     here; everything else ("first pitch at 9:40") reads the same either way. */
  const past = why ? why.replace(" starts with ", " started with ") : why;
  const label = Date.now() >= t + RUN_GRACE_MS ? "Update overdue" : "Updating now";
  return `<span>${label}${past ? ` &mdash; ${past}` : ""}</span>`;
}

function renderStamp(){
  const el = document.getElementById("stamp");
  const lastAt = [state && state.updatedAt, standings && standings.updatedAt]
    .map(t => t ? Date.parse(t) : NaN).filter(n => !isNaN(n));
  const last = lastAt.length ? new Date(Math.max(...lastAt)).toISOString() : null;
  const lines = [
    stampLine("Last updated", last, state && state.updatedFor),
    nextLine(state && state.nextAt, state && state.nextFor)
  ].filter(Boolean).join("");
  el.hidden = !lines;
  el.innerHTML = lines;
}

/* The line above turns over on the clock, not on a write, so it needs a tick
   of its own. No network -- it re-renders two lines from state already held. */
setInterval(() => { try{ renderStamp(); }catch(e){} }, 30000);
