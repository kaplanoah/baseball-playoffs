/* UI: loads the season doc from the artifact store, renders the bracket,
   ranking and reference views, and saves the user's ranking order.
   Series results are written by the scheduled routine, not from here. */

const CURRENT_YEAR = new Date().getFullYear();
const seasonYear = () => (new Date().getMonth() >= 8 ? CURRENT_YEAR : CURRENT_YEAR - 1);

let db = null;
let state = null;
let years = [];
let activeYear = seasonYear();
let trackedTitles = {}; // team id -> most recent year it won a tracked World Series
let unwatchSeason = null;
let unwatchStandings = null;
let standings = null; // regular-season table for the active year, or null
let reordering = false; // true mid-drag, so a live update can't yank the list

function emptySeason(year){
  return { year, teams:{}, series:{}, ranking:[], log:[] };
}

/* ---------- persistence ---------- */
async function loadSeasonList(){
  const snap = await db.collection("seasons").limit(50).get();
  years = snap.docs.map(d => d.id).sort().reverse();
  if(!years.includes(String(activeYear))) years = [String(activeYear), ...years];
  years = [...new Set(years)];

  // Every season this tool has tracked already records who won the World
  // Series, so titles stay current on their own — teams.js only has to cover
  // what happened before it existed.
  trackedTitles = {};
  snap.docs.forEach(d => {
    const doc = d.data();
    if(!doc || !doc.teams || !doc.series) return;
    const year = Number(doc.year ?? d.id);
    const champ = fullBracket(doc).ws?.winner;
    if(champ && Number.isFinite(year) && !(trackedTitles[champ] >= year)){
      trackedTitles[champ] = year;
    }
  });
}

// Most recent World Series win: whatever this tool has seen, else the seed data.
function lastTitle(id){
  const seeded = TEAMS[id].lastWS;
  const tracked = trackedTitles[id];
  if(seeded && tracked) return Math.max(seeded, tracked);
  return tracked || seeded;
}

function droughtLabel(id){
  const won = lastTitle(id);
  if(!won) return "since 1969";
  if(won >= seasonYear()) return "reigning";
  const n = seasonYear() - won;
  return n + (n === 1 ? " yr" : " yrs");
}
function normalize(doc, year){
  const s = doc || emptySeason(year);
  if(!s.teams) s.teams = {};
  if(!s.series) s.series = {};
  if(!s.ranking) s.ranking = [];
  if(!Array.isArray(s.log)) s.log = [];
  return s;
}

async function loadSeason(year){
  const snap = await db.doc(`seasons/${year}`).get();
  state = normalize(snap.exists ? snap.data() : null, year);
}

/* The 30-club regular-season table, written by the same routine. It lives in
   its own document because it's five times the size of the season doc and
   stops changing entirely once October starts. */
async function loadStandings(year){
  standings = null;
  if(!db) return;
  try{
    const snap = await db.doc(`standings/${year}`).get();
    if(snap.exists) standings = snap.data();
  }catch(e){ standings = null; }
}
function watchStandings(year){
  if(unwatchStandings){ unwatchStandings(); unwatchStandings = null; }
  if(!db) return;
  unwatchStandings = db.doc(`standings/${year}`).onSnapshot(snap => {
    if(!snap.exists) return;
    const incoming = snap.data();
    if(JSON.stringify(incoming) === JSON.stringify(standings)) return;
    standings = incoming;
    renderStandings();
    renderStamp();
  }, () => {});
}

/* Stay subscribed so the routine's scores and field changes land without a
   reload, instead of this page holding a copy that drifts for hours. */
function watchSeason(year){
  if(unwatchSeason){ unwatchSeason(); unwatchSeason = null; }
  if(!db) return;
  unwatchSeason = db.doc(`seasons/${year}`).onSnapshot(snap => {
    if(!snap.exists || reordering) return;
    const incoming = normalize(snap.data(), year);
    if(JSON.stringify(incoming) === JSON.stringify(state)) return;
    state = incoming;
    renderAll();
  }, () => {});
}
/* Write only the fields this page owns. Writing the whole document would send
   our in-memory copy of everything else back too, and that copy goes stale the
   moment the routine updates the field — which is how a saved ranking gets
   overwritten by a reload of an older one. */
