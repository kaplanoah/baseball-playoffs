import { TEAMS } from "./teams.js";
import { buildBracket } from "./bracket.js";
import { html } from "./html.js";
import { session, readSeasonYear } from "./session.js";

export function findLastTitle(id) {
  const seeded = TEAMS[id].lastWS;
  const tracked = session.trackedTitles[id];
  if (seeded && tracked) return Math.max(seeded, tracked);
  return tracked || seeded;
}

export function describeDrought(id) {
  const won = findLastTitle(id);
  if (!won) return `Since ${TEAMS[id].firstSeason}`;
  const year = readSeasonYear();
  if (won >= year) return "Reigning";
  const { state } = session;
  const isCurrentShown = session.activeYear === year && state && state.teams;
  const crowned = isCurrentShown ? buildBracket(state).ws?.winner : null;
  if (won === year - 1 && !crowned) return "Defending";
  const years = year - won;
  return years + (years === 1 ? " yr" : " yrs");
}

const measureLightness = (hex) => {
  const [red, green, blue] = [1, 3, 5].map((index) => parseInt(hex.slice(index, index + 2), 16));
  return 0.299 * red + 0.587 * green + 0.114 * blue;
};

// Split vertically so the inner shadow shades both halves alike; a much lighter half reads larger,
// so it gets slightly less room.
function chooseDotSplit(team) {
  const contrastGap = measureLightness(team.color2) - measureLightness(team.color);
  if (contrastGap > 90) return 52;
  if (contrastGap < -90) return 48;
  return 50;
}

function renderTeamDot(id) {
  const team = TEAMS[id];
  if (!team) return html`<span class="dot" style="background:#999"></span>`;
  const split = chooseDotSplit(team);
  return html`<span class="dot" style="background:linear-gradient(90deg, ${team.color} ${split}%, ${team.color2} ${split}%)"></span>`;
}

export function nameTeam(id) {
  return TEAMS[id] ? TEAMS[id].name : "?";
}

export function renderTeamTag(id, tag = "span") {
  return html`<span class="club">${renderTeamDot(id)}<${tag} class="team-name">${nameTeam(id)}</${tag}></span>`;
}

const readLeague = (id) => TEAMS[id]?.league || "";
const readSeed = (teams, id) => teams[id].seed ?? 99;

// `ranking` changes only on a drag, so it can name clubs that left the field and miss ones that arrived.
// The store sorts a document's keys, so the ones that arrived go by league and seed.
export function listRankedOrder() {
  const { state } = session;
  if (!state || !state.teams) return [];
  const ranked = (state.ranking || []).filter((id) => state.teams[id]);
  const unranked = Object.keys(state.teams)
    .filter((id) => !ranked.includes(id))
    .sort(
      (first, second) =>
        readLeague(first).localeCompare(readLeague(second)) ||
        readSeed(state.teams, first) - readSeed(state.teams, second),
    );
  return ranked.concat(unranked);
}

export function renderSeedMark(seed) {
  return seed ? html`<span class="seed-pre tabular">${seed}</span>` : html``;
}

export function renderRankTag(id, solid) {
  const index = listRankedOrder().indexOf(id);
  if (index === -1) return html``;
  return html`<span class="rank-slot"><span class="rank-tag ${solid ? "solid" : ""}">#${index + 1}</span></span>`;
}
