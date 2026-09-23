/* UI core: the season document, the artifact store it lives in, the small
   render helpers every view shares, and the boot sequence. The views
   themselves are in bracket-view.js, ranking.js, updates.js, standings.js
   and setup.js; this file loads last, because it is the one that starts
   everything once they have all defined their renderers.
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

/* The defending champion isn't in a drought -- they're the ones holding it.
   They go back to counting the moment this season crowns someone else. */
function droughtLabel(id){
  const won = lastTitle(id);
  if(!won) return "Since 1969";
  const yr = seasonYear();
  if(won >= yr) return "Reigning";
  const crowned = state && state.teams ? fullBracket(state).ws?.winner : null;
  if(won === yr - 1 && !crowned) return "Defending";
  const n = yr - won;
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
/* ONE TEAM. The dot and the club name as a single piece, so every view spaces
   and aligns them the same way -- see .club in styles.css. `tag` is the name's
   element: "b" where the name is bold inside running text. */
function teamTag(id, tag = "span"){
  return `<span class="club">${teamDot(id)}<${tag} class="team-name">${teamLabel(id)}</${tag}></span>`;
}
/* EVERY CLUB IN THE FIELD HAS TO APPEAR IN THE RANKING. One that is missing is
   invisible on the Ranking tab -- you cannot drag what is not drawn -- and can
   never be the highest still in. The routine appends new clubs at the bottom
   when the field changes, but the page writes `ranking` straight from the
   browser with no version pin, so a drag that lands across a field change
   saves back a list that predates the swap: the club that left is still in it,
   the club that arrived never made it. This puts the order right at render
   time whatever the document holds, unranked clubs last, exactly where the
   routine would have put them. The next drag saves the correction back, so it
   heals rather than papering over. */
function rankedOrder(){
  if(!state || !state.teams) return [];
  const ranked = (state.ranking || []).filter(id => state.teams[id]);
  const missing = Object.keys(state.teams).filter(id => !ranked.includes(id));
  return ranked.concat(missing);
}

// A bare digit, the way a lineup card carries a uniform number.
function seedMark(seed){ return seed ? `<span class="seed-pre tabular">${seed}</span>` : ""; }
/* `solid` fills the tag, marking the team you rank higher in a given matchup.
   The slot is a fixed width so a two-digit rank doesn't push the dot and name
   further right than a one-digit one; the tag itself still hugs its text. */
function rankTag(id, solid){
  const idx = rankedOrder().indexOf(id);
  if(idx === -1) return "";
  return `<span class="rank-slot"><span class="rank-tag ${solid ? "solid" : ""}">#${idx+1}</span></span>`;
}

function renderAll(){
  renderStamp();
  renderUpdates();
  renderBracket();
  renderStandings();
  renderRanking();
  renderReference();
}

/* ---------- tabs / season switching ---------- */

/* The browser treats ANY keydown as a switch to keyboard navigation, so
   holding shift lights a focus ring around whatever you last clicked. Only
   the keys that actually move focus should raise it. */
const NAV_KEYS = new Set(["Tab","ArrowUp","ArrowDown","ArrowLeft","ArrowRight","Home","End"]);
addEventListener("keydown", e => {
  if(NAV_KEYS.has(e.key)) document.body.classList.add("kbd");
}, true);
addEventListener("pointerdown", () => document.body.classList.remove("kbd"), true);

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
