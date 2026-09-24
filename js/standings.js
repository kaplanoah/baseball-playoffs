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
    <td class="team">${teamTag(t.id)}</td>
    ${cells}
  </tr>`;
  // One cell spanning the table, so the dashes run at a single even pitch.
  return opts.cut
    ? `${row}<tr class="cutline"><td colspan="${opts.cols}"></td></tr>`
    : row;
}

/* The same column widths in every table, division and wild card alike, so
   W through Next line up down the whole page. The wild card's place number
   comes out of its team column, which keeps every column to the right in
   step, and Next takes whatever is left. Widths live in styles.css. */
function stCols(wild, next){
  return `<colgroup>${wild ? '<col class="c-num">' : ""}<col class="c-rank"><col class="c-seed"><col class="${wild ? "c-team-wc" : "c-team"}">` +
    `<col class="c-w"><col class="c-l"><col class="c-pct"><col class="c-gb"><col class="c-e">` +
    `${next ? "<col>" : ""}</colgroup>`;
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
    <div class="st-scroll"><table class="st">
      ${stCols(false, anyNext)}
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
    </table></div>
  </div>`;
}

/* The wild card race is the same clubs minus the three division leaders, in
   MLB's own order, with a line where the field cuts off. */
function wildCardBlock(lg, all){
  const pool = DIV_ORDER.filter(d => d.startsWith(lg))
    .flatMap(d => (all[d] || []).filter(t => !t.lead))
    /* Alive first, then by rank. This is a RACE table -- cut line, games
       back, elimination number -- not a standings table, so a club that
       cannot win the race does not outrank one that can. MLB's own
       wildCardRank put Toronto above Baltimore at identical 77-81 records on
       a deep tiebreaker, while Baltimore held the tiebreaker that actually
       mattered (4-2 over Chicago, the club both were chasing) and Toronto
       did not (1-5). So the table showed an eliminated club above a live
       one and offered no way to tell why. */
    .sort((a,b) => {
      const ae = a.wce === "E" ? 1 : 0, be = b.wce === "E" ? 1 : 0;
      return ae !== be ? ae - be : Number(a.wcrank || 99) - Number(b.wcrank || 99);
    })
    .slice(0, 7);
  if(!pool.length) return "";
  const anyNext = pool.some(t => t.next && t.next.at);
  const cols = 9 + (anyNext ? 1 : 0);
  return `<div class="div-block">
    <div class="div-title"><span class="${lg}">${lg} Wild Card</span></div>
    <div class="st-scroll"><table class="st">
      ${stCols(true, anyNext)}
      <thead><tr>
        <th></th><th></th><th>Seed</th><th class="left">Team</th><th class="mid">W</th><th class="mid">L</th><th class="mid pct">PCT</th><th>WCGB</th>
        <th class="mid" title="${WC_TITLE}">WCE</th>${anyNext ? '<th class="left next-cell">Next</th>' : ""}
      </tr></thead>
      <tbody>${(() => { let place = 0; return pool.map((t, i) => standRow(t,
        `<td class="tabular mid">${t.w ?? ""}</td><td class="tabular mid">${t.l ?? ""}</td>` +
        `<td class="tabular mid">${t.pct ?? ""}</td><td class="tabular">${t.wcgb ?? ""}</td>` +
        elimCell(t.wce) +
        (anyNext ? (t.wce === "E" ? `<td class="next-cell"></td>` : nextCell(t)) : ""),
        { cut: i === 2, cols, out: t.wce === "E",
          /* Numbered among the living only: a club that is out holds no
             position in a race it cannot finish. */
          lead: `<td class="wc-num tabular">${t.wce === "E" ? "" : ++place}</td>` }
      )).join(""); })()}</tbody>
    </table></div>
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
  /* "now" stands where a time would, so it takes the times' color. */
  const label = Date.now() >= t + RUN_GRACE_MS ? "Update overdue" : "Updating <b>now</b>";
  return `<span>${label}${past ? ` &mdash; ${past}` : ""}</span>`;
}

/* What stamp.js needs to choose which game to name: the user's ranking, and
   whether a club is still alive. In September a club is out only when it is
   eliminated from both its division and the wild card; in October, once it
   has lost a series (or never made the field). In October a final also says
   what it did to its series. */
function stampContext(){
  const projected = !state || state.projected !== false;
  const rows = standings && standings.divisions ? Object.values(standings.divisions).flat() : [];
  const alive = id => {
    if(!projected) return !!(state.teams && state.teams[id]) && !teamEliminated(state, id);
    const r = rows.find(x => x.id === id);
    return !r || !(r.elim === "E" && r.wce === "E");
  };
  const seriesNote = g => {
    if(projected) return "";
    const br = fullBracket(state);
    const all = [br.al, br.nl].filter(Boolean).flatMap(b => [...b.wc, ...b.ds, ...b.cs]).concat(br.ws ? [br.ws] : []);
    const s = all.find(x => x.teamA && x.teamB &&
      [x.teamA, x.teamB].sort().join() === [g.away, g.home].sort().join());
    if(!s) return "";
    const hi = Math.max(s.winsA, s.winsB), lo = Math.min(s.winsA, s.winsB);
    const lead = s.winsA > s.winsB ? s.teamA : s.teamB;
    if(s.winner) return ` — ${stampName(s.winner)} win the ${seriesLabel(s.id)} ${hi}-${lo}`;
    if(hi === lo) return ` — series even ${hi}-${lo}`;
    return ` — ${stampName(lead)} now lead ${hi}-${lo}`;
  };
  return { ranking: (state && state.ranking) || [], alive, seriesNote, now: new Date() };
}

function renderStamp(){
  const el = document.getElementById("stamp");
  const lastAt = [state && state.updatedAt, standings && standings.updatedAt]
    .map(t => t ? Date.parse(t) : NaN).filter(n => !isNaN(n));
  const last = lastAt.length ? new Date(Math.max(...lastAt)).toISOString() : null;
  /* The routine records the day's games in `slate` and the sentences are
     built in stamp.js. `updatedFor` and `nextFor` are the older freehand
     lines, still read for a document written before `slate` existed. */
  let lastFor, nextFor;
  if(state && state.slate){
    const ctx = stampContext();
    lastFor = lastStampText(state.slate, ctx);
    nextFor = nextStampText(state.slate, state.nextAt, ctx);
  } else {
    lastFor = state && state.updatedFor;
    nextFor = state && state.nextFor;
  }
  lastFor = dedupeSlate(lastFor, nextFor);
  const lines = [
    stampLine("Last updated", last, lastFor),
    nextLine(state && state.nextAt, nextFor)
  ].filter(Boolean).join("");
  el.hidden = !lines;
  el.innerHTML = lines;
}

/* The line above turns over on the clock, not on a write, so it needs a tick
   of its own. No network -- it re-renders two lines from state already held. */
setInterval(() => { try{ renderStamp(); }catch(e){} }, 30000);