async function writeSeason(fields){
  if(!db) return;
  const ref = db.doc(`seasons/${activeYear}`);
  try{
    await ref.update(fields);
  }catch(e){
    // update() rejects when the document doesn't exist yet; create it once.
    await ref.set({ year: activeYear, teams:{}, series:{}, ranking:[], log:[], ...fields });
  }
}

async function saveTeams(teamsMap){
  state.teams = teamsMap;
  state.ranking = Object.keys(teamsMap).sort((a,b) => teamsMap[a].seed - teamsMap[b].seed);
  state.series = {};
  await writeSeason({ teams: state.teams, series: {}, ranking: state.ranking });
}
async function saveRanking(order){
  state.ranking = order;
  await writeSeason({ ranking: order });
}

/* Dismissing marks everything logged so far as read. It's stored in the season
   doc rather than in this browser, so clearing the log on a laptop also clears
   it on a phone — "since I last looked" is about you, not about a device. */
async function dismissUpdates(){
  const at = new Date().toISOString();
  state.seenAt = at;
  renderUpdates();
  await writeSeason({ seenAt: at });
}

/* ---------- shared render helpers ---------- */
const perceivedLightness = hex => {
  const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
  return 0.299 * r + 0.587 * g + 0.114 * b;
};

/* Split vertically, not diagonally: the dot's inner shadow falls across its
   top edge, and on a diagonal that shades the primary's corner while leaving
   the secondary untouched. Side by side, both halves take the same shading.

   A light color also reads larger than a dark one at equal area, so when the
   secondary is much lighter the boundary moves a little to even them out. */
function teamDot(id){
  const t = TEAMS[id];
  if(!t) return `<span class="dot" style="background:#999"></span>`;
  const contrastGap = perceivedLightness(t.color2) - perceivedLightness(t.color);
  const split = contrastGap > 90 ? 54 : contrastGap < -90 ? 46 : 50;
  return `<span class="dot" style="background:linear-gradient(90deg, ${t.color} ${split}%, ${t.color2} ${split}%)"></span>`;
}
function teamLabel(id){ return TEAMS[id] ? TEAMS[id].name : "?"; }
// A bare digit, the way a lineup card carries a uniform number.
function seedMark(seed){ return seed ? `<span class="seed-pre tabular">${seed}</span>` : ""; }
/* `solid` fills the tag, marking the team you rank higher in a given matchup.
   The slot is a fixed width so a two-digit rank doesn't push the dot and name
   further right than a one-digit one; the tag itself still hugs its text. */
function rankTag(id, solid){
  const idx = state.ranking.indexOf(id);
  if(idx === -1) return "";
  return `<span class="rank-slot"><span class="rank-tag ${solid ? "solid" : ""}">#${idx+1}</span></span>`;
}

/* Which side of this matchup you rank higher. A slot that's still TBD doesn't
   stop this: if you rank the known team above — or below — everyone who could
   still arrive, the answer can't change once they do, so say so now. Unranked
   teams sort last, which is what an empty ranking slot means. */
function preferredSide(s){
  const rank = id => { const i = state.ranking.indexOf(id); return i === -1 ? Infinity : i; };
  const a = (s.teamA ? [s.teamA] : slotCandidates(state, s.id, "A")).map(rank);
  const b = (s.teamB ? [s.teamB] : slotCandidates(state, s.id, "B")).map(rank);
  if(!a.length || !b.length) return null;
  if(Math.max(...a) < Math.min(...b)) return "A";
  if(Math.max(...b) < Math.min(...a)) return "B";
  return null;
}

