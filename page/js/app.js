const CURRENT_YEAR = new Date().getFullYear();
const seasonYear = () => (new Date().getMonth() >= 8 ? CURRENT_YEAR : CURRENT_YEAR - 1);

let db = null;
let seasonDoc = null;
let storedStandings = null;
let state = null;
let years = [];
let activeYear = seasonYear();
let trackedTitles = {};
let unwatchSeason = null;
let unwatchStandings = null;
let standings = null;
let reordering = false;

function emptySeason(year) {
  return { year, teams: {}, series: {}, ranking: [], log: [] };
}

async function loadSeasonList() {
  const snap = await db.collection("seasons").limit(50).get();
  years = snap.docs
    .map((d) => d.id)
    .sort()
    .reverse();
  if (!years.includes(String(activeYear))) years = [String(activeYear), ...years];
  years = [...new Set(years)];

  trackedTitles = {};
  snap.docs.forEach((d) => {
    const doc = d.data();
    if (!doc || !doc.teams || !doc.series) return;
    const year = Number(doc.year ?? d.id);
    const champ = fullBracket(doc).ws?.winner;
    if (champ && Number.isFinite(year) && !(trackedTitles[champ] >= year)) {
      trackedTitles[champ] = year;
    }
  });
}

function lastTitle(id) {
  const seeded = TEAMS[id].lastWS;
  const tracked = trackedTitles[id];
  if (seeded && tracked) return Math.max(seeded, tracked);
  return tracked || seeded;
}

function droughtLabel(id) {
  const won = lastTitle(id);
  if (!won) return "Since 1969";
  const yr = seasonYear();
  if (won >= yr) return "Reigning";
  const crowned = state && state.teams ? fullBracket(state).ws?.winner : null;
  if (won === yr - 1 && !crowned) return "Defending";
  const n = yr - won;
  return n + (n === 1 ? " yr" : " yrs");
}
// The store hands documents back read-only, and this page edits its copies in place.
const readDoc = (snap) => (snap && snap.exists ? JSON.parse(JSON.stringify(snap.data())) : null);

function normalize(doc, year) {
  const s = doc || emptySeason(year);
  if (!s.teams) s.teams = {};
  if (!s.series) s.series = {};
  if (!s.ranking) s.ranking = [];
  if (!Array.isArray(s.log)) s.log = [];
  return s;
}

async function loadSeason(year) {
  const snap = await db.doc(`seasons/${year}`).get();
  seasonDoc = normalize(readDoc(snap), year);
  composeState();
}

async function loadStandings(year) {
  storedStandings = null;
  if (db) {
    try {
      const snap = await db.doc(`standings/${year}`).get();
      storedStandings = readDoc(snap);
    } catch {
      storedStandings = null;
    }
  }
  composeState();
}
function watchStandings(year) {
  if (unwatchStandings) {
    unwatchStandings();
    unwatchStandings = null;
  }
  if (!db) return;
  unwatchStandings = db.doc(`standings/${year}`).onSnapshot(
    (snap) => {
      if (!snap.exists) return;
      const incoming = readDoc(snap);
      if (sameJson(incoming, storedStandings)) return;
      storedStandings = incoming;
      composeState();
      renderStandings();
      renderStamp();
    },
    () => {},
  );
}

function watchSeason(year) {
  if (unwatchSeason) {
    unwatchSeason();
    unwatchSeason = null;
  }
  if (!db) return;
  unwatchSeason = db.doc(`seasons/${year}`).onSnapshot(
    (snap) => {
      if (!snap.exists || reordering) return;
      const incoming = normalize(readDoc(snap), year);
      if (sameJson(incoming, seasonDoc)) return;
      seasonDoc = incoming;
      composeState();
      renderAll();
    },
    () => {},
  );
}
// Writing the whole document would overwrite fields another open view has changed since.
async function writeSeason(fields) {
  if (!db) return;
  const ref = db.doc(`seasons/${activeYear}`);
  try {
    await ref.update(fields);
  } catch {
    // update() rejects when the document doesn't exist yet.
    await ref.set({ year: activeYear, teams: {}, series: {}, ranking: [], log: [], ...fields });
  }
}

async function saveTeams(teamsMap) {
  const ranking = Object.keys(teamsMap).sort((a, b) => teamsMap[a].seed - teamsMap[b].seed);
  Object.assign(seasonDoc, { teams: teamsMap, series: {}, ranking });
  composeState();
  await writeSeason({ teams: teamsMap, series: {}, ranking });
}
async function saveRanking(order) {
  seasonDoc.ranking = order;
  state.ranking = order;
  await writeSeason({ ranking: order });
}

