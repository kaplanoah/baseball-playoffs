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
let reordering = false; // true mid-drag, so a live update can't yank the list

function emptySeason(year){
  return { year, teams:{}, series:{}, ranking:[] };
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
  return (seasonYear() - won) + " yrs";
}
function normalize(doc, year){
  const s = doc || emptySeason(year);
  if(!s.teams) s.teams = {};
  if(!s.series) s.series = {};
  if(!s.ranking) s.ranking = [];
  return s;
}

async function loadSeason(year){
  const snap = await db.doc(`seasons/${year}`).get();
  state = normalize(snap.exists ? snap.data() : null, year);
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
    await ref.set({ year: activeYear, teams:{}, series:{}, ranking:[], ...fields });
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

/* ---------- shared render helpers ---------- */
function teamDot(id){
  const t = TEAMS[id];
  if(!t) return `<span class="dot" style="background:#999"></span>`;
  return `<span class="dot" style="background:linear-gradient(135deg, ${t.color} 50%, ${t.color2} 50%)"></span>`;
}
function teamLabel(id){ return TEAMS[id] ? TEAMS[id].name : "?"; }
// `solid` fills the tag, marking the team you rank higher in a given matchup.
function rankTag(id, solid){
  const idx = state.ranking.indexOf(id);
  return idx === -1 ? "" : `<span class="rank-tag ${solid ? "solid" : ""}">#${idx+1}</span>`;
}

// Which side of this matchup you rank higher — null until both teams are known.
function preferredSide(s){
  if(!s.teamA || !s.teamB) return null;
  const a = state.ranking.indexOf(s.teamA);
  const b = state.ranking.indexOf(s.teamB);
  if(a === -1 && b === -1) return null;
  if(a === -1) return "B";
  if(b === -1) return "A";
  return a < b ? "A" : "B";
}

function matchupRow(s, side){
  const id = side === "A" ? s.teamA : s.teamB;
  const wins = side === "A" ? s.winsA : s.winsB;
  if(!id) return `<div class="matchup-row"><span class="tbd">TBD</span></div>`;
  const isWinner = s.winner === id;
  const isLoser = s.winner && s.winner !== id;
  const isPreferred = preferredSide(s) === side;
  return `<div class="matchup-row ${isWinner?'winner':''} ${isLoser?'eliminated':''}">
    <div class="team-id">${rankTag(id, isPreferred)}${teamDot(id)}<span class="team-name">${TEAMS[id].name}</span></div>
    <span class="nscore tabular ${isWinner?'lead':''}">${wins}</span>
  </div>`;
}

/* Bracket geometry, in card-top coordinates. Card metrics mirror styles.css:
   a card is 90px tall, its top row centered 41px down, the divider between its
   two teams at 57px, its bottom row at 73px.

   Cards are offset so a line leaving a card's divider runs dead straight into
   the slot it feeds: each wild card sits 16px outboard of its division series
   (57 - 41), so divider and destination row share a y. Division to
   championship needs a jog, since those cards feed rows 32px apart. */
const LAY = {
  colW:200, gap:22,
  cardH:90, rowTopY:41, rowDivY:57, rowBotY:73,
  stageH:412,
  yWc1:24, yDs1:40, yMid:160, yDs2:280, yWc2:296
};
const colX = i => i * (LAY.colW + LAY.gap);
const colR = i => colX(i) + LAY.colW;
const crisp = n => Math.round(n) + 0.5; // keep 1px strokes off half-pixels

// Renders straight when y1 === y2, jogged at the midpoint otherwise.
function connector(x1, y1, x2, y2){
  const xm = (x1 + x2) / 2;
  return `M ${crisp(x1)} ${crisp(y1)} H ${crisp(xm)} V ${crisp(y2)} H ${crisp(x2)}`;
}

// One bracket box. `flip` renders side B above side A, so a division series
// shows its incoming wild-card slot on the side the line arrives from.
function box(s, top, col, opts = {}){
  const rows = opts.flip
    ? `${matchupRow(s,"B")}${matchupRow(s,"A")}`
    : `${matchupRow(s,"A")}${matchupRow(s,"B")}`;
  return `<div class="box" style="left:${colX(col)}px; top:${top}px; width:${LAY.colW}px;">
    <div class="series">
      <div class="bestof"><span>${ROUND_LABEL[s.round]}</span><span>BO${s.bestOf}</span></div>
      ${rows}
    </div>
    ${opts.champLine ? `<div class="champ-line">${opts.champLine}</div>` : ""}
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
  const ds1Slot = LAY.yDs1 + LAY.rowTopY, ds2Slot = LAY.yDs2 + LAY.rowBotY;
  const midTopSlot = LAY.yMid + LAY.rowTopY, midBotSlot = LAY.yMid + LAY.rowBotY;

  const paths = [
    connector(colR(0), wc1Out, colX(1), ds1Slot),
    connector(colR(0), wc2Out, colX(1), ds2Slot),
    connector(colR(1), ds1Out, colX(2), midTopSlot),
    connector(colR(1), ds2Out, colX(2), midBotSlot),
    connector(colR(2), midOut, colX(3), midOut),
    connector(colX(6), wc1Out, colR(5), ds1Slot),
    connector(colX(6), wc2Out, colR(5), ds2Slot),
    connector(colX(5), ds1Out, colR(4), midTopSlot),
    connector(colX(5), ds2Out, colR(4), midBotSlot),
    connector(colX(4), midOut, colR(3), midOut)
  ].map(d => `<path d="${d}"/>`).join("");

  const boxes = [
    box(br.al.wc[0], LAY.yWc1, 0),
    box(br.al.wc[1], LAY.yWc2, 0),
    box(br.al.ds[0], LAY.yDs1, 1, {flip:true}),
    box(br.al.ds[1], LAY.yDs2, 1),
    box(br.al.cs[0], LAY.yMid, 2, {champLine:alChampLine}),
    box(br.ws,       LAY.yMid, 3, {champLine:wsChampLine}),
    box(br.nl.cs[0], LAY.yMid, 4, {champLine:nlChampLine}),
    box(br.nl.ds[0], LAY.yDs1, 5, {flip:true}),
    box(br.nl.ds[1], LAY.yDs2, 5),
    box(br.nl.wc[0], LAY.yWc1, 6),
    box(br.nl.wc[1], LAY.yWc2, 6)
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

/* ---------- ranking: drag anywhere on a card to reorder ---------- */
function renderRanking(){
  const list = document.getElementById("rankList");
  if(!state.ranking.length){
    list.innerHTML = `<li class="rank-item"><span class="rank-info">Set this year's playoff field first, on the Bracket tab.</span></li>`;
    return;
  }
  list.innerHTML = state.ranking.map((id, i) => {
    const t = state.teams[id];
    const info = TEAMS[id];
    const st = teamStatusLabel(state, id);
    const won = lastTitle(id);
    const title = won ? `Last WS ${won} &middot; ${droughtLabel(id)}` : "Last WS never";
    return `<li class="rank-item ${st.cls === 'out' ? 'eliminated' : ''}" data-id="${id}">
      <span class="grip">&#8942;&#8942;</span>
      <span class="rank-num tabular">${i+1}</span>
      <span class="rank-info">
        <span class="name-row">${teamDot(id)}<span class="team-name">${info.name}</span></span>
        <span class="meta"><span class="lg ${t.league}">${t.league}</span> &middot; ${title}</span>
      </span>
      <span class="status-pill ${st.cls}">${st.label}</span>
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
      <td><span class="cell">${teamDot(id)} ${t.name}</span></td>
      <td><span class="league-tag ${t.league}">${t.league}</span></td>
      <td class="tabular">${won || "&mdash;"}</td>
      <td class="tabular">${droughtLabel(id)}</td>
    </tr>`;
  }).join("");
}

function renderAll(){
  renderBracket();
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
  renderAll();
  watchSeason(year);
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
    if(db){ await loadSeason(activeYear); }
    else { state = emptySeason(activeYear); }
  }catch(e){ db = null; state = emptySeason(activeYear); }

  renderAll();
  watchSeason(activeYear);
}

if(window.claude?.hot){
  window.claude.hot.ready ? window.claude.hot.ready(boot) : boot();
} else {
  boot();
}