function matchupRow(s, side){
  const id = side === "A" ? s.teamA : s.teamB;
  const wins = side === "A" ? s.winsA : s.winsB;
  if(!id) return `<div class="matchup-row"><span class="tbd">TBD</span></div>`;
  const isWinner = s.winner === id;
  const isLoser = s.winner && s.winner !== id;
  const isPreferred = preferredSide(s) === side;
  const seed = state.teams[id] && state.teams[id].seed;
  return `<div class="matchup-row ${isWinner?'winner':''} ${isLoser?'eliminated':''}">
    <div class="team-id">${rankTag(id, isPreferred)}${seedMark(seed)}${teamDot(id)}<span class="team-name">${TEAMS[id].name}</span></div>
    <span class="nscore tabular ${isWinner?'lead':''}">${wins}</span>
  </div>`;
}

/* Bracket geometry, in card-top coordinates. Card metrics mirror styles.css:
   a card is 90px tall, its top row centered 41px down, the divider between its
   two teams at 57px, its bottom row at 73px.

   Both division cards keep the host at the bottom and the incoming wild-card
   slot on top, so both wild card cards sit 16px above their partner (57 - 41)
   and their connectors run dead straight into that slot. Division and
   championship lines converge on the next card's divider instead of a
   particular row, which is what lets those rows reorder by host without the
   lines crossing. */
const LAY = {
  colW:208, gap:20,
  cardH:90, rowTopY:41, rowDivY:57, rowBotY:73,
  stageH:400, // room for a next-game note under the lowest cards
  yWc1:24, yDs1:40, yMid:160, yDs2:280, yWc2:264
};
const colX = i => i * (LAY.colW + LAY.gap);
const colR = i => colX(i) + LAY.colW;
const crisp = n => Math.round(n) + 0.5; // keep 1px strokes off half-pixels

// Renders straight when y1 === y2, jogged at the midpoint otherwise.
function connector(x1, y1, x2, y2){
  const xm = (x1 + x2) / 2;
  return `M ${crisp(x1)} ${crisp(y1)} H ${crisp(xm)} V ${crisp(y2)} H ${crisp(x2)}`;
}

/* When the next game is scheduled. MLB publishes postseason dates long before
   first pitch and fills `at` with a placeholder until the time is set, so
   while it's TBD read the plain calendar date instead — converting a
   placeholder through local time can land on the wrong day out west. */
function nextGameNote(s){
  const next = (state.series[s.id] || {}).next;
  if(s.winner || !next) return "";
  const timeKnown = next.tbd === false && next.at;

  let day;
  if(next.date){
    const [y, m, d] = next.date.split("-").map(Number);
    day = new Date(y, m - 1, d);
  } else if(next.at){
    const at = new Date(next.at);
    if(isNaN(at)) return "";
    day = new Date(at.getFullYear(), at.getMonth(), at.getDate());
  } else return "";

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const days = Math.round((day - today) / 86400000);

  const time = timeKnown
    ? ", " + new Date(next.at).toLocaleTimeString(undefined, { hour:"numeric", minute:"2-digit" })
    : "";
  if(days === 0) return `Next game today${time}`;
  if(days === 1) return `Next game tomorrow${time}`;

  // Drop the weekday once a time is shown, to keep the note on one line.
  const date = day.toLocaleDateString(undefined, timeKnown
    ? { month:"short", day:"numeric" }
    : { weekday:"short", month:"short", day:"numeric" });
  return days < 0 ? `Next game ${date}${time}` : `Next game ${date}${time} &bull; ${days} days`;
}

/* Which side hosts. Inside a league the higher seed hosts every round — the
   wild card round outright, later rounds by the extra home game — so the seed
   settles it. The World Series is the exception: the two teams come from
   different leagues, where seeds don't compare, and it goes to the better
   regular-season record instead. */
function homeSide(s){
  if(!s.teamA || !s.teamB) return null;
  const a = state.teams[s.teamA], b = state.teams[s.teamB];
  if(!a || !b) return null;

  if(s.round === "WS"){
    const pct = t => (t.w != null && t.l != null && t.w + t.l > 0) ? t.w / (t.w + t.l) : null;
    const pa = pct(a), pb = pct(b);
    if(pa == null || pb == null) return null; // records not recorded yet
    return pa >= pb ? "A" : "B";
  }
  return a.seed <= b.seed ? "A" : "B";
}