async function dismissUpdates() {
  const at = new Date().toISOString();
  seasonDoc.seenAt = at;
  state.seenAt = at;
  renderUpdates();
  await writeSeason({ seenAt: at });
}

const perceivedLightness = (hex) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  return 0.299 * r + 0.587 * g + 0.114 * b;
};

// Split vertically so the inner shadow shades both halves alike; a much lighter half reads larger,
// so it gets slightly less room.
function teamDot(id) {
  const t = TEAMS[id];
  if (!t) return `<span class="dot" style="background:#999"></span>`;
  const contrastGap = perceivedLightness(t.color2) - perceivedLightness(t.color);
  const split = contrastGap > 90 ? 52 : contrastGap < -90 ? 48 : 50;
  return `<span class="dot" style="background:linear-gradient(90deg, ${t.color} ${split}%, ${t.color2} ${split}%)"></span>`;
}
function teamLabel(id) {
  return TEAMS[id] ? TEAMS[id].name : "?";
}
function teamTag(id, tag = "span") {
  return `<span class="club">${teamDot(id)}<${tag} class="team-name">${teamLabel(id)}</${tag}></span>`;
}
// `ranking` changes only on a drag, so it can name clubs that left the field and miss ones that arrived.
function rankedOrder() {
  if (!state || !state.teams) return [];
  const ranked = (state.ranking || []).filter((id) => state.teams[id]);
  const missing = Object.keys(state.teams).filter((id) => !ranked.includes(id));
  return ranked.concat(missing);
}

function seedMark(seed) {
  return seed ? `<span class="seed-pre tabular">${seed}</span>` : "";
}
function rankTag(id, solid) {
  const idx = rankedOrder().indexOf(id);
  if (idx === -1) return "";
  return `<span class="rank-slot"><span class="rank-tag ${solid ? "solid" : ""}">#${idx + 1}</span></span>`;
}

function renderAll() {
  renderStamp();
  renderUpdates();
  renderBracket();
  renderStandings();
  renderRanking();
  renderReference();
}

// Browsers treat any keydown as keyboard navigation, so Shift alone would ring the last-clicked element.
const NAV_KEYS = new Set(["Tab", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Home", "End"]);
addEventListener(
  "keydown",
  (e) => {
    if (NAV_KEYS.has(e.key)) document.body.classList.add("kbd");
  },
  true,
);
addEventListener("pointerdown", () => document.body.classList.remove("kbd"), true);

function switchTab(tab) {
  document
    .querySelectorAll("nav.tabs button")
    .forEach((b) => b.classList.toggle("active", b.dataset.tab === tab));
  document
    .querySelectorAll("section.view")
    .forEach((v) => v.classList.toggle("active", v.id === "view-" + tab));
}

async function switchYear(year) {
  activeYear = year;
  await loadSeason(year);
  await loadStandings(year);
  renderAll();
  watchSeason(year);
  watchStandings(year);
  startLive();
}

async function boot() {
  document
    .querySelectorAll("nav.tabs button")
    .forEach((b) => b.addEventListener("click", () => switchTab(b.dataset.tab)));
  document.getElementById("openSetupBtn").addEventListener("click", openSetup);
  document.getElementById("cancelSetupBtn").addEventListener("click", closeSetup);
  document.getElementById("saveSetupBtn").addEventListener("click", saveSetup);

  const yearSel = document.getElementById("yearSel");
  const fallbackYears = [seasonYear(), seasonYear() - 1, seasonYear() - 2];

  try {
    db = await window.claude?.use?.("db");
  } catch {
    db = null;
  }

  try {
    if (db) {
      await loadSeasonList();
      if (!years.length) years = fallbackYears.map(String);
    } else {
      years = fallbackYears.map(String);
    }
  } catch {
    db = null;
    years = fallbackYears.map(String);
  }

  yearSel.innerHTML = years
    .map((y) => `<option value="${y}" ${Number(y) === activeYear ? "selected" : ""}>${y}</option>`)
    .join("");
  yearSel.addEventListener("change", () => switchYear(Number(yearSel.value)));

  try {
    if (db) {
      await loadSeason(activeYear);
      await loadStandings(activeYear);
    } else {
      seasonDoc = emptySeason(activeYear);
      composeState();
    }
  } catch {
    db = null;
    seasonDoc = emptySeason(activeYear);
    composeState();
  }

  renderAll();
  watchSeason(activeYear);
  watchStandings(activeYear);
  startLive();
}

if (window.claude?.hot) {
  window.claude.hot.ready ? window.claude.hot.ready(boot) : boot();
} else {
  boot();
}
