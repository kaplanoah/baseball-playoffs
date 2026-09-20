/* UI: loads the season doc from the artifact store, renders the bracket,
   ranking and reference views, and saves the user's ranking order.
   Series results are written by the scheduled routine, not from here. */

const CURRENT_YEAR = new Date().getFullYear();
const seasonYear = () => (new Date().getMonth() >= 8 ? CURRENT_YEAR : CURRENT_YEAR - 1);

let db = null;
let state = null;
let years = [];
let activeYear = seasonYear();

function emptySeason(year){
  return { year, teams:{}, series:{}, ranking:[] };
}

/* ---------- persistence ---------- */
async function loadSeasonList(){
  const snap = await db.collection("seasons").limit(50).get();
  years = snap.docs.map(d => d.id).sort().reverse();
  if(!years.includes(String(activeYear))) years = [String(activeYear), ...years];
  years = [...new Set(years)];
}
async function loadSeason(year){
  const snap = await db.doc(`seasons/${year}`).get();
  state = snap.exists ? snap.data() : emptySeason(year);
  if(!state.teams) state.teams = {};
  if(!state.series) state.series = {};
  if(!state.ranking) state.ranking = [];
}
async function saveTeams(teamsMap){
  state.teams = teamsMap;
  state.ranking = Object.keys(teamsMap).sort((a,b) => teamsMap[a].seed - teamsMap[b].seed);
  state.series = {};
  if(db) await db.doc(`seasons/${activeYear}`).set(state);
}
async function saveRanking(order){
  state.ranking = order;
  if(db) await db.doc(`seasons/${activeYear}`).set(state);
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

/* Bracket geometry. Rounds sit progressively closer to the centerline so the
   two leagues funnel inward to the World Series, and every connector ends on
   the exact row that team will occupy. Card metrics mirror styles.css. */
const LAY = {
  colW:200, gap:22,
  cardH:106, rowTopY:48, rowBotY:86,
  stageH:640,
  yWcTop:100, yDsTop:210, yMid:330, yDsBot:450, yWcBot:560
};
const colX = i => i * (LAY.colW + LAY.gap);
const boxTop = centerY => centerY - LAY.cardH/2;
const crisp = n => Math.round(n) + 0.5; // keep 1px strokes off half-pixels

function elbow(x1, y1, x2, y2){
  const xm = (x1 + x2) / 2;
  return `M ${crisp(x1)} ${crisp(y1)} H ${crisp(xm)} V ${crisp(y2)} H ${crisp(x2)}`;
}

// One bracket box. `flip` renders side B above side A, so a division series
// shows its incoming wild-card slot on the side the line arrives from.
function box(s, centerY, col, opts = {}){
  const rows = opts.flip
    ? `${matchupRow(s,"B")}${matchupRow(s,"A")}`
    : `${matchupRow(s,"A")}${matchupRow(s,"B")}`;
  return `<div class="box" style="left:${colX(col)}px; top:${boxTop(centerY)}px; width:${LAY.colW}px;">
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
  const wsChampLine = br.ws.winner ? `${teamLabel(br.ws.winner)} win it all` : "";

  const W = colX(6) + LAY.colW;
  const labels = [
    ["AL Wild Card","al"], ["AL Division","al"], ["AL Championship","al"],
    ["World Series","champ"],
    ["NL Championship","nl"], ["NL Division","nl"], ["NL Wild Card","nl"]
  ].map(([text,cls],i) =>
    `<div class="lg-label ${cls}" style="left:${colX(i)}px; width:${LAY.colW}px;">${text}</div>`
  ).join("");

  // Entry points: each line lands on the slot its winner will fill.
  const dsTopSlot = boxTop(LAY.yDsTop) + LAY.rowTopY;
  const dsBotSlot = boxTop(LAY.yDsBot) + LAY.rowBotY;
  const midTopSlot = boxTop(LAY.yMid) + LAY.rowTopY;
  const midBotSlot = boxTop(LAY.yMid) + LAY.rowBotY;
  const R = i => colX(i) + LAY.colW;

  const paths = [
    elbow(R(0), LAY.yWcTop, colX(1), dsTopSlot),
    elbow(R(0), LAY.yWcBot, colX(1), dsBotSlot),
    elbow(R(1), LAY.yDsTop, colX(2), midTopSlot),
    elbow(R(1), LAY.yDsBot, colX(2), midBotSlot),
    elbow(R(2), LAY.yMid,   colX(3), midTopSlot),
    elbow(colX(6), LAY.yWcTop, R(5), dsTopSlot),
    elbow(colX(6), LAY.yWcBot, R(5), dsBotSlot),
    elbow(colX(5), LAY.yDsTop, R(4), midTopSlot),
    elbow(colX(5), LAY.yDsBot, R(4), midBotSlot),
    elbow(colX(4), LAY.yMid,   R(3), midBotSlot)
  ].map(d => `<path d="${d}"/>`).join("");

  const boxes = [
    box(br.al.wc[0], LAY.yWcTop, 0),
    box(br.al.wc[1], LAY.yWcBot, 0),
    box(br.al.ds[0], LAY.yDsTop, 1, {flip:true}),
    box(br.al.ds[1], LAY.yDsBot, 1),
    box(br.al.cs[0], LAY.yMid,   2, {champLine:alChampLine}),
    box(br.ws,       LAY.yMid,   3, {champLine:wsChampLine}),
    box(br.nl.cs[0], LAY.yMid,   4, {champLine:nlChampLine}),
    box(br.nl.ds[0], LAY.yDsTop, 5, {flip:true}),
    box(br.nl.ds[1], LAY.yDsBot, 5),
    box(br.nl.wc[0], LAY.yWcTop, 6),
    box(br.nl.wc[1], LAY.yWcBot, 6)
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
  const aliveRanked = state.ranking.filter(id => !teamEliminated(state, id));
  banner.hidden = false;

  if(aliveRanked.length === 0){
    const champ = br.ws && br.ws.winner;
    banner.innerHTML = champ
      ? `<span class="banner-label">Final</span><span class="banner-team">${teamDot(champ)} ${teamLabel(champ)}</span><span class="banner-status">win it all</span>`
      : `<span class="banner-status">All of your ranked teams have been eliminated.</span>`;
    return;
  }
  const top = aliveRanked[0];
  banner.innerHTML = `<span class="banner-label">Highest remaining pick</span>
    <span class="banner-team">${rankTag(top)}${teamDot(top)} ${teamLabel(top)}</span>
    <span class="banner-status">${teamStatusLabel(state, top).label}</span>`;
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
    return `<li class="rank-item ${st.cls === 'out' ? 'eliminated' : ''}" data-id="${id}">
      <span class="grip">&#8942;&#8942;</span>
      <span class="rank-num tabular">${i+1}</span>
      <span class="rank-info">
        <span class="name-row">${teamDot(id)}<span class="team-name">${info.name}</span></span>
        <span class="meta">${t.league} &middot; Seed ${t.seed} &middot; Last WS ${info.lastWS || "never"}</span>
      </span>
      <span class="status-pill ${st.cls}">${st.label}</span>
    </li>`;
  }).join("");
  wireDrag(list);
}

// Rows are measured once at drag start, so the target index is computed against
// stable positions; siblings only shift visually until the drop commits.
function wireDrag(list){
  list.querySelectorAll(".rank-item").forEach(dragEl => {
    dragEl.addEventListener("pointerdown", (e) => {
      if(!dragEl.dataset.id) return;
      e.preventDefault();

      const items = [...list.querySelectorAll(".rank-item")];
      const startIndex = items.indexOf(dragEl);
      const startRects = items.map(el => el.getBoundingClientRect());
      const dragRect = startRects[startIndex];
      const itemStep = dragRect.height + 8; // row height + list gap
      const startY = e.clientY;
      let targetIndex = startIndex;

      dragEl.setPointerCapture(e.pointerId);
      document.body.style.userSelect = "none";
      dragEl.classList.add("dragging");
      dragEl.style.position = "relative";
      dragEl.style.zIndex = "10";

      function onMove(ev){
        ev.preventDefault();
        const dy = ev.clientY - startY;
        dragEl.style.transform = `translateY(${dy}px)`;
        const centerY = dragRect.top + dragRect.height/2 + dy;

        let next = startIndex;
        startRects.forEach((r, i) => {
          if(i === startIndex) return;
          const c = r.top + r.height/2;
          if(i < startIndex && centerY < c) next = Math.min(next, i);
          if(i > startIndex && centerY > c) next = Math.max(next, i);
        });
        targetIndex = next;

        items.forEach((el, i) => {
          if(el === dragEl) return;
          let shift = 0;
          if(targetIndex < startIndex && i >= targetIndex && i < startIndex) shift = itemStep;
          if(targetIndex > startIndex && i <= targetIndex && i > startIndex) shift = -itemStep;
          el.style.transition = "transform 120ms ease";
          el.style.transform = shift ? `translateY(${shift}px)` : "";
        });
      }

      async function onUp(ev){
        dragEl.releasePointerCapture(ev.pointerId);
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        document.body.style.userSelect = "";

        const order = items.map(el => el.dataset.id);
        const [moved] = order.splice(startIndex, 1);
        order.splice(targetIndex, 0, moved);

        items.forEach(el => {
          el.style.transform = "";
          el.style.transition = "";
          el.style.position = "";
          el.style.zIndex = "";
        });
        dragEl.classList.remove("dragging");

        await saveRanking(order);
        renderRanking();
        renderBracket();
      }
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
    });
  });
}

function renderReference(){
  const body = document.getElementById("refBody");
  const inField = new Set(Object.keys(state.teams || {}));
  const rows = Object.entries(TEAMS).sort((a,b) => a[1].name.localeCompare(b[1].name));
  body.innerHTML = rows.map(([id,t]) => {
    const drought = t.lastWS ? (seasonYear() - t.lastWS) + " yrs" : "since 1969";
    return `<tr class="${inField.has(id) ? 'in-playoffs' : ''}">
      <td><span class="cell">${rankTag(id)}${teamDot(id)} ${t.name}</span></td>
      <td><span class="league-tag ${t.league}">${t.league}</span></td>
      <td class="tabular">${t.lastWS || "&mdash;"}</td>
      <td class="tabular">${drought}</td>
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
}

if(window.claude?.hot){
  window.claude.hot.ready ? window.claude.hot.ready(boot) : boot();
} else {
  boot();
}