// Host on the bottom, the way a line score puts the team batting last there.
// Until a matchup is settled, fall back to the structural order — which for
// the wild card and division rounds already has the host at the bottom.
function rowOrder(s){
  const home = homeSide(s);
  if(home) return home === "A" ? ["B", "A"] : ["A", "B"];
  return (s.round === "WC" || s.round === "DS") ? ["B", "A"] : ["A", "B"];
}

function box(s, top, col, opts = {}){
  const [first, second] = rowOrder(s);
  const rows = `${matchupRow(s, first)}${matchupRow(s, second)}`;
  const note = opts.champLine
    ? `<div class="card-note champ">${opts.champLine}</div>`
    : (n => n ? `<div class="card-note">${n}</div>` : "")(nextGameNote(s));
  return `<div class="box" style="left:${colX(col)}px; top:${top}px; width:${LAY.colW}px;">
    <div class="series">
      <div class="bestof"><span>${ROUND_LABEL[s.round]}</span><span>BO${s.bestOf}</span></div>
      ${rows}
    </div>
    ${note}
  </div>`;
}

/* ---------- bracket: AL converges from the left, NL from the right ---------- */
function renderBracket(){
  const wrap = document.getElementById("bracketWrap");
  const setupPrompt = document.getElementById("setupPrompt");
  const hasField = Object.keys(state.teams).length >= 12;
  setupPrompt.hidden = hasField;
  if(!hasField){ wrap.innerHTML = ""; renderBanner(null); return; }

  const br = fullBracket(state);
  const alChampLine = br.al.champion ? `${teamLabel(br.al.champion)} advance` : "";
  const nlChampLine = br.nl.champion ? `${teamLabel(br.nl.champion)} advance` : "";
  const wsChampLine = br.ws.winner ? `${teamLabel(br.ws.winner)} win the World Series` : "";

  const W = colR(6);
  const labels = [
    ["AL Wild Card","al"], ["AL Division","al"], ["AL Championship","al"],
    ["World Series","champ"],
    ["NL Championship","nl"], ["NL Division","nl"], ["NL Wild Card","nl"]
  ].map(([text,cls],i) =>
    `<div class="lg-label ${cls}" style="left:${colX(i)}px; width:${LAY.colW}px;">${text}</div>`
  ).join("");

  // Lines leave a card at the divider between its two teams and land on the
  // slot the winner will fill.
  const wc1Out = LAY.yWc1 + LAY.rowDivY, wc2Out = LAY.yWc2 + LAY.rowDivY;
  const ds1Out = LAY.yDs1 + LAY.rowDivY, ds2Out = LAY.yDs2 + LAY.rowDivY;
  const midOut = LAY.yMid + LAY.rowDivY;
  // Both division cards take their wild-card winner in the top slot.
  const ds1Slot = LAY.yDs1 + LAY.rowTopY, ds2Slot = LAY.yDs2 + LAY.rowTopY;

  const paths = [
    connector(colR(0), wc1Out, colX(1), ds1Slot),
    connector(colR(0), wc2Out, colX(1), ds2Slot),
    connector(colR(1), ds1Out, colX(2), midOut),
    connector(colR(1), ds2Out, colX(2), midOut),
    connector(colR(2), midOut, colX(3), midOut),
    connector(colX(6), wc1Out, colR(5), ds1Slot),
    connector(colX(6), wc2Out, colR(5), ds2Slot),
    connector(colX(5), ds1Out, colR(4), midOut),
    connector(colX(5), ds2Out, colR(4), midOut),
    connector(colX(4), midOut, colR(3), midOut)
  ].map(d => `<path d="${d}"/>`).join("");

  // wc[1] is the 4/5 series and feeds the #1 seed, so it takes the top slot
  // beside DS1; wc[0] (3/6) sits below beside DS2. Keeps the lines from
  // crossing now that the bracket is fixed rather than reseeded.
  const boxes = [
    box(br.al.wc[1], LAY.yWc1, 0),
    box(br.al.wc[0], LAY.yWc2, 0),
    box(br.al.ds[0], LAY.yDs1, 1),
    box(br.al.ds[1], LAY.yDs2, 1),
    box(br.al.cs[0], LAY.yMid, 2, {champLine:alChampLine}),
    box(br.ws,       LAY.yMid, 3, {champLine:wsChampLine}),
    box(br.nl.cs[0], LAY.yMid, 4, {champLine:nlChampLine}),
    box(br.nl.ds[0], LAY.yDs1, 5),
    box(br.nl.ds[1], LAY.yDs2, 5),
    box(br.nl.wc[1], LAY.yWc1, 6),
    box(br.nl.wc[0], LAY.yWc2, 6)
  ].join("");

  wrap.innerHTML = `
    <div class="tree-scroll"><div class="bracket-inner" style="width:${W}px;">
      <div class="lg-labels-row">${labels}</div>
      <div class="bracket-stage" style="height:${LAY.stageH}px;">
        <svg class="bracket-lines" width="${W}" height="${LAY.stageH}" viewBox="0 0 ${W} ${LAY.stageH}">${paths}</svg>
        ${boxes}
      </div>
    </div></div>
  `;
  renderBanner(br);
}

