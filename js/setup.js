/* Manual field setup: the fallback for setting the 12 teams and their seeds
   by hand, for when the routine hasn't done it. */

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
