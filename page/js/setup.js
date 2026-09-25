import { teamTag } from "./clubs.js";
import { html, setHtml } from "./html.js";
import { renderAll } from "./render.js";
import { saveTeams } from "./season-store.js";
import { session } from "./session.js";
import { TEAMS } from "./teams.js";

let picked = new Set();
let seeds = { AL: {}, NL: {} };

const SEED_NUMBERS = [1, 2, 3, 4, 5, 6];
const SEEDS_INCOMPLETE = "Assign all 6 seeds in both the AL and the NL before saving.";
const SAVE_FAILED = "Couldn't save the field. Try again in a moment.";

const findDialog = () => /** @type {HTMLDialogElement} */ (document.getElementById("setupDialog"));

function showSetupError(message) {
  const error = document.getElementById("setupError");
  error.textContent = message;
  error.hidden = !message;
}

export function openSetup() {
  showSetupError("");
  picked = new Set(Object.keys(session.state.teams));
  seeds = { AL: {}, NL: {} };
  for (const [id, team] of Object.entries(session.state.teams)) seeds[team.league][team.seed] = id;
  renderPickGrid();
  findDialog().showModal();
}

function togglePick(id) {
  if (picked.has(id)) picked.delete(id);
  else picked.add(id);
  renderPickGrid();
}

function renderPickGrid() {
  const grid = document.getElementById("pickGrid");
  const labels = Object.entries(TEAMS)
    .sort((first, second) => first[1].name.localeCompare(second[1].name))
    .map(
      ([id, team]) => html`
    <label class="pick-team ${picked.has(id) ? "selected" : ""}" data-id="${id}">
      <input type="checkbox" ${picked.has(id) ? "checked" : ""}>
      ${teamTag(id)} <span style="color:var(--ink-dim); font-size:.72rem;">(${team.league})</span>
    </label>`,
    );
  setHtml(grid, html`${labels}`);
  /** @type {NodeListOf<HTMLElement>} */ (grid.querySelectorAll(".pick-team")).forEach((label) => {
    label.addEventListener("click", (event) => {
      event.preventDefault();
      togglePick(label.dataset.id);
    });
  });
  renderSeedArea();
}

const listPickedIn = (league) => [...picked].filter((id) => TEAMS[id].league === league);

function dropUnpickedSeeds() {
  for (const league of ["AL", "NL"]) {
    const ids = listPickedIn(league);
    for (const seed of Object.keys(seeds[league])) {
      if (!ids.includes(seeds[league][seed])) delete seeds[league][seed];
    }
  }
}

function renderSeedPicker(league, seed, ids) {
  const options = ids.map(
    (id) =>
      html`<option value="${id}" ${seeds[league][seed] === id ? "selected" : ""}>${TEAMS[id].name}</option>`,
  );
  return html`
        <div class="seed-row">
          <span>Seed ${seed}</span>
          <select data-league="${league}" data-seed="${seed}" aria-label="${league} seed ${seed}">
            <option value="">&mdash;</option>
            ${options}
          </select>
        </div>`;
}

function renderSeedArea() {
  dropUnpickedSeeds();
  const area = document.getElementById("seedArea");
  const columns = ["AL", "NL"].map((league) => {
    const ids = listPickedIn(league);
    return html`<div>
      <h3 style="color:var(--${league.toLowerCase()});">${league} seeds (${ids.length}/6)</h3>
      ${SEED_NUMBERS.map((seed) => renderSeedPicker(league, seed, ids))}
    </div>`;
  });
  setHtml(area, html`${columns}`);
  area.querySelectorAll("select").forEach((select) => {
    select.addEventListener("change", () => {
      seeds[select.dataset.league][select.dataset.seed] = select.value || null;
    });
  });
}

function collectSeededTeams() {
  const teams = {};
  for (const league of ["AL", "NL"]) {
    for (const seed of SEED_NUMBERS) {
      const id = seeds[league][seed];
      if (id) teams[id] = { league, seed };
    }
  }
  return teams;
}

// A club picked for two seeds keeps only the last, so a league can come up short.
const isFieldComplete = (teams) =>
  ["AL", "NL"].every(
    (league) => Object.values(teams).filter((team) => team.league === league).length === 6,
  );

export async function saveSetup() {
  const teams = collectSeededTeams();
  if (!isFieldComplete(teams)) {
    showSetupError(SEEDS_INCOMPLETE);
    return;
  }
  try {
    await saveTeams(teams);
  } catch {
    showSetupError(SAVE_FAILED);
    return;
  }
  findDialog().close();
  renderAll();
}