function renderBanner(br){
  const banner = document.getElementById("banner");
  if(!br || !state.ranking.length){ banner.hidden = true; return; }
  banner.hidden = false;

  const champ = br.ws && br.ws.winner;
  if(champ){
    banner.innerHTML = `<span class="banner-label">Final</span>
      <span class="banner-team">${teamDot(champ)} ${teamLabel(champ)}</span>
      <span class="banner-status">win the World Series</span>`;
    return;
  }

  const aliveRanked = state.ranking.filter(id => !teamEliminated(state, id));
  if(aliveRanked.length === 0){
    banner.innerHTML = `<span class="banner-status">All of your ranked teams have been eliminated.</span>`;
    return;
  }
  // No status label — "remaining" already says they're alive.
  const top = aliveRanked[0];
  banner.innerHTML = `<span class="banner-label">Highest remaining pick</span>
    <span class="banner-team">${rankTag(top)}${teamDot(top)} ${teamLabel(top)}</span>`;
}

/* ---------- ranking: drag a card by its grip to reorder ---------- */
function renderRanking(){
  const list = document.getElementById("rankList");
  const head = document.getElementById("rankHead");
  if(!state.ranking.length){
    head.hidden = true;
    list.innerHTML = `<li class="rank-item"><span class="rank-info">Set this year's playoff field first, on the Bracket tab.</span></li>`;
    return;
  }
  head.hidden = false;
  /* Rank in a gutter outside the card, the way the wild card race numbers its
     rows; inside, the club name over its league chip and seed, then the two
     title columns, which line up under the headings above the list. */
  list.innerHTML = state.ranking.map((id, i) => {
    const t = state.teams[id];
    const st = teamStatusLabel(state, id);
    const won = lastTitle(id);
    return `<li class="rank-item ${st.cls === 'out' ? 'eliminated' : ''}" data-id="${id}">
      <span class="rank-num tabular">${i+1}</span>
      <span class="rank-card">
        <span class="grip">&#8942;&#8942;</span>
        ${teamDot(id)}
        <span class="rank-id">
          <span class="team-name">${teamLabel(id)}</span>
          <span class="meta-row">
            <span class="league-tag ${t.league}">${t.league}</span>
            <span class="rank-seed tabular">${t.seed} seed</span>
          </span>
        </span>
        <span class="rank-cols">
          <span class="col-won tabular">${won || "&mdash;"}</span>
          <span class="col-drought">${droughtLabel(id)}</span>
        </span>
      </span>
    </li>`;
  }).join("");
  wireDrag(list);
}

/* Reordering runs on Sortable (vendored, see sortable.min.js), which handles
   mouse, touch and pen across browsers. Bound once to the list element, which
   survives re-renders, so re-rendering the rows doesn't need to rebind. */
let sortable = null;

function wireDrag(list){
  if(sortable || typeof Sortable === "undefined") return;
  sortable = Sortable.create(list, {
    animation: 140,
    handle: ".grip",   // the six dots, not the whole card
    chosenClass: "dragging",
    ghostClass: "drag-ghost",
    onStart: () => { reordering = true; },
    onEnd: () => {
      reordering = false;
      const rows = [...list.querySelectorAll(".rank-item")];
      const order = rows.map(el => el.dataset.id);
      if(order.join() === state.ranking.join()) return;

      // Sortable already placed the row; just renumber in place rather than
      // re-rendering the list out from under it.
      state.ranking = order;
      rows.forEach((row, i) => {
        const n = row.querySelector(".rank-num");
        if(n) n.textContent = i + 1;
      });
      renderBracket();
      saveRanking(order);
    }
  });
}

function renderReference(){
  const body = document.getElementById("refBody");
  const inField = new Set(Object.keys(state.teams || {}));
  const rows = Object.entries(TEAMS).sort((a,b) => a[1].name.localeCompare(b[1].name));
  body.innerHTML = rows.map(([id,t]) => {
    const won = lastTitle(id);
    return `<tr class="${inField.has(id) ? 'in-playoffs' : ''}">
      <td class="rank-col">${rankTag(id)}</td>
      <td class="seed-col">${(state.teams[id] && state.teams[id].seed) || ""}</td>
      <td><span class="cell">${teamDot(id)} ${t.name}</span></td>
      <td class="lg-col"><span class="league-tag ${t.league}">${t.league}</span></td>
      <td class="tabular">${won || "&mdash;"}</td>
      <td class="tabular">${droughtLabel(id)}</td>
    </tr>`;
  }).join("");
}

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
    case "field":
      if(e.in && e.out) return `${logChip(e.in)} in, ${logChip(e.out)} out`;
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
  const when = whenLabel(new Date(t).toISOString());
  return `<span class="stamp-line">${label} <b>${when}</b>${why ? ` &mdash; ${why}` : ""}</span>`;
}
function renderStamp(){
  const el = document.getElementById("stamp");
  const lastAt = [state && state.updatedAt, standings && standings.updatedAt]
    .map(t => t ? Date.parse(t) : NaN).filter(n => !isNaN(n));
  const last = lastAt.length ? new Date(Math.max(...lastAt)).toISOString() : null;
  const lines = [
    stampLine("Last updated", last, state && state.updatedFor),
    stampLine("Next update", state && state.nextAt, state && state.nextFor)
  ].filter(Boolean).join("");
  el.hidden = !lines;
  el.innerHTML = lines;
}

function renderAll(){
  renderStamp();
  renderUpdates();
  renderBracket();
  renderStandings();
  renderRanking();
  renderReference();
}

/* ---------- manual field setup (fallback when the routine hasn't set it) ---------- */
let picked = new Set();
let seeds = {AL:{}, NL:{}};

function openSetup(){
  picked = new Set(Object.keys(state.teams));
  seeds = {AL:{}, NL:{}};
  Object.entries(state.teams).forEach(([id,t]) => seeds[t.league][t.seed] = id);
  renderPickGrid();
  document.getElementById("setupModalBg").style.display = "flex";
}
function closeSetup(){ document.getElementById("setupModalBg").style.display = "none"; }

function renderPickGrid(){
  const grid = document.getElementById("pickGrid");
  grid.innerHTML = Object.entries(TEAMS).sort((a,b) => a[1].name.localeCompare(b[1].name)).map(([id,t]) => `
    <label class="pick-team ${picked.has(id) ? 'selected' : ''}" data-id="${id}">
      <input type="checkbox" ${picked.has(id) ? 'checked' : ''}>
      ${teamDot(id)} ${t.name} <span style="color:var(--ink-dim); font-size:.72rem;">(${t.league})</span>
    </label>`).join("");
  grid.querySelectorAll(".pick-team").forEach(el => {
    el.addEventListener("click", (e) => {
      e.preventDefault();
      const id = el.dataset.id;
      if(picked.has(id)) picked.delete(id); else picked.add(id);
      renderPickGrid();
    });
  });
  renderSeedArea();
}

function renderSeedArea(){
  const area = document.getElementById("seedArea");
  ["AL","NL"].forEach(lg => {
    const ids = [...picked].filter(id => TEAMS[id].league === lg);
    Object.keys(seeds[lg]).forEach(s => { if(!ids.includes(seeds[lg][s])) delete seeds[lg][s]; });
  });
  area.innerHTML = ["AL","NL"].map(lg => {
    const ids = [...picked].filter(id => TEAMS[id].league === lg);
    return `<div>
      <h3 style="color:var(--${lg.toLowerCase()});">${lg} seeds (${ids.length}/6)</h3>
      ${[1,2,3,4,5,6].map(seed => `
        <div class="seed-row">
          <span>Seed ${seed}</span>
          <select data-lg="${lg}" data-seed="${seed}">
            <option value="">&mdash;</option>
            ${ids.map(id => `<option value="${id}" ${seeds[lg][seed]===id ? 'selected' : ''}>${TEAMS[id].name}</option>`).join("")}
          </select>
        </div>`).join("")}
    </div>`;
  }).join("");
  area.querySelectorAll("select").forEach(sel => {
    sel.addEventListener("change", () => {
      seeds[sel.dataset.lg][sel.dataset.seed] = sel.value || null;
    });
  });
}

async function saveSetup(){
  const teamsMap = {};
  ["AL","NL"].forEach(lg => {
    [1,2,3,4,5,6].forEach(seed => {
      const id = seeds[lg][seed];
      if(id) teamsMap[id] = {league:lg, seed:Number(seed)};
    });
  });
  const alCount = Object.values(teamsMap).filter(t => t.league === "AL").length;
  const nlCount = Object.values(teamsMap).filter(t => t.league === "NL").length;
  if(alCount !== 6 || nlCount !== 6){
    alert("Assign all 6 seeds in both AL and NL before saving.");
    return;
  }
  await saveTeams(teamsMap);
  closeSetup();
  renderAll();
}

/* ---------- tabs / season switching ---------- */
function switchTab(tab){
  document.querySelectorAll("nav.tabs button").forEach(b => b.classList.toggle("active", b.dataset.tab === tab));
  document.querySelectorAll("section.view").forEach(v => v.classList.toggle("active", v.id === "view-" + tab));
}

async function switchYear(year){
  activeYear = year;
  await loadSeason(year);
  await loadStandings(year);
  renderAll();
  watchSeason(year);
  watchStandings(year);
}

async function boot(){
  document.querySelectorAll("nav.tabs button").forEach(b => b.addEventListener("click", () => switchTab(b.dataset.tab)));
  document.getElementById("openSetupBtn").addEventListener("click", openSetup);
  document.getElementById("cancelSetupBtn").addEventListener("click", closeSetup);
  document.getElementById("saveSetupBtn").addEventListener("click", saveSetup);

  const yearSel = document.getElementById("yearSel");
  const fallbackYears = [seasonYear(), seasonYear()-1, seasonYear()-2];

  try{
    db = await window.claude?.use?.("db");
  }catch(e){ db = null; }

  try{
    if(db){
      await loadSeasonList();
      if(!years.length) years = fallbackYears.map(String);
    } else {
      years = fallbackYears.map(String);
    }
  }catch(e){ db = null; years = fallbackYears.map(String); }

  yearSel.innerHTML = years.map(y => `<option value="${y}" ${Number(y) === activeYear ? 'selected' : ''}>${y}</option>`).join("");
  yearSel.addEventListener("change", () => switchYear(Number(yearSel.value)));

  try{
    if(db){ await loadSeason(activeYear); await loadStandings(activeYear); }
    else { state = emptySeason(activeYear); }
  }catch(e){ db = null; state = emptySeason(activeYear); }

  renderAll();
  watchSeason(activeYear);
  watchStandings(activeYear);
}

if(window.claude?.hot){
  window.claude.hot.ready ? window.claude.hot.ready(boot) : boot();
} else {
  boot();
}
